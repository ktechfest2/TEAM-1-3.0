import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM encryption for secrets at rest (TOTP secrets, phone numbers).
 * Format: v1.ivB64.tagB64.ciphertextB64
 */
export class Encryptor {
  private readonly key: Buffer;

  constructor(keyB64: string) {
    const key = Buffer.from(keyB64, 'base64');
    if (key.length !== 32) throw new Error('Encryption key must be 32 bytes (base64-encoded)');
    this.key = key;
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), ct.toString('base64')].join('.');
  }

  decrypt(payload: string): string {
    const [version, ivB64, tagB64, ctB64] = payload.split('.');
    if (version !== 'v1' || !ivB64 || !tagB64 || !ctB64) throw new Error('Unsupported ciphertext format');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
  }
}

/** Keyed hash, used to count distinct phone numbers without storing them in the clear. */
export function keyedHash(keyB64: string, value: string): string {
  return createHmac('sha256', Buffer.from(keyB64, 'base64')).update(value).digest('hex');
}

/** Random opaque token for sessions and links, plus the hash that is stored. */
export function newToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: sha256(token) };
}

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}
