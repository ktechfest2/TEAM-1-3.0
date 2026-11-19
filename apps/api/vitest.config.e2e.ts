import { defineConfig } from 'vitest/config';
import { testDatabaseUrl } from './test/global-setup.js';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // A separate database (trustelect_test), created and migrated before the run; files run one at a time
    globalSetup: ['./test/global-setup.ts'],
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: testDatabaseUrl(),
      // Test-only keys, never used outside tests
      APP_ENCRYPTION_KEY: 'dGVzdC1vbmx5LWVuY3J5cHRpb24ta2V5LTMyLWJ5dGU=',
      PHONE_HASH_KEY: 'dGVzdC1vbmx5LXBob25lLWhhc2gta2V5LTMyLWJ5dGU=',
      EVIDENCE_DIR: 'storage/e2e-evidence',
      // Never send real SMS from tests
      SMS_PROVIDER: 'log',
      CAPTURE_PHONE_VERIFICATION: 'none',
      // Tests drive verification directly with a fake model
      VERIFICATION_WORKER: 'off',
      CHAIN_ANCHOR_WORKER: 'off',
      CHAIN_ANCHOR_EXTERNAL: 'none',
      // WhatsApp: messages go to an in-memory log; webhook secrets for signing test calls
      WHATSAPP_PROVIDER: 'log',
      WHATSAPP_APP_SECRET: 'test-only-whatsapp-app-secret',
      WHATSAPP_VERIFY_TOKEN: 'test-only-verify-token-123',
      WHATSAPP_PHONE_NUMBER_ID: '1000000001',
      // SMS and USSD callbacks (replies go to an in-memory log)
      CHANNELS_PROVIDER: 'log',
      CHANNELS_WEBHOOK_TOKEN: 'test-only-channels-token-0123456789',
    },
  },
});
