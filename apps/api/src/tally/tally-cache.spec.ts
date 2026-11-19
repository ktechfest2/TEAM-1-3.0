import { TallyService } from './tally.service.js';

/** Sprint 16: one computation per area at a time, never an outdated tally after a change */
describe('tally cache under load', () => {
  const setup = () => {
    const service = new TallyService(null as never, null as never);
    let calls = 0;
    const gates: ((v: unknown) => void)[] = [];
    (service as unknown as { compute: () => Promise<unknown> }).compute = () => {
      calls++;
      const n = calls;
      return new Promise((resolve) => gates.push(() => resolve({ n })));
    };
    const release = () => gates.shift()!(undefined);
    return { service, calls: () => calls, release };
  };
  const E = 'e1';

  it('shares one computation among everyone asking at once', async () => {
    const { service, calls, release } = setup();
    const asks = Array.from({ length: 50 }, () => service.area(E));
    expect(calls()).toBe(1);
    release();
    const results = await Promise.all(asks);
    expect(new Set(results).size).toBe(1);
    await service.area(E); // fresh: no new computation
    expect(calls()).toBe(1);
  });

  it('after a change, waits for a tally that includes it, even if one was already running', async () => {
    const { service, calls, release } = setup();
    const first = service.area(E);
    service.invalidate(E); // a unit changed while the first tally was being computed
    const second = service.area(E);
    expect(calls()).toBe(2);
    release();
    release();
    expect(await first).toEqual({ n: 1 });
    expect(await second).toEqual({ n: 2 });
    expect(await service.area(E)).toEqual({ n: 2 });
  });

  it('serves the last tally at once when it has only aged out', async () => {
    vi.useFakeTimers();
    try {
      const { service, calls, release } = setup();
      const p = service.area(E);
      release();
      await p;
      vi.advanceTimersByTime(6_000);
      expect(await service.area(E)).toEqual({ n: 1 }); // immediate, refresh in the background
      expect(calls()).toBe(2);
      release();
      await Promise.resolve();
      await Promise.resolve();
      expect(await service.area(E)).toEqual({ n: 2 });
    } finally {
      vi.useRealTimers();
    }
  });
});
