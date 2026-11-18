import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // End-to-end tests share one database, so run files one at a time
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL:
        process.env.DATABASE_URL ?? 'postgres://trustelect:trustelect_local_only@localhost:5442/trustelect',
      // Test-only keys, never used outside tests
      APP_ENCRYPTION_KEY: 'dGVzdC1vbmx5LWVuY3J5cHRpb24ta2V5LTMyLWJ5dGU=',
      PHONE_HASH_KEY: 'dGVzdC1vbmx5LXBob25lLWhhc2gta2V5LTMyLWJ5dGU=',
    },
  },
});
