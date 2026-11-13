import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import {
  alertPreviewInputSchema,
  alertRuleInputSchema,
  consentUpdateSchema,
  listPaginationQuerySchema,
  publicTokenParamsSchema,
  publicTopicsUpdateSchema,
  recipientListQuerySchema,
  recipientInputSchema,
  recipientSchema,
  uuidParamsSchema,
  maskEmail,
  maskPhone,
} from '@healthcare/shared';
import type { AuthService } from '../auth/service';
import type { AlertPreviewService } from '../alerts/preview';
import { HttpError } from '../errors';
import type {
  AlertRuleRecord,
  AlertRuleRepository,
  RecipientRecord,
  RecipientRepository,
} from '../repositories/recipients';
import { parseBody, readUser } from './auth';
import { paginate } from './pagination';

export type RecipientRouteOptions = {
  auth: AuthService;
  jwtSecret: string;
  recipients: RecipientRepository;
  rules: AlertRuleRepository;
  previews: AlertPreviewService;
  now: () => Date;
};

function toRecipientResponse(recipient: RecipientRecord) {
  return recipientSchema.parse({
    id: recipient.id,
    name: recipient.name,
    whatsappE164: recipient.whatsappE164 ? maskPhone(recipient.whatsappE164) : null,
    hasWhatsapp: recipient.whatsappE164 !== null,
    email: recipient.email ? maskEmail(recipient.email) : null,
    hasEmail: recipient.email !== null,
    topics: recipient.topics,
    channel: recipient.channel,
    consentStatus: recipient.consentStatus,
    consentAt: recipient.consentAt?.toISOString() ?? null,
    consentNote: recipient.consentNote,
    createdAt: recipient.createdAt.toISOString(),
  });
}

function toRuleResponse(rule: AlertRuleRecord) {
  return {
    ...rule,
    createdAt: rule.createdAt.toISOString(),
  };
}

function readId(request: Parameters<typeof readUser>[0]): string {
  const parsed = uuidParamsSchema.safeParse(request.params);
  if (!parsed.success) throw new HttpError(400, 'Check the id and try again.');
  return parsed.data.id;
}

function validateTimezone<T extends { timezone: string }>(value: T): T {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value.timezone });
  } catch {
    throw new HttpError(400, 'Choose a supported timezone.');
  }
  return value;
}

export function registerRecipientRoutes(
  app: FastifyInstance,
  options: RecipientRouteOptions,
): void {
  app.get('/api/recipients', async (request, reply) => {
    const user = await readUser(request, options.auth, options.jwtSecret);
    const query = recipientListQuerySchema.safeParse(request.query);
    if (!query.success) throw new HttpError(400, 'Check the search text and try again.');
    const recipients = await options.recipients.listRecipients(
      query.data.q,
      user.role === 'master' ? undefined : user.id,
    );
    const page = paginate(recipients, query.data.page, query.data.pageSize);
    return reply.send({
      recipients: page.items.map(toRecipientResponse),
      page: page.page,
      pageSize: page.pageSize,
      total: page.total,
    });
  });

  app.post('/api/recipients', async (request, reply) => {
    const user = await readUser(request, options.auth, options.jwtSecret);
    const input = parseBody(recipientInputSchema, request.body);
    const recipient = await options.recipients.createRecipient(
      input,
      randomBytes(32).toString('hex'),
      user.id,
    );
    return reply.code(201).send({ recipient: toRecipientResponse(recipient) });
  });

  app.patch('/api/recipients/:id', async (request, reply) => {
    const user = await readUser(request, options.auth, options.jwtSecret);
    const id = readId(request);
    const input = parseBody(recipientInputSchema, request.body);
    const recipient = await options.recipients.updateRecipient(
      id,
      input,
      user.role === 'master' ? undefined : user.id,
    );
    if (!recipient) throw new HttpError(404, 'That recipient was not found.');
    return reply.send({ recipient: toRecipientResponse(recipient) });
  });

  app.patch('/api/recipients/:id/consent', async (request, reply) => {
    const user = await readUser(request, options.auth, options.jwtSecret);
    const id = readId(request);
    const body = parseBody(consentUpdateSchema, request.body);
    const recipient = await options.recipients.setConsent(
      id,
      body.status,
      options.now(),
      body.status === 'pending' ? null : body.note?.trim() || null,
      user.role === 'master' ? undefined : user.id,
    );
    if (!recipient) throw new HttpError(404, 'That recipient was not found.');
    return reply.send({ recipient: toRecipientResponse(recipient) });
  });

  app.delete('/api/recipients/:id', async (request, reply) => {
    const user = await readUser(request, options.auth, options.jwtSecret);
    if (
      !(await options.recipients.deleteRecipient(
        readId(request),
        user.role === 'master' ? undefined : user.id,
      ))
    ) {
      throw new HttpError(404, 'That recipient was not found.');
    }
    return reply.code(204).send();
  });

  app.get('/api/alert-rules', async (request, reply) => {
    const user = await readUser(request, options.auth, options.jwtSecret);
    const query = listPaginationQuerySchema.safeParse(request.query);
    if (!query.success) throw new HttpError(400, 'Check the alert-rule page and page size.');
    const rules = await options.rules.listAlertRules(
      user.role === 'master' ? undefined : user.id,
    );
    const page = paginate(rules, query.data.page, query.data.pageSize);
    return reply.send({
      rules: page.items.map(toRuleResponse),
      page: page.page,
      pageSize: page.pageSize,
      total: page.total,
    });
  });

  app.post('/api/alert-rules', async (request, reply) => {
    const user = await readUser(request, options.auth, options.jwtSecret);
    const rule = validateTimezone(parseBody(alertRuleInputSchema, request.body));
    const created = await options.rules.createAlertRule(rule, user.id);
    return reply.code(201).send({ rule: toRuleResponse(created) });
  });

  app.patch('/api/alert-rules/:id', async (request, reply) => {
    const user = await readUser(request, options.auth, options.jwtSecret);
    const id = readId(request);
    const rule = validateTimezone(parseBody(alertRuleInputSchema, request.body));
    const updated = await options.rules.updateAlertRule(
      id,
      rule,
      user.role === 'master' ? undefined : user.id,
    );
    if (!updated) throw new HttpError(404, 'That alert rule was not found.');
    return reply.send({ rule: toRuleResponse(updated) });
  });

  app.delete('/api/alert-rules/:id', async (request, reply) => {
    const user = await readUser(request, options.auth, options.jwtSecret);
    if (
      !(await options.rules.deleteAlertRule(
        readId(request),
        user.role === 'master' ? undefined : user.id,
      ))
    ) {
      throw new HttpError(404, 'That alert rule was not found.');
    }
    return reply.code(204).send();
  });

  app.post('/api/alert-rules/preview', async (request, reply) => {
    const user = await readUser(request, options.auth, options.jwtSecret);
    const input = parseBody(alertPreviewInputSchema, request.body);
    if (input.rule) validateTimezone(input.rule);
    return reply.send(
      await options.previews.build(input, user.role === 'master' ? undefined : user.id),
    );
  });

  app.get('/api/public/preferences/:token', async (request, reply) => {
    const token = readPublicToken(request);
    const recipient = await options.recipients.findByUnsubscribeToken(token);
    if (!recipient) throw new HttpError(404, 'This preferences link is invalid or has expired.');
    return reply.send({ name: recipient.name, topics: recipient.topics });
  });

  app.patch('/api/public/preferences/:token', async (request, reply) => {
    const token = readPublicToken(request);
    const input = parseBody(publicTopicsUpdateSchema, request.body);
    const recipient = await options.recipients.updateTopicsByToken(token, input.topics);
    if (!recipient) throw new HttpError(404, 'This preferences link is invalid or has expired.');
    return reply.send({ name: recipient.name, topics: recipient.topics });
  });

  app.post('/api/public/unsubscribe/:token', async (request, reply) => {
    const token = readPublicToken(request);
    const recipient = await options.recipients.findByUnsubscribeToken(token);
    if (!recipient) throw new HttpError(404, 'This unsubscribe link is invalid or has expired.');
    if (recipient.consentStatus !== 'revoked') {
      await options.recipients.setConsent(
        recipient.id,
        'revoked',
        options.now(),
        'Unsubscribed using the public unsubscribe link',
      );
    }
    return reply.send({ status: 'unsubscribed', name: recipient.name });
  });
}

function readPublicToken(request: Parameters<typeof readUser>[0]): string {
  const params = publicTokenParamsSchema.safeParse(request.params);
  if (!params.success) throw new HttpError(404, 'This link is invalid or has expired.');
  return params.data.token;
}
