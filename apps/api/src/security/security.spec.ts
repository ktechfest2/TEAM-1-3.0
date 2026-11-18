import { randomBytes } from 'node:crypto';
import { Encryptor, keyedHash, newToken, sha256 } from './encryption.js';
import { hashPassword, verifyPassword } from './password.js';
import { base32Decode, base32Encode, hotp, totp, verifyTotp } from './totp.js';

describe('password hashing', () => {
  it('verifies the right password and rejects a wrong one', async () => {
    const stored = await hashPassword('correct horse battery');
    expect(stored.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('correct horse battery', stored)).toBe(true);
    expect(await verifyPassword('wrong horse battery', stored)).toBe(false);
  });

  it('rejects short passwords', async () => {
    await expect(hashPassword('short')).rejects.toThrow(/at least/);
  });

  it('rejects malformed stored hashes', async () => {
    expect(await verifyPassword('anything long enough', 'not-a-hash')).toBe(false);
  });
});

describe('TOTP (RFC 6238)', () => {
  // RFC 6238 Appendix B test secret, SHA-1
  const secret = base32Encode(Buffer.from('12345678901234567890'));

  it('round-trips base32', () => {
    const buf = randomBytes(20);
    expect(base32Decode(base32Encode(buf)).equals(buf)).toBe(true);
  });

  it('matches the RFC 6238 test vectors', () => {
    expect(totp(secret, 59_000, 8)).toBe('94287082');
    expect(totp(secret, 1_111_111_109_000, 8)).toBe('07081804');
    expect(totp(secret, 1_234_567_890_000, 8)).toBe('89005924');
  });

  it('matches the RFC 4226 HOTP test vectors', () => {
    const key = Buffer.from('12345678901234567890');
    expect(hotp(key, 0)).toBe('755224');
    expect(hotp(key, 9)).toBe('520489');
  });

  it('accepts the current code and one step of drift, rejects older codes', () => {
    const now = 1_800_000_000_000;
    expect(verifyTotp(secret, totp(secret, now), now)).not.toBeNull();
    expect(verifyTotp(secret, totp(secret, now - 30_000), now)).not.toBeNull();
    expect(verifyTotp(secret, totp(secret, now - 90_000), now)).toBeNull();
    expect(verifyTotp(secret, 'abcdef', now)).toBeNull();
  });
});

describe('encryption', () => {
  const key = randomBytes(32).toString('base64');

  it('round-trips and uses a fresh IV each time', () => {
    const enc = new Encryptor(key);
    const a = enc.encrypt('+2348012345678');
    const b = enc.encrypt('+2348012345678');
    expect(a).not.toBe(b);
    expect(enc.decrypt(a)).toBe('+2348012345678');
  });

  it('detects tampering', () => {
    const enc = new Encryptor(key);
    const [v, iv, tag, ct] = enc.encrypt('secret').split('.');
    const flipped = Buffer.from(ct, 'base64');
    flipped[0] ^= 1;
    expect(() => enc.decrypt([v, iv, tag, flipped.toString('base64')].join('.'))).toThrow();
  });

  it('rejects keys of the wrong length', () => {
    expect(() => new Encryptor(randomBytes(16).toString('base64'))).toThrow(/32 bytes/);
  });

  it('produces stable keyed hashes and random tokens', () => {
    expect(keyedHash(key, '+2348012345678')).toBe(keyedHash(key, '+2348012345678'));
    const t = newToken();
    expect(t.hash).toBe(sha256(t.token));
    expect(newToken().token).not.toBe(t.token);
  });
});
