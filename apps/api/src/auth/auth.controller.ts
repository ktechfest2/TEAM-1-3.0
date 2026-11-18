import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { Env } from '../config/env.js';
import { AuthService, type AuthenticatedAdmin } from './auth.service.js';
import { AllowPendingMfa, CurrentAdmin, SESSION_COOKIE, SessionGuard, readCookie } from './session.guard.js';

const loginSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(256),
  code: z.string().regex(/^\d{6}$/).optional(),
});

const codeSchema = z.object({ code: z.string().regex(/^\d{6}$/) });

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) throw new BadRequestException('Invalid request');
  return result.data;
}

@Controller('admin/auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Password, then the authenticator code. Rate-limited per client. */
  @Post('login')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async login(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { email, password, code } = parse(loginSchema, body);
    const outcome = await this.auth.login(email, password, code, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    switch (outcome.status) {
      case 'ok':
        this.setCookie(res, outcome.token, true);
        return { status: 'ok' };
      case 'totp_setup_required':
        this.setCookie(res, outcome.token, false);
        return { status: 'totp_setup_required' };
      case 'totp_required':
        return { status: 'totp_required' };
      case 'locked':
        throw new UnauthorizedException('Account temporarily locked after repeated failures. Try again later.');
      default:
        throw new UnauthorizedException('Incorrect email, password or code');
    }
  }

  @Post('totp/setup')
  @HttpCode(200)
  @UseGuards(SessionGuard)
  @AllowPendingMfa()
  async setup(@CurrentAdmin() admin: AuthenticatedAdmin) {
    if (admin.mfaVerified) throw new BadRequestException('Two-factor authentication is already set up');
    return this.auth.beginTotpSetup(admin);
  }

  @Post('totp/confirm')
  @HttpCode(200)
  @UseGuards(SessionGuard, ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @AllowPendingMfa()
  async confirm(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { code } = parse(codeSchema, body);
    if (!(await this.auth.confirmTotpSetup(admin, code))) throw new UnauthorizedException('Incorrect code');
    // Re-issue the same session cookie with the full session lifetime
    this.setCookie(res, readCookie(req, SESSION_COOKIE) ?? '', true);
    return { status: 'ok' };
  }

  @Get('me')
  @UseGuards(SessionGuard)
  @AllowPendingMfa()
  me(@CurrentAdmin() admin: AuthenticatedAdmin) {
    const { sessionId: _session, ...profile } = admin;
    return profile;
  }

  @Post('logout')
  @HttpCode(200)
  @UseGuards(SessionGuard)
  @AllowPendingMfa()
  async logout(@CurrentAdmin() admin: AuthenticatedAdmin, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(admin);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return { status: 'ok' };
  }

  private setCookie(res: Response, token: string, mfaVerified: boolean) {
    res.cookie(SESSION_COOKIE, token, this.cookieOptions(mfaVerified));
  }

  private cookieOptions(mfaVerified: boolean) {
    return {
      httpOnly: true,
      sameSite: 'strict' as const,
      secure: this.config.get('NODE_ENV', { infer: true }) === 'production',
      path: '/',
      maxAge: this.auth.sessionMaxAgeSeconds(mfaVerified) * 1000,
    };
  }
}
