import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { z } from 'zod';
import { parseOrThrow } from '../common/validation.js';
import { GeographyService } from './geography.service.js';

const CODE = /^[\d-]{2,12}$/;

/** Public, read-only access to the polling unit register. */
@Controller('geo')
export class GeographyController {
  constructor(private readonly geo: GeographyService) {}

  @Get('summary')
  @Header('Cache-Control', 'public, max-age=300')
  summary() {
    return this.geo.counts();
  }

  @Get('states')
  @Header('Cache-Control', 'public, max-age=300')
  states() {
    return this.geo.listStates();
  }

  @Get('states/:code/lgas')
  @Header('Cache-Control', 'public, max-age=300')
  lgas(@Param('code') code: string) {
    return CODE.test(code) ? this.geo.listLgas(code) : [];
  }

  @Get('lgas/:code/wards')
  @Header('Cache-Control', 'public, max-age=300')
  wards(@Param('code') code: string) {
    return CODE.test(code) ? this.geo.listWards(code) : [];
  }

  @Get('wards/:code/units')
  @Header('Cache-Control', 'public, max-age=300')
  units(@Param('code') code: string) {
    return CODE.test(code) ? this.geo.listUnits(code) : [];
  }

  /** Address search: GET /geo/search?q=badagry road apapa&state=24&limit=20 */
  @Get('search')
  @Header('Cache-Control', 'public, max-age=300')
  search(@Query() query: unknown) {
    const q = parseOrThrow(
      z.object({
        q: z.string().trim().min(2).max(100),
        state: z.string().regex(/^\d{2}$/).optional(),
        limit: z.coerce.number().int().min(1).max(50).default(20),
      }),
      query,
    );
    return this.geo.search(q.q, { state: q.state, limit: q.limit });
  }

  @Get('units/:code')
  @Header('Cache-Control', 'public, max-age=300')
  unit(@Param('code') code: string) {
    return this.geo.getUnit(code);
  }
}
