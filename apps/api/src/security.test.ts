import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from './config';
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

  it('requires origin-secret enforcement and a secret in production config', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://db.example.test/app',
        JWT_SECRET: 'test-secret-value-with-at-least-32-chars',
        ORIGIN_SECRET: 'origin-secret-value-123456',
        ORIGIN_SECRET_ENFORCED: 'false',
      }),
    ).toThrow('ORIGIN_SECRET_ENFORCED must be true in production');

    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://db.example.test/app',
        JWT_SECRET: 'test-secret-value-with-at-least-32-chars',
        ORIGIN_SECRET: 'origin-secret-value-123456',
        ORIGIN_SECRET_ENFORCED: 'true',
        PUBLIC_APP_ORIGIN: 'https://news.example.test',
      }),
    ).not.toThrow();
  });
});

describe('protected routes', () => {
  it('rejects anonymous access to member routes', async () => {
    context = await createTestContext();
    const response = await context.app.inject({ method: 'GET', url: '/api/members' });
    expect(response.statusCode).toBe(401);
  });
});
