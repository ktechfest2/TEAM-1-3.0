/**
 * Checks the whole hash chain and every stored record against it (EVD-02, EVD-03).
 *
 *   npm run chain:verify -w @trustelect/api
 *
 * Exits with code 1 if anything does not match.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { ChainService } from '../chain/chain.service.js';

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
const result = await app.get(ChainService).verifyAll((seq) => process.stderr.write(`\rchecked ${seq} entries`));
process.stderr.write('\n');
console.log(`Entries: ${result.entries}`);
console.log(`Head: ${result.head}`);
console.log(`Records checked against the chain: ${result.recordsChecked}`);
if (result.recordsNoLongerStored) console.log(`Chained records no longer stored (e.g. removed test data): ${result.recordsNoLongerStored}`);
if (result.problems.length) {
  console.log(`\n${result.problems.length} problems:`);
  for (const p of result.problems.slice(0, 100)) console.log(`  - ${p}`);
  process.exitCode = 1;
} else {
  console.log('\nThe chain is intact and every stored record matches it.');
}
await app.close();
