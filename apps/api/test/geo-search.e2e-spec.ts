import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { normaliseForSearch, searchForms } from '../src/geography/geography.service.js';
import { addTestUnits, removeTestUnits, TEST_UNIT_OUTSIDE_LAGOS } from './helpers.js';

describe('Polling unit search by name or address (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    await addTestUnits(app);
  });

  afterAll(async () => {
    await removeTestUnits(app);
    await app.close();
  });

  const search = (q: string, extra = '') => request(app.getHttpServer()).get(`/geo/search?q=${encodeURIComponent(q)}${extra}`);

  it('finds a unit by its name, best match first, with its ward, LGA and state', async () => {
    const res = await search('test unit two').expect(200);
    expect(res.body[0]).toMatchObject({
      code: '24-98-01-002',
      name: 'TEST UNIT TWO',
      ward: { name: 'TEST WARD' },
      lga: { name: 'TEST LGA' },
      state: { code: '24', name: 'Lagos' },
    });
  });

  it('matches words from the ward, LGA and state too, in any order and case', async () => {
    // "two" is in one unit's name and the other's ward; the Kano unit and unit one do not match
    const res = await search('Lagos test-ward two').expect(200);
    expect(res.body.map((u: { code: string }) => u.code).sort()).toEqual(['24-98-01-002', '24-98-02-001']);
  });

  it('narrows to one state', async () => {
    const res = await search('test unit', '&state=19').expect(200);
    expect(res.body.map((u: { code: string }) => u.code)).toEqual([TEST_UNIT_OUTSIDE_LAGOS]);
  });

  it('returns nothing when a word matches no unit, and refuses one-letter queries', async () => {
    expect((await search('test unit zanzibar').expect(200)).body).toEqual([]);
    await search('t').expect(400);
  });

  it('normalises punctuation the same way as the register', () => {
    expect(normaliseForSearch("St. John's  Pry/Sch, (Ikeja)")).toBe('st johns pry sch ikeja');
  });

  it('accepts the abbreviations the register uses', () => {
    expect(searchForms('school')).toEqual(['school', 'sch']);
    expect(searchForms('pry')).toEqual(['pry', 'primary', 'pri', 'prim']);
    expect(searchForms('st')).toEqual(['st', 'street', 'saint']);
    expect(searchForms('apapa')).toEqual(['apapa']);
  });

  it('matches words from their start, not inside other words', async () => {
    // "nit" is inside "unit" but starts no word
    expect((await search('test nit').expect(200)).body).toEqual([]);
    expect((await search('tes uni tw').expect(200)).body.map((u: { code: string }) => u.code)).toContain('24-98-01-002');
  });
});
