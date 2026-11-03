import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { feedTestInputSchema, sourceInputSchema, sourceSchema } from '@healthcare/shared';
import type { AuthService } from '../auth/service';
import type { FeedTestQueue } from '../rss/background';
import type { SourceRepository, SourceRecord } from '../repositories/feeds';
import { ForbiddenError, HttpError } from '../errors';
import { parseBody, readUser } from './auth';

export type SourceRouteOptions = {
  auth: AuthService;
  jwtSecret: string;
  sources: SourceRepository;
  tests: FeedTestQueue;
};

function toSourceResponse(source: SourceRecord) {
  return sourceSchema.parse({
    ...source,
    lastFetchedAt: source.lastFetchedAt?.toISOString() ?? null,
    createdAt: source.createdAt.toISOString(),
  });
}

async function requireMaster(
  request: Parameters<typeof readUser>[0],
  options: SourceRouteOptions,
): Promise<void> {
  const user = await readUser(request, options.auth, options.jwtSecret);
  if (user.role !== 'master') throw new ForbiddenError();
}

export function registerSourceRoutes(app: FastifyInstance, options: SourceRouteOptions): void {
  app.get('/api/sources', async (request, reply) => {
    await readUser(request, options.auth, options.jwtSecret);
    const sources = await options.sources.listSources();
    return reply.send({ sources: sources.map(toSourceResponse) });
  });

  app.post('/api/sources', async (request, reply) => {
    await requireMaster(request, options);
    const body = parseBody(sourceInputSchema, request.body);
    const source = await options.sources.createSource(body);
    return reply.code(201).send({ source: toSourceResponse(source) });
  });

  app.patch('/api/sources/:id', async (request, reply) => {
    await requireMaster(request, options);
    const { id } = request.params as { id: string };
    const updates = parseBody(sourceInputSchema.partial(), request.body);
    const source = await options.sources.updateSource(id, updates);
    if (!source) throw new HttpError(404, 'That source was not found.');
    return reply.send({ source: toSourceResponse(source) });
  });

  app.delete('/api/sources/:id', async (request, reply) => {
    await requireMaster(request, options);
    const { id } = request.params as { id: string };
    if (!(await options.sources.deleteSource(id))) {
      throw new HttpError(404, 'That source was not found.');
    }
    return reply.code(204).send();
  });

  app.post('/api/sources/test', async (request, reply) => {
    await requireMaster(request, options);
    const body = parseBody(feedTestInputSchema, request.body);
    return reply.code(202).send(await options.tests.enqueue(body.rssUrl));
  });

  app.get('/api/sources/test/:id', async (request, reply) => {
    await requireMaster(request, options);
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) throw new HttpError(400, 'Check the feed test id.');
    const { id } = params.data;
    const job = await options.tests.get(id);
    if (!job) throw new HttpError(404, 'That feed test was not found.');
    return reply.send(job);
  });
}
