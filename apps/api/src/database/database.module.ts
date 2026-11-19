import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DrizzleModule } from '@nestjs/drizzle';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Env } from '../config/env.js';

@Module({
  imports: [
    DrizzleModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        drizzle,
        connection: { connectionString: config.get('DATABASE_URL', { infer: true }), max: config.get('DATABASE_POOL_MAX', { infer: true }) },
      }),
    }),
  ],
})
export class DatabaseModule {}

/** Injected with `@InjectDrizzle()`. Relations are added as features need them. */
export type Database = NodePgDatabase;
