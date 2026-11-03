import { afterEach, describe, expect, it } from 'vitest';
import { healthResponseSchema } from '@healthcare/shared';
import { buildApp } from './app';

const app = buildApp();

afterEach(async () => {
  await app.close();
});

describe('GET /api/health', () => {
  it('returns a valid health payload', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(200);
    expect(() => healthResponseSchema.parse(response.json())).not.toThrow();
  });
});
