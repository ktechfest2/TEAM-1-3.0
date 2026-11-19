import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { Env } from '../config/env.js';

/**
 * Write-once storage for evidence photographs (EVD-01). Files are keyed by their
 * SHA-256, so identical bytes map to one file and an existing file is never overwritten.
 * Local disk in development; object storage with retention locks in production (Sprint 8).
 */
@Injectable()
export class EvidenceStorage {
  private readonly root: string;

  constructor(config: ConfigService<Env, true>) {
    this.root = resolve(config.get('EVIDENCE_DIR', { infer: true }));
  }

  /** Stores the bytes and returns the storage key. */
  async put(sha256: string, bytes: Buffer, extension: 'jpg' | 'webp'): Promise<string> {
    const key = `${sha256.slice(0, 2)}/${sha256}.${extension}`;
    const path = join(this.root, key);
    await mkdir(dirname(path), { recursive: true });
    try {
      await writeFile(path, bytes, { flag: 'wx', mode: 0o440 });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
    return key;
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.path(key));
  }

  /** Only for images that fail verification: they must not be kept (VER-05). */
  async remove(key: string): Promise<void> {
    const path = this.path(key);
    await chmod(path, 0o640).catch(() => undefined);
    await rm(path, { force: true });
  }

  private path(key: string): string {
    if (!/^[0-9a-f]{2}\/[0-9a-f]{64}\.(jpg|webp)$/.test(key)) throw new Error('Invalid evidence key');
    return join(this.root, key);
  }
}
