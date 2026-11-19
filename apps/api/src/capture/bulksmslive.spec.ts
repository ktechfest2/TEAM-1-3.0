import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { BULKSMSLIVE_URL, BulkSmsLiveSender } from './bulksmslive.js';

/** No real requests: fetch is replaced by a stub that records the call. */
function setup(response: { status: number; body: unknown }, settings: Partial<Env> = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const http = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(response.body), { status: response.status });
  }) as unknown as typeof fetch;
  const values: Partial<Env> = { BULKSMSLIVE_API_KEY: 'test-key', SMS_SENDER_NAME: 'TrustElect', ...settings };
  const config = { get: (k: keyof Env) => values[k] } as unknown as ConfigService<Env, true>;
  return { sender: new BulkSmsLiveSender(config, http), calls };
}

describe('BulkSmsLiveSender', () => {
  it('posts the message with the API key, sender name and 234 number', async () => {
    const { sender, calls } = setup({ status: 200, body: { status: 1, msgid: 'a1', units: 2, balance: 100 } });
    await sender.send('+2348031234567', 'Your TrustElect code is 123456.');

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(BULKSMSLIVE_URL);
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer test-key');
    const body = new URLSearchParams(calls[0].init.body as string);
    expect(body.get('recipients')).toBe('2348031234567');
    expect(body.get('sender_name')).toBe('TrustElect');
    expect(body.get('message')).toBe('Your TrustElect code is 123456.');
    expect(body.get('forcednd')).toBe('1');
  });

  it('fails clearly on provider errors such as insufficient units', async () => {
    const { sender } = setup({ status: 200, body: { status: -7, msg: 'Insufficient unit' } });
    await expect(sender.send('+2348031234567', 'x')).rejects.toThrow(/Could not send the SMS/);
  });

  it('fails on an invalid API key', async () => {
    const { sender } = setup({ status: 401, body: { message: 'Unauthenticated.' } });
    await expect(sender.send('+2348031234567', 'x')).rejects.toThrow(/Could not send the SMS/);
  });

  it('refuses to send without an API key', async () => {
    const { sender, calls } = setup({ status: 200, body: { status: 1 } }, { BULKSMSLIVE_API_KEY: undefined });
    await expect(sender.send('+2348031234567', 'x')).rejects.toThrow(/not configured/);
    expect(calls).toHaveLength(0);
  });
});
