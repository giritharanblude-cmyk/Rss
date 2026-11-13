import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import {
  newsListQuerySchema,
  updateNewsImportantBodySchema,
  uuidParamsSchema,
} from '@healthcare/shared';
import type { AuthService } from '../auth/service';
import type { DashboardNewsItem, DashboardRepository } from '../repositories/dashboard';
import type { DeliveryService } from '../delivery/service';
import { ForbiddenError, HttpError } from '../errors';
import { readUser } from './auth';

export type DashboardRouteOptions = {
  auth: AuthService;
  jwtSecret: string;
  dashboard: DashboardRepository;
  deliveryService: DeliveryService;
  now: () => Date;
};

function localDateStart(value: string): Date {
  return new Date(`${value}T00:00:00+05:30`);
}

function localDateAfter(value: string): Date {
  const date = localDateStart(value);
  date.setUTCDate(date.getUTCDate() + 1);
  return date;
}

function todayStart(now: Date): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const localDate = `${values.get('year')}-${values.get('month')}-${values.get('day')}`;
  return localDateStart(localDate);
}

function toResponseItem(item: DashboardNewsItem) {
  return {
    ...item,
    publishedAt: item.publishedAt?.toISOString() ?? null,
    fetchedAt: item.fetchedAt.toISOString(),
  };
}

export function registerDashboardRoutes(
  app: FastifyInstance,
  options: DashboardRouteOptions,
): void {
  app.get('/api/dashboard/live', async (request, reply) => {
    const user = await readUser(request, options.auth, options.jwtSecret);
    const summary = await options.dashboard.getSummary(
      todayStart(options.now()),
      5,
      user.role === 'master' ? undefined : user.id,
    );
    const payload = {
      ...summary,
      latestItems: summary.latestItems.map(toResponseItem),
      lastFetchAt: summary.lastFetchAt?.toISOString() ?? null,
    };
    const etag = `"${createHash('sha256').update(JSON.stringify(payload)).digest('hex')}"`;
    reply.header('ETag', etag).header('Cache-Control', 'private, no-cache');
    const requestEtag = request.headers['if-none-match'];
    if (
      typeof requestEtag === 'string' &&
      requestEtag
        .split(',')
        .map((value) => value.trim())
        .includes(etag)
    ) {
      return reply.code(304).send();
    }
    return reply.send(payload);
  });

  app.get('/api/news', async (request, reply) => {
    const user = await readUser(request, options.auth, options.jwtSecret);
    const query = newsListQuerySchema.safeParse(request.query);
    if (!query.success) throw new HttpError(400, 'Check the news filters and try again.');
    const filters = query.data;
    const result = await options.dashboard.listNews({
      ...(filters.category ? { category: filters.category } : {}),
      ...(filters.sourceId ? { sourceId: filters.sourceId } : {}),
      ...(filters.from ? { from: localDateStart(filters.from) } : {}),
      ...(filters.to ? { toExclusive: localDateAfter(filters.to) } : {}),
      ...(filters.q ? { query: filters.q } : {}),
      ownerUserId: user.role === 'master' ? undefined : user.id,
      page: filters.page,
      pageSize: filters.pageSize,
    });
    return reply.send({
      items: result.items.map(toResponseItem),
      page: filters.page,
      pageSize: filters.pageSize,
      total: result.total,
    });
  });

  app.patch('/api/news/:id/important', async (request, reply) => {
    const user = await readUser(request, options.auth, options.jwtSecret);
    if (user.role !== 'master') throw new ForbiddenError();
    const params = uuidParamsSchema.safeParse(request.params);
    const body = updateNewsImportantBodySchema.safeParse(request.body);
    if (!params.success || !body.success) {
      throw new HttpError(400, 'Check the news item and importance value.');
    }
    if (!(await options.dashboard.setImportant(params.data.id, body.data.important))) {
      throw new HttpError(404, 'That news item was not found.');
    }
    const queued = body.data.important
      ? await options.deliveryService.sendInstantForItem(params.data.id)
      : 0;
    return reply.send({ id: params.data.id, important: body.data.important, queued });
  });
}
