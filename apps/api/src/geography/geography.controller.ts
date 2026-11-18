import { Controller, Get, Header, Param } from '@nestjs/common';
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

  @Get('units/:code')
  @Header('Cache-Control', 'public, max-age=300')
  unit(@Param('code') code: string) {
    return this.geo.getUnit(code);
  }
}
