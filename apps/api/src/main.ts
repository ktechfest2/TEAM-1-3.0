import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module.js';
import type { Env } from './config/env.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  app.enableCors({ origin: config.get('WEB_ORIGIN', { infer: true }) });
  // The web app proxies /api from the same machine: take the client address from X-Forwarded-For
  // only when the request comes from loopback (set TRUST_PROXY to the load balancer in production)
  app.getHttpAdapter().getInstance().set('trust proxy', process.env.TRUST_PROXY ?? 'loopback');
  app.enableShutdownHooks();

  await app.listen(config.get('API_PORT', { infer: true }));
}
await bootstrap();
