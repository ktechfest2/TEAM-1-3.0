import { z } from 'zod';

const base64Key32 = z
  .string()
  .refine((v) => Buffer.from(v, 'base64').length === 32, 'must be 32 bytes, base64-encoded');

/** Environment variables, validated at startup so misconfiguration fails fast. */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  /** Origin of the web app, allowed by CORS and checked on admin requests */
  WEB_ORIGIN: z.url().default('http://localhost:3000'),
  /** AES-256-GCM key for secrets at rest (TOTP secrets, phone numbers) */
  APP_ENCRYPTION_KEY: base64Key32,
  /** HMAC key for hashing phone numbers to count distinct witnesses */
  PHONE_HASH_KEY: base64Key32,
  /** Admin session lifetime */
  ADMIN_SESSION_HOURS: z.coerce.number().int().min(1).max(24).default(8),
  /**
   * How voters' phone numbers are handled at capture:
   * none = number entered without verification (default); sms = one-time SMS code required.
   */
  CAPTURE_PHONE_VERIFICATION: z.enum(['none', 'sms']).default('none'),
  /** Directory for evidence photographs in development (object storage in production) */
  EVIDENCE_DIR: z.string().default('storage/evidence'),
  /** OpenRouter key for AI verification (required from Sprint 4) */
  OPENROUTER_API_KEY: z.string().min(1).optional(),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
