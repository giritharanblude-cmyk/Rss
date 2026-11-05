import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

export type OriginSecretOptions = {
  secret?: string;
  enforced: boolean;
};

function safeEqual(expected: string, received: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }
  return timingSafeEqual(expectedBuffer, receivedBuffer);
}

export function registerOriginSecret(
  app: FastifyInstance,
  options: OriginSecretOptions,
): void {
  if (!options.enforced) {
    return;
  }
  if (!options.secret) {
    throw new Error('Origin secret enforcement requires ORIGIN_SECRET');
  }
  const expected = options.secret;

  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api')) {
      return;
    }
    const header = request.headers['x-origin-secret'];
    const received = Array.isArray(header) ? header[0] : header;
    if (!received || !safeEqual(expected, received)) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
  });
}
