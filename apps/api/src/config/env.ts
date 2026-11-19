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
  /** Other origins serving the same web app, comma-separated (e.g. a second domain for the same site) */
  WEB_EXTRA_ORIGINS: z
    .string()
    .default('')
    .transform((v) => v.split(',').map((o) => o.trim()).filter(Boolean))
    .pipe(z.array(z.url())),
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
  /** WhatsApp channel: log = development and tests (messages written to the log), cloud = Meta Cloud API */
  WHATSAPP_PROVIDER: z.enum(['log', 'cloud']).default('log'),
  WHATSAPP_PHONE_NUMBER_ID: z.string().regex(/^\d+$/).optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().min(20).optional(),
  /** Meta app secret: every webhook call is checked against its X-Hub-Signature-256 */
  WHATSAPP_APP_SECRET: z.string().min(16).optional(),
  /** Shared secret Meta sends when the webhook is registered */
  WHATSAPP_VERIFY_TOKEN: z.string().min(16).optional(),
  WHATSAPP_GRAPH_VERSION: z.string().regex(/^v\d+\.\d+$/).default('v23.0'),
  /** Text model for the information assistant (INF) */
  OPENROUTER_CHAT_MODEL: z.string().min(3).default('anthropic/claude-haiku-5.5'),
  /** Audio model that transcribes WhatsApp voice notes (INF-05) */
  OPENROUTER_AUDIO_MODEL: z.string().min(3).default('google/gemini-3.8-flash'),
});

export type Env = z.infer<typeof envSchema>;

/** Every origin allowed to call the API from a browser */
export const webOrigins = (env: Pick<Env, 'WEB_ORIGIN' | 'WEB_EXTRA_ORIGINS'>) => [env.WEB_ORIGIN, ...env.WEB_EXTRA_ORIGINS];

const refinedSchema = envSchema
  .refine((e) => e.SMS_PROVIDER !== 'bulksmslive' || !!e.BULKSMSLIVE_API_KEY, {
    message: 'BULKSMSLIVE_API_KEY is required when SMS_PROVIDER=bulksmslive',
    path: ['BULKSMSLIVE_API_KEY'],
  })
  .refine(
    (e) =>
      e.WHATSAPP_PROVIDER !== 'cloud' ||
      !!(e.WHATSAPP_PHONE_NUMBER_ID && e.WHATSAPP_ACCESS_TOKEN && e.WHATSAPP_APP_SECRET && e.WHATSAPP_VERIFY_TOKEN),
    {
      message: 'WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN, WHATSAPP_APP_SECRET and WHATSAPP_VERIFY_TOKEN are required when WHATSAPP_PROVIDER=cloud',
      path: ['WHATSAPP_PROVIDER'],
    },
  );

export function validateEnv(config: Record<string, unknown>): Env {
  const result = refinedSchema.safeParse(config);
  if (!result.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
