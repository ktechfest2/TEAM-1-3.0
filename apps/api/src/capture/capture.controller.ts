import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Injectable,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
  createParamDecorator,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { readCookie } from '../auth/session.guard.js';
import { parseOrThrow } from '../common/validation.js';
import type { Env } from '../config/env.js';
import { CAPTURE_SESSION_HOURS, CaptureService, type CaptureVoter } from './capture.service.js';

export const CAPTURE_COOKIE = 'te_capture';

type VoterRequest = Request & { voter?: CaptureVoter };

@Injectable()
export class CaptureSessionGuard implements CanActivate {
  constructor(private readonly capture: CaptureService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<VoterRequest>();
    const token = readCookie(req, CAPTURE_COOKIE);
    const voter = token ? await this.capture.resolveSession(token) : null;
    if (!voter) throw new UnauthorizedException('Verify your phone number first');
    req.voter = voter;
    return true;
  }
}

const CurrentVoter = createParamDecorator(
  (_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<VoterRequest>().voter!,
);

const requestSchema = z.object({ phone: z.string().min(7).max(20) });
const verifySchema = z.object({
  phone: z.string().min(7).max(20),
  code: z.string().regex(/^\d{6}$/),
  /** The voter must accept the privacy notice */
  consent: z.literal(true),
});
const photoQuerySchema = z.object({
  electionId: z.uuid(),
  clientId: z.uuid(),
  capturedAt: z.iso.datetime({ offset: true }).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  accuracy: z.coerce.number().min(0).max(100_000).optional(),
});

@Controller('capture')
export class CaptureController {
  constructor(
    private readonly capture: CaptureService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Post('code')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  requestCode(@Body() body: unknown) {
    return this.capture.requestCode(parseOrThrow(requestSchema, body).phone);
  }

  @Post('verify')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async verify(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const { phone, code } = parseOrThrow(verifySchema, body);
    const { token, voter } = await this.capture.verifyCode(phone, code);
    res.cookie(CAPTURE_COOKIE, token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: this.config.get('NODE_ENV', { infer: true }) === 'production',
      path: '/',
      maxAge: CAPTURE_SESSION_HOURS * 3_600_000,
    });
    return { phoneMasked: voter.phoneMasked, expiresAt: voter.expiresAt };
  }

  @Get('session')
  @UseGuards(CaptureSessionGuard)
  session(@CurrentVoter() voter: CaptureVoter) {
    return { phoneMasked: voter.phoneMasked, expiresAt: voter.expiresAt };
  }

  @Post('logout')
  @HttpCode(200)
  @UseGuards(CaptureSessionGuard)
  async logout(@CurrentVoter() voter: CaptureVoter, @Res({ passthrough: true }) res: Response) {
    await this.capture.endSession(voter);
    res.clearCookie(CAPTURE_COOKIE, { path: '/' });
    return { status: 'ok' };
  }

  /** Body: the raw JPEG or WebP bytes. Metadata in the query string. */
  @Post('photos')
  @UseGuards(CaptureSessionGuard)
  async photo(@CurrentVoter() voter: CaptureVoter, @Query() query: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const q = parseOrThrow(photoQuerySchema, query);
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      throw new BadRequestException('Send the photo as image/jpeg or image/webp');
    }
    const result = await this.capture.submitPhoto(
      voter,
      {
        electionId: q.electionId,
        clientId: q.clientId,
        capturedAt: q.capturedAt ? new Date(q.capturedAt) : undefined,
        latitude: q.lat,
        longitude: q.lng,
        accuracy: q.accuracy,
      },
      req.body,
    );
    res.status(result.duplicate ? 200 : 201);
    return { id: result.id, status: result.status, receivedAt: result.receivedAt, sha256: result.imageSha256 };
  }
}
