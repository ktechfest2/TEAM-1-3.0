import { randomBytes } from 'node:crypto';
import { validateEnv } from './env.js';

describe('validateEnv', () => {
  const valid = {
    DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
    APP_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    PHONE_HASH_KEY: randomBytes(32).toString('base64'),
  };

  it('applies defaults', () => {
    const env = validateEnv(valid);
    expect(env.API_PORT).toBe(4000);
    expect(env.NODE_ENV).toBe('development');
    expect(env.WEB_ORIGIN).toBe('http://localhost:3000');
    expect(env.ADMIN_SESSION_HOURS).toBe(8);
  });

  it('coerces the port from a string', () => {
    expect(validateEnv({ ...valid, API_PORT: '8080' }).API_PORT).toBe(8080);
  });

  it('rejects a missing database URL', () => {
    expect(() => validateEnv({ ...valid, DATABASE_URL: undefined })).toThrow(/DATABASE_URL/);
  });

  it('rejects a non-Postgres database URL', () => {
    expect(() => validateEnv({ ...valid, DATABASE_URL: 'mysql://localhost/db' })).toThrow(/DATABASE_URL/);
  });

  it('rejects an encryption key of the wrong length', () => {
    expect(() =>
      validateEnv({ ...valid, APP_ENCRYPTION_KEY: randomBytes(16).toString('base64') }),
    ).toThrow(/APP_ENCRYPTION_KEY/);
  });
});
