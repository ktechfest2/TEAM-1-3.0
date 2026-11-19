import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { modelThatRead, OpenRouterVisionModel } from '../verification/vision-model.js';
import { routeModels } from './openrouter.js';

describe('model fallback (Sprint 16 degraded modes)', () => {
  it('asks OpenRouter for the primary and then the fallback', () => {
    expect(routeModels('a/primary', 'b/fallback')).toEqual({ models: ['a/primary', 'b/fallback'] });
    expect(routeModels('a/primary', 'none')).toEqual({ model: 'a/primary' });
    expect(routeModels('a/primary', 'a/primary')).toEqual({ model: 'a/primary' });
  });

  it('sends both models and records which one actually read the photo', async () => {
    const env: Partial<Env> = { OPENROUTER_API_KEY: 'k', OPENROUTER_MODEL: 'a/primary', OPENROUTER_FALLBACK_MODEL: 'b/fallback' };
    const config = { get: (k: keyof Env) => env[k] } as unknown as ConfigService<Env, true>;
    const reading = {
      is_ec60e: true, document_description: 'EC60E', image_quality: 'good', stamp_visible: true, signature_present: true,
      election_type_on_form: null, polling_unit_code: null, polling_unit_name: null,
      party_results: [{ party: 'AA', votes: 1, legible: true }], total_valid_votes: 1, rejected_votes: null, total_votes_cast: null, notes: '',
    };
    let sent: Record<string, unknown> = {};
    const http = (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ model: 'b/fallback', choices: [{ message: { content: JSON.stringify(reading) } }] }));
    }) as typeof fetch;
    const model = new OpenRouterVisionModel(config, http);
    const result = await model.read(Buffer.from('x'), 'image/jpeg', 'ctx');
    expect(sent.models).toEqual(['a/primary', 'b/fallback']);
    expect(sent.model).toBeUndefined();
    expect(modelThatRead(result, model.name)).toBe('b/fallback');
  });
});
