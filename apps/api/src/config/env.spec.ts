import { validateEnv } from './env.js';

describe('validateEnv', () => {
  const valid = { DATABASE_URL: 'postgres://user:pass@localhost:5432/db' };

  it('applies defaults', () => {
    const env = validateEnv(valid);
    expect(env.API_PORT).toBe(4000);
    expect(env.NODE_ENV).toBe('development');
    expect(env.WEB_ORIGIN).toBe('http://localhost:3000');
  });

  it('coerces the port from a string', () => {
    expect(validateEnv({ ...valid, API_PORT: '8080' }).API_PORT).toBe(8080);
  });

  it('rejects a missing database URL', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
  });

  it('rejects a non-Postgres database URL', () => {
    expect(() => validateEnv({ DATABASE_URL: 'mysql://localhost/db' })).toThrow(/DATABASE_URL/);
  });
});
