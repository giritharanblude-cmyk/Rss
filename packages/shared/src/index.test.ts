import { describe, expect, it } from 'vitest';
import { healthResponseSchema } from './index';

describe('healthResponseSchema', () => {
  it('accepts a valid health response', () => {
    const result = healthResponseSchema.safeParse({
      status: 'ok',
      service: 'healthcare-rss-api',
      version: '0.0.0',
      uptimeSeconds: 12,
      timestamp: '2026-11-03T00:00:00.000Z',
    });

    expect(result.success).toBe(true);
  });

  it('rejects a response with a wrong status', () => {
    const result = healthResponseSchema.safeParse({
      status: 'down',
      service: 'healthcare-rss-api',
      version: '0.0.0',
      uptimeSeconds: 12,
      timestamp: '2026-11-03T00:00:00.000Z',
    });

    expect(result.success).toBe(false);
  });
});
