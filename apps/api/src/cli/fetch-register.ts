/**
 * Downloads the public polling unit register and verifies it before use.
 *
 *   npm run register:fetch -w @trustelect/api
 *   npm run register:import -w @trustelect/api -- apps/api/data/inec-register.csv
 *
 * Source: INEC's public polling unit data (176,846 units, 774 LGAs, 8,809 wards),
 * as published in paul1029-ife/polling-unit-finder (data under the MIT licence;
 * the data is INEC public electoral information, see data/LICENSE in that repo).
 * The URL is pinned to a commit and the file is checked against its SHA-256,
 * so every import uses exactly the same data.
 */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const SOURCE = {
  url: 'https://raw.githubusercontent.com/paul1029-ife/polling-unit-finder/3efbaeaece60f1116412d8c54ec492738aaa4fad/data/polling-units.csv',
  sha256: '28667fd3a5574eaae0436f98d4b693811886c895edb40f90cb754a2107a29484',
};

const out = resolve(import.meta.dirname, '../../data/inec-register.csv');

console.log(`Downloading ${SOURCE.url}`);
const res = await fetch(SOURCE.url, { signal: AbortSignal.timeout(10 * 60_000) });
if (!res.ok) {
  console.error(`Download failed: HTTP ${res.status}`);
  process.exit(1);
}
const body = Buffer.from(await res.arrayBuffer());
const digest = createHash('sha256').update(body).digest('hex');
if (digest !== SOURCE.sha256) {
  console.error(`Checksum mismatch: expected ${SOURCE.sha256}, got ${digest}. Nothing saved.`);
  process.exit(1);
}

await mkdir(dirname(out), { recursive: true });
await writeFile(out, body);
console.log(`Verified and saved ${(body.length / 1e6).toFixed(1)} MB to ${out}`);
