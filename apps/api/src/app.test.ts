import { afterEach, describe, expect, it } from 'vitest';
import { healthResponseSchema } from '@healthcare/shared';
import { createTestContext, type TestContext } from './test/helpers';

let context: TestContext;

afterEach(async () => {
  await context.app.close();
});

describe('GET /api/health', () => {
  it('returns a valid health payload', async () => {
    context = await createTestContext();
    const response = await context.app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(200);
    expect(() => healthResponseSchema.parse(response.json())).not.toThrow();
    expect(response.json()).toMatchObject({ databaseSizeBytes: 0 });
  });

  it('reports the database size provided by the database adapter', async () => {
    context = await createTestContext({ databaseSizeBytes: async () => 734_003_200 });
    const response = await context.app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ databaseSizeBytes: 734_003_200 });
  });
});
