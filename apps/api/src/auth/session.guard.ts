import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { Env } from '../config/env.js';
import { AuthService, type AdminRole, type AuthenticatedAdmin } from './auth.service.js';

export const SESSION_COOKIE = 'te_admin';

const ALLOW_PENDING = 'auth:allowPending';
const ROLES = 'auth:roles';

/** Allows a session that has passed the password but not yet the second factor. */
export const AllowPendingMfa = () => SetMetadata(ALLOW_PENDING, true);

/** Restricts a route to the given roles. System administrators are always allowed. */
export const Roles = (...roles: AdminRole[]) => SetMetadata(ROLES, roles);

type AdminRequest = Request & { admin?: AuthenticatedAdmin };

export const CurrentAdmin = createParamDecorator(
  (_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<AdminRequest>().admin!,
);

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Admin session guard: requires a valid session cookie, a completed second factor
 * (unless the route allows pending sessions), the right role, and, for changes,
 * a request coming from the TrustElect web app's origin.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly reflector: Reflector,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AdminRequest>();

    if (!SAFE_METHODS.has(req.method)) {
      const origin = req.headers.origin;
      if (origin && origin !== this.config.get('WEB_ORIGIN', { infer: true })) {
        throw new ForbiddenException('Cross-origin request refused');
      }
    }

    const token = readCookie(req, SESSION_COOKIE);
    const admin = token ? await this.auth.resolveSession(token) : null;
    if (!admin) throw new UnauthorizedException();

    const targets = [context.getHandler(), context.getClass()];
    const allowPending = this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING, targets);
    if (!admin.mfaVerified && !allowPending) throw new UnauthorizedException('Two-factor authentication required');

    const roles = this.reflector.getAllAndOverride<AdminRole[] | undefined>(ROLES, targets);
    if (roles?.length && admin.role !== 'system_admin' && !roles.includes(admin.role)) {
      throw new ForbiddenException();
    }

    req.admin = admin;
    return true;
  }
}
