import Fastify, { type FastifyInstance } from 'fastify';
import { healthResponseSchema, type HealthResponse } from '@healthcare/shared';

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get('/api/health', async (): Promise<HealthResponse> => {
    const payload = {
      status: 'ok' as const,
      service: 'healthcare-rss-api',
      version: '0.0.0',
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };

    return healthResponseSchema.parse(payload);
  });

  return app;
}
