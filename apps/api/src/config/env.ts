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
  /** SMS provider: log = development (writes codes to the log); bulksmslive = real SMS */
  SMS_PROVIDER: z.enum(['log', 'bulksmslive']).default('log'),
  BULKSMSLIVE_API_KEY: z.string().min(1).optional(),
  /** Sender name shown on the SMS (max 11 characters, as registered with the provider) */
  SMS_SENDER_NAME: z.string().min(1).max(11).default('TrustElect'),
  /** Directory for evidence photographs in development (object storage in production) */
  EVIDENCE_DIR: z.string().default('storage/evidence'),
  /** OpenRouter key for AI verification */
  OPENROUTER_API_KEY: z.string().min(1).optional(),
  /** Vision model on OpenRouter used to read EC60E photos */
  OPENROUTER_MODEL: z.string().min(3).default('anthropic/claude-sonnet-5.5'),
  /** Background verification of submitted photos: on, or off (tests, maintenance) */
  VERIFICATION_WORKER: z.enum(['on', 'off']).default('on'),
  /** Publishing the latest chain hash (EVD-03): on, or off (tests) */
  CHAIN_ANCHOR_WORKER: z.enum(['on', 'off']).default('on'),
  /** Minutes between published anchors (only when the chain has grown) */
  CHAIN_ANCHOR_MINUTES: z.coerce.number().int().min(1).max(1440).default(10),
  /** External public record of each anchor: none, or opentimestamps (Bitcoin-backed, free, sends only a hash) */
  CHAIN_ANCHOR_EXTERNAL: z.enum(['none', 'opentimestamps']).default('none'),
});

export type Env = z.infer<typeof envSchema>;

const refinedSchema = envSchema.refine((e) => e.SMS_PROVIDER !== 'bulksmslive' || !!e.BULKSMSLIVE_API_KEY, {
  message: 'BULKSMSLIVE_API_KEY is required when SMS_PROVIDER=bulksmslive',
  path: ['BULKSMSLIVE_API_KEY'],
});

export function validateEnv(config: Record<string, unknown>): Env {
  const result = refinedSchema.safeParse(config);
  if (!result.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
