import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { EC60E_JSON_SCHEMA, EC60E_PROMPT, ec60eReadingSchema, type Ec60eReading } from './reading.js';

/** Reads an EC60E photo. Tests replace this with a fake. */
export abstract class VisionModel {
  abstract readonly name: string;
  abstract read(image: Buffer, mimeType: string, context: string): Promise<Ec60eReading>;
}

/** Thrown for failures worth retrying later (network, rate limit, provider error). */
export class TemporaryAiError extends Error {}

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

/** Vision model through OpenRouter's chat completions API, with strict JSON output. */
@Injectable()
export class OpenRouterVisionModel extends VisionModel {
  private readonly logger = new Logger('OpenRouter');

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly http: typeof fetch = fetch,
  ) {
    super();
  }

  get name(): string {
    return this.config.get('OPENROUTER_MODEL', { infer: true });
  }

  async read(image: Buffer, mimeType: string, context: string): Promise<Ec60eReading> {
    const apiKey = this.config.get('OPENROUTER_API_KEY', { infer: true });
    if (!apiKey) throw new TemporaryAiError('OPENROUTER_API_KEY is not set');

    let res: Response;
    try {
      res = await this.http(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'X-Title': 'TrustElect',
        },
        body: JSON.stringify({
          model: this.name,
          temperature: 0,
          max_tokens: 2000,
          // Keep election photos out of provider training and logging where possible
          provider: { data_collection: 'deny' },
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'ec60e_reading', strict: true, schema: EC60E_JSON_SCHEMA },
          },
          messages: [
            { role: 'system', content: EC60E_PROMPT },
            {
              role: 'user',
              content: [
                { type: 'text', text: context },
                { type: 'image_url', image_url: { url: `data:${mimeType};base64,${image.toString('base64')}` } },
              ],
            },
          ],
        }),
        signal: AbortSignal.timeout(90_000),
      });
    } catch (err) {
      throw new TemporaryAiError(`request failed: ${(err as Error).message}`);
    }

    const data = (await res.json().catch(() => ({}))) as {
      choices?: { message?: { content?: string } }[];
      error?: { message?: string };
    };
    if (!res.ok) {
      const message = data.error?.message ?? `HTTP ${res.status}`;
      this.logger.warn(`model error: ${message}`);
      throw new TemporaryAiError(message);
    }

    const content = data.choices?.[0]?.message?.content ?? '';
    let parsed: unknown;
    try {
      parsed = JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, ''));
    } catch {
      throw new TemporaryAiError('model did not return JSON');
    }
    const reading = ec60eReadingSchema.safeParse(parsed);
    if (!reading.success) throw new TemporaryAiError('model output did not match the schema');
    return reading.data;
  }
}
