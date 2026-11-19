/**
 * Measures how well the vision model reads EC60E photos.
 *
 *   npm run ai:eval -w @trustelect/api -- apps/api/data/ec60e-eval [model]
 *
 * The folder holds photos (.jpg, .jpeg, .webp, .png). Each photo can have a file with the
 * same name and .json extension giving the correct answer:
 *   { "is_ec60e": true, "polling_unit_code": "24/05/01/003",
 *     "party_results": { "APC": 112, "LP": 98 }, "total_valid_votes": 210 }
 * Photos without a .json file are read and shown, but not scored.
 * Each photo is one paid model call.
 */
import { readdir, readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { parseUnitCode } from '@trustelect/shared';
import { normaliseParty } from '../verification/decide.js';
import { OpenRouterVisionModel } from '../verification/vision-model.js';

interface Expected {
  is_ec60e: boolean;
  polling_unit_code?: string;
  party_results?: Record<string, number>;
  total_valid_votes?: number;
}

const MIME: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.png': 'image/png' };

for (const candidate of ['../../.env', '.env']) {
  try {
    process.loadEnvFile(resolve(import.meta.dirname, '../..', candidate));
  } catch {
    // optional
  }
}

const dir = process.argv[2];
if (!dir) {
  console.error('Usage: ai:eval <folder> [model]');
  process.exit(1);
}
const settings: Record<string, string | undefined> = {
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  OPENROUTER_MODEL: process.argv[3] ?? process.env.OPENROUTER_MODEL ?? 'anthropic/claude-sonnet-5.5',
};
const model = new OpenRouterVisionModel({ get: (k: string) => settings[k] } as never);

const folder = resolve(process.env.INIT_CWD ?? process.cwd(), dir);
const files = (await readdir(folder)).filter((f) => MIME[extname(f).toLowerCase()]).sort();
if (!files.length) {
  console.error(`No photos found in ${folder}`);
  process.exit(1);
}

let scored = 0;
let documentCorrect = 0;
let unitCorrect = 0;
let unitTotal = 0;
let figuresCorrect = 0;
let figuresTotal = 0;
const seconds: number[] = [];

console.log(`Model: ${model.name}\n`);
for (const file of files) {
  const base = file.slice(0, -extname(file).length);
  const expected = await readFile(join(folder, `${base}.json`), 'utf8')
    .then((t) => JSON.parse(t) as Expected)
    .catch(() => null);

  const started = Date.now();
  let line = '';
  try {
    const r = await model.read(await readFile(join(folder, file)), MIME[extname(file).toLowerCase()], 'Evaluation run.');
    seconds.push((Date.now() - started) / 1000);
    const read = Object.fromEntries(r.party_results.map((p) => [normaliseParty(p.party), p.votes]));
    line = `ec60e=${r.is_ec60e} quality=${r.image_quality} stamp=${r.stamp_visible} unit=${r.polling_unit_code ?? '-'} parties=${r.party_results.length}`;

    if (expected) {
      scored++;
      const marks: string[] = [];
      if (r.is_ec60e === expected.is_ec60e) documentCorrect++;
      else marks.push('document type WRONG');
      if (expected.polling_unit_code) {
        unitTotal++;
        const ok = parseUnitCode(expected.polling_unit_code)?.unit === parseUnitCode(r.polling_unit_code ?? '')?.unit;
        if (ok) unitCorrect++;
        else marks.push('unit code WRONG');
      }
      for (const [party, votes] of Object.entries(expected.party_results ?? {})) {
        figuresTotal++;
        if (read[normaliseParty(party)] === votes) figuresCorrect++;
        else marks.push(`${party} read ${read[normaliseParty(party)] ?? 'nothing'}, expected ${votes}`);
      }
      if (expected.total_valid_votes !== undefined) {
        figuresTotal++;
        if (r.total_valid_votes === expected.total_valid_votes) figuresCorrect++;
        else marks.push(`total valid read ${r.total_valid_votes}, expected ${expected.total_valid_votes}`);
      }
      line += marks.length ? `  ✕ ${marks.join('; ')}` : '  ✓';
    }
  } catch (err) {
    line = `ERROR ${(err as Error).message}`;
  }
  console.log(`${file.padEnd(32)} ${line}`);
}

const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}% (${a}/${b})` : 'n/a');
console.log(`\nScored photos:        ${scored} of ${files.length}`);
console.log(`Document type correct: ${pct(documentCorrect, scored)}`);
console.log(`Unit code correct:     ${pct(unitCorrect, unitTotal)}`);
console.log(`Figures correct:       ${pct(figuresCorrect, figuresTotal)}`);
if (seconds.length) {
  const avg = seconds.reduce((a, b) => a + b, 0) / seconds.length;
  console.log(`Average time:          ${avg.toFixed(1)}s per photo`);
}
