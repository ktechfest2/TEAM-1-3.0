import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Injectable,
  NotFoundException,
  Param,
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
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { readSessionToken } from '../auth/session.guard.js';
import { parseOrThrow } from '../common/validation.js';
import type { Env } from '../config/env.js';
import { VerificationService } from '../verification/verification.service.js';
import { CAPTURE_SESSION_HOURS, CaptureService, type CaptureVoter } from './capture.service.js';

export const CAPTURE_COOKIE = 'te_capture';

type VoterRequest = Request & { voter?: CaptureVoter };

@Injectable()
export class CaptureSessionGuard implements CanActivate {
  constructor(private readonly capture: CaptureService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<VoterRequest>();
    const token = readSessionToken(req, CAPTURE_COOKIE);
    const voter = token ? await this.capture.resolveSession(token) : null;
    if (!voter) throw new UnauthorizedException('Verify your phone number first');
    req.voter = voter;
    return true;
  }
}

export const CurrentVoter = createParamDecorator(
  (_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<VoterRequest>().voter!,
);

const requestSchema = z.object({ phone: z.string().min(7).max(20) });
const startSchema = z.object({
  phone: z.string().min(7).max(20),
  /** The voter must accept the privacy notice */
  consent: z.literal(true),
});
const verifySchema = z.object({
  phone: z.string().min(7).max(20),
  code: z.string().regex(/^\d{6}$/),
  /** The voter must accept the privacy notice */
  consent: z.literal(true),
});
const photoQuerySchema = z.object({
  electionId: z.uuid(),
  clientId: z.uuid(),
  unitCode: z.string().min(7).max(20),
  capturedAt: z.iso.datetime({ offset: true }).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  accuracy: z.coerce.number().min(0).max(100_000).optional(),
});

/**
 * Per-IP limits only stop floods: on Nigerian mobile networks many phones share one IP
 * (carrier-grade NAT), so the real limits are per phone number (codes and photos per hour).
 */
@Controller('capture')
export class CaptureController {
  constructor(
    private readonly capture: CaptureService,
    private readonly verification: VerificationService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private get phoneVerificationMode() {
    return this.config.get('CAPTURE_PHONE_VERIFICATION', { infer: true });
  }

  private requireMode(mode: 'none' | 'sms') {
    if (this.phoneVerificationMode !== mode) throw new NotFoundException();
  }

  /** Tells the app whether an SMS code is needed */
  @Get('config')
  captureConfig() {
    return { phoneVerification: this.phoneVerificationMode };
  }

  /** Default flow: phone number and consent, no SMS code */
  @Post('start')
  @HttpCode(200)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async start(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    this.requireMode('none');
    const { phone } = parseOrThrow(startSchema, body);
    const { token, voter } = await this.capture.startWithoutVerification(phone);
    this.setSessionCookie(res, token);
    return { phoneMasked: voter.phoneMasked, expiresAt: voter.expiresAt, token };
  }

  @Post('code')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  requestCode(@Body() body: unknown) {
    this.requireMode('sms');
    return this.capture.requestCode(parseOrThrow(requestSchema, body).phone);
  }

  @Post('verify')
  @HttpCode(200)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async verify(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    this.requireMode('sms');
    const { phone, code } = parseOrThrow(verifySchema, body);
    const { token, voter } = await this.capture.verifyCode(phone, code);
    this.setSessionCookie(res, token);
    return { phoneMasked: voter.phoneMasked, expiresAt: voter.expiresAt, token };
  }

  /** Opens a capture session from a one-time link sent by WhatsApp or SMS (CAP-02) */
  @Post('link')
  @HttpCode(200)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async link(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const { token: linkToken } = parseOrThrow(z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{20,200}$/) }), body);
    const opened = await this.capture.redeemLink(linkToken);
    if (!opened) throw new UnauthorizedException('This link has expired or was already used. Ask for a new one on WhatsApp.');
    this.setSessionCookie(res, opened.token);
    return { phoneMasked: opened.voter.phoneMasked, expiresAt: opened.voter.expiresAt, token: opened.token };
  }

  private setSessionCookie(res: Response, token: string) {
    res.cookie(CAPTURE_COOKIE, token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: this.config.get('NODE_ENV', { infer: true }) === 'production',
      path: '/',
      maxAge: CAPTURE_SESSION_HOURS * 3_600_000,
    });
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
        unitCode: q.unitCode,
        deviceId: z.uuid().safeParse(req.headers['x-device-id']).data,
        ip: req.ip,
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

  /** The result of checking the voter's own photo: pending, verified, needs_confirmation or rejected. */
  @Get('photos/:id')
  @UseGuards(CaptureSessionGuard)
  async photoStatus(@CurrentVoter() voter: CaptureVoter, @Param('id') id: string) {
    const parsed = z.uuid().safeParse(id);
    const status = parsed.success ? await this.verification.statusFor(id, voter.reporterId) : null;
    if (!status) throw new NotFoundException();
    return status;
  }

  /** The voter confirms or disputes figures that did not add up (VER-09). */
  @Post('photos/:id/confirm')
  @HttpCode(200)
  @UseGuards(CaptureSessionGuard)
  async confirmFigures(@CurrentVoter() voter: CaptureVoter, @Param('id') id: string, @Body() body: unknown) {
    const { confirmed } = parseOrThrow(z.object({ confirmed: z.boolean() }), body);
    const parsed = z.uuid().safeParse(id);
    const status = parsed.success ? await this.verification.confirmFigures(id, voter.reporterId, confirmed) : null;
    if (!status) throw new NotFoundException();
    return status;
  }
}
