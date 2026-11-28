import { describe, expect, it, vi } from 'vitest';
import type { DeliveryService } from './service';
import { startDigestScheduler } from './background';

describe('digest scheduler startup', () => {
  it('schedules digests immediately before running pending deliveries', async () => {
    const calls: string[] = [];
    let finishRun!: () => void;
    const runFinished = new Promise<void>((resolve) => {
      finishRun = resolve;
    });
    const service = {
      scheduleDigests: vi.fn(async () => {
        calls.push('scheduleDigests');
        return 1;
      }),
      runPending: vi.fn(async () => {
        calls.push('runPending');
        finishRun();
      }),
    } as unknown as DeliveryService;
    const stop = startDigestScheduler(service, () => undefined);

    try {
      await runFinished;
      expect(calls).toEqual(['scheduleDigests', 'runPending']);
    } finally {
      stop();
    }
  });
});
