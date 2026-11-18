/**
 * Imports a polling unit register CSV.
 *
 *   npm run register:import -w @trustelect/api -- path/to/register.csv
 *
 * Columns: pu_code, pu_name, ward_name, lga_name, state_name
 * Optional: latitude, longitude, registered_voters
 * Re-running with a newer file updates names and adds new units.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { GeographyService } from '../geography/geography.service.js';
import { parseRegister } from '../geography/register.js';

const file = process.argv[2];
if (!file) {
  console.error('Usage: register:import <file.csv>');
  process.exit(1);
}

const { rows, errors } = parseRegister(await readFile(resolve(process.env.INIT_CWD ?? process.cwd(), file), 'utf8'));
if (errors.length) {
  console.error(`${errors.length} problem(s) found; nothing imported:`);
  for (const e of errors.slice(0, 20)) console.error(`  line ${e.line}: ${e.message}`);
  if (errors.length > 20) console.error(`  …and ${errors.length - 20} more`);
  process.exit(1);
}

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
try {
  const started = Date.now();
  const summary = await app.get(GeographyService).importRegister(rows);
  console.log(
    `Imported ${summary.pollingUnits} polling units in ${summary.wards} wards, ${summary.lgas} LGAs, ` +
      `${summary.states} state(s) in ${((Date.now() - started) / 1000).toFixed(1)}s.`,
  );
  console.log('Register totals:', await app.get(GeographyService).counts());
} finally {
  await app.close();
}
