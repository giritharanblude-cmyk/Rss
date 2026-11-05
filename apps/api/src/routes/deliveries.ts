import type { FastifyInstance } from 'fastify';
import {
  deliveryListQuerySchema,
  sendNewsBodySchema,
  uuidParamsSchema,
} from '@healthcare/shared';
import type { AuthService } from '../auth/service';
import type { DeliveryRepository, DeliveryRecord } from '../delivery/types';
import type { DeliveryService } from '../delivery/service';
import { buildDeliveryWorkbook } from '../delivery/xlsx';
import { ForbiddenError, HttpError } from '../errors';
import { readUser } from './auth';

export type DeliveryRouteOptions = {
  auth: AuthService;
  jwtSecret: string;
  deliveries: DeliveryRepository;
  service: DeliveryService;
  now: () => Date;
};

function asDate(value: string, endOfDay = false): Date {
  return new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}+05:30`);
}

function requireMaster(role: string): void {
  if (role !== 'master') throw new ForbiddenError();
}

function toResponse(record: DeliveryRecord) {
  return {
    ...record,
    queuedAt: record.queuedAt.toISOString(),
    sentAt: record.sentAt?.toISOString() ?? null,
  };
}

function csvCell(value: string | number | null): string {
  const text = value === null ? '' : String(value);
  const safeText = /^[\t\r\n ]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safeText.replaceAll('"', '""')}"`;
}

export function registerDeliveryRoutes(app: FastifyInstance, options: DeliveryRouteOptions): void {
  app.get('/api/deliveries', async (request, reply) => {
    await readUser(request, options.auth, options.jwtSecret);
    const parsed = deliveryListQuerySchema.safeParse(request.query);
    if (!parsed.success) throw new HttpError(400, 'Check the delivery filters and try again.');
    const filters = parsed.data;
    const result = await options.deliveries.list({
      ...(filters.from ? { from: asDate(filters.from) } : {}),
      ...(filters.to ? { toExclusive: new Date(asDate(filters.to, true).getTime() + 1) } : {}),
      ...(filters.channel ? { channel: filters.channel } : {}),
      ...(filters.recipientId ? { recipientId: filters.recipientId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      page: filters.page,
      pageSize: filters.pageSize,
    });
    return reply.send({
      items: result.items.map(toResponse),
      page: filters.page,
      pageSize: filters.pageSize,
      total: result.total,
    });
  });

  app.get('/api/deliveries/export.csv', async (request, reply) => {
    await readUser(request, options.auth, options.jwtSecret);
    const parsed = deliveryListQuerySchema.safeParse(request.query);
    if (!parsed.success) throw new HttpError(400, 'Check the delivery filters and try again.');
    const filters = parsed.data;
    const dateFilters = {
      ...(filters.from ? { from: asDate(filters.from) } : {}),
      ...(filters.to ? { toExclusive: new Date(asDate(filters.to, true).getTime() + 1) } : {}),
      ...(filters.channel ? { channel: filters.channel } : {}),
      ...(filters.recipientId ? { recipientId: filters.recipientId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
    };
    const first = await options.deliveries.list({ ...dateFilters, page: 1, pageSize: 100 });
    if (first.total > 5000) {
      throw new HttpError(413, 'Narrow the filters to export at most 5,000 deliveries at once.');
    }
    const pages = await Promise.all(
      Array.from({ length: Math.ceil(first.total / 100) - 1 }, (_, index) =>
        options.deliveries.list({ ...dateFilters, page: index + 2, pageSize: 100 }),
      ),
    );
    const rows = [...first.items, ...pages.flatMap((page) => page.items)];
    const csv = [
      ['Time', 'Recipient', 'Contact', 'Channel', 'Kind', 'Status', 'Attempts', 'Error']
        .map(csvCell)
        .join(','),
      ...rows.map((row) =>
        [
          row.queuedAt.toISOString(),
          row.recipientName,
          row.recipientContact,
          row.channel,
          row.kind,
          row.status,
          row.attempts,
          row.lastError,
        ]
          .map(csvCell)
          .join(','),
      ),
    ].join('\r\n');
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="delivery-log.csv"')
      .send(`\uFEFF${csv}`);
  });

  app.get('/api/deliveries/export.xlsx', async (request, reply) => {
    await readUser(request, options.auth, options.jwtSecret);
    const parsed = deliveryListQuerySchema.safeParse(request.query);
    if (!parsed.success) throw new HttpError(400, 'Check the delivery filters and try again.');
    const filters = parsed.data;
    const dateFilters = {
      ...(filters.from ? { from: asDate(filters.from) } : {}),
      ...(filters.to ? { toExclusive: new Date(asDate(filters.to, true).getTime() + 1) } : {}),
      ...(filters.channel ? { channel: filters.channel } : {}),
      ...(filters.recipientId ? { recipientId: filters.recipientId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
    };
    const first = await options.deliveries.list({ ...dateFilters, page: 1, pageSize: 100 });
    if (first.total > 5000) {
      throw new HttpError(413, 'Narrow the filters to export at most 5,000 deliveries at once.');
    }
    const pages = await Promise.all(
      Array.from({ length: Math.ceil(first.total / 100) - 1 }, (_, index) =>
        options.deliveries.list({ ...dateFilters, page: index + 2, pageSize: 100 }),
      ),
    );
    const rows = [...first.items, ...pages.flatMap((page) => page.items)];
    const sheet = [
      ['Time', 'Recipient', 'Contact', 'Channel', 'Kind', 'Status', 'Attempts', 'Error'],
      ...rows.map((row) => [
        row.queuedAt.toISOString(),
        row.recipientName,
        row.recipientContact,
        row.channel,
        row.kind,
        row.status,
        row.attempts,
        row.lastError,
      ]),
    ];
    const workbook = buildDeliveryWorkbook(sheet);
    return reply
      .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('content-disposition', 'attachment; filename="delivery-log.xlsx"')
      .send(workbook);
  });

  app.post('/api/deliveries/:id/resend', async (request, reply) => {
    const user = await readUser(request, options.auth, options.jwtSecret);
    requireMaster(user.role);
    const params = uuidParamsSchema.safeParse(request.params);
    if (!params.success) throw new HttpError(400, 'Check the delivery id and try again.');
    if (!(await options.deliveries.retryFailed(params.data.id, options.now()))) {
      throw new HttpError(409, 'Only failed deliveries can be resent.');
    }
    return reply.code(202).send({ status: 'queued' });
  });

  app.post('/api/news/:id/send', async (request, reply) => {
    const user = await readUser(request, options.auth, options.jwtSecret);
    requireMaster(user.role);
    const params = uuidParamsSchema.safeParse(request.params);
    const body = sendNewsBodySchema.safeParse(request.body);
    if (!params.success || !body.success) {
      throw new HttpError(400, 'Check the news item and channel and try again.');
    }
    const queued = await options.service.sendNow(params.data.id, body.data.channel);
    return reply.code(202).send({ queued });
  });
}
