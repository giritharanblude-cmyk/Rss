import { afterEach, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from './test/helpers';

let context: TestContext;

afterEach(async () => {
  await context.app.close();
});

describe('origin secret', () => {
  it('rejects API calls without the secret when enforcement is on', async () => {
    context = await createTestContext({
      originSecret: 'origin-secret-value-123456',
      originSecretEnforced: true,
    });

    const missing = await context.app.inject({ method: 'GET', url: '/api/health' });
    expect(missing.statusCode).toBe(403);

    const wrong = await context.app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { 'x-origin-secret': 'not-the-secret' },
    });
    expect(wrong.statusCode).toBe(403);

    const accepted = await context.app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { 'x-origin-secret': 'origin-secret-value-123456' },
    });
    expect(accepted.statusCode).toBe(200);
  });

  it('ignores the secret when enforcement is off', async () => {
    context = await createTestContext();
    const response = await context.app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
  });
});

describe('protected routes', () => {
  it('rejects anonymous access to member routes', async () => {
    context = await createTestContext();
    const response = await context.app.inject({ method: 'GET', url: '/api/members' });
    expect(response.statusCode).toBe(401);
  });
});
