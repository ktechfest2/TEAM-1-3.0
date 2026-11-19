import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module.js';
import { webOrigins, type Env } from './config/env.js';

async function bootstrap() {
  // rawBody: the WhatsApp webhook checks Meta's signature over the exact bytes received
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  // The web app (trustelect.web.app) calls the API from another site; sessions travel as Bearer tokens
  app.enableCors({
    origin: webOrigins({ WEB_ORIGIN: config.get('WEB_ORIGIN', { infer: true }), WEB_EXTRA_ORIGINS: config.get('WEB_EXTRA_ORIGINS', { infer: true }) }),
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Device-Id'],
    exposedHeaders: ['Content-Disposition'],
    maxAge: 600,
  });
  // The web app proxies /api from the same machine: take the client address from X-Forwarded-For
  // only when the request comes from loopback (set TRUST_PROXY to the load balancer in production)
  app.getHttpAdapter().getInstance().set('trust proxy', process.env.TRUST_PROXY ?? 'loopback');
  app.enableShutdownHooks();

  await app.listen(config.get('API_PORT', { infer: true }));
}
await bootstrap();
