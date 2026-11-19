import { ForbiddenException, Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { webOrigins, type Env } from '../config/env.js';
import { ApiKeysService } from './api-keys.service.js';

/** Public data documented at /developers: what outside organisations need a key for */
export const PUBLIC_DATA = /^\/(elections|results\/(elections|units)|geo|incidents|chain|evidence\/elections)(\/|$)/;

export type KeyedRequest = Request & { apiClientId?: string };

/**
 * Outside organisations read public data with a registered, approved API key (X-API-Key).
 * TrustElect's own web app needs none: its requests carry its origin (fetch, live stream) or,
 * for downloads, its address as the referrer. Health checks, capture, admin and webhooks are
 * not affected.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly origins: string[];
  private readonly registerAt: string;

  constructor(
    private readonly keys: ApiKeysService,
    config: ConfigService<Env, true>,
  ) {
    this.origins = webOrigins({ WEB_ORIGIN: config.get('WEB_ORIGIN', { infer: true }), WEB_EXTRA_ORIGINS: config.get('WEB_EXTRA_ORIGINS', { infer: true }) });
    this.registerAt = `${config.get('WEB_ORIGIN', { infer: true })}/developers`;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<KeyedRequest>();
    if ((req.method !== 'GET' && req.method !== 'HEAD') || !PUBLIC_DATA.test(req.path)) return true;

    const key = req.headers['x-api-key'];
    if (typeof key === 'string' && key.length > 0) {
      const client = await this.keys.lookup(key.trim());
      if (!client) throw new UnauthorizedException('This API key is not valid');
      if (client.status === 'pending') throw new ForbiddenException('This API key is waiting for approval by TrustElect');
      if (client.status !== 'active') throw new UnauthorizedException('This API key is no longer active');
      req.apiClientId = client.id;
      this.keys.recordUse(client.id);
      return true;
    }

    if (!this.keys.required || this.fromWebApp(req)) return true;
    throw new UnauthorizedException(`An API key is required. Register for one at ${this.registerAt}`);
  }

  private fromWebApp(req: Request) {
    const origin = req.headers.origin;
    if (origin) return this.origins.includes(origin);
    const referer = req.headers.referer;
    return typeof referer === 'string' && this.origins.some((o) => referer === o || referer.startsWith(`${o}/`));
  }
}
