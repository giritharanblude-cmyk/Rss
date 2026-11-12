import type { FastifyInstance } from 'fastify';
import { emailTestBodySchema, maskEmail, smtpSettingsSchema } from '@healthcare/shared';
import type { AuthService } from '../auth/service';
import type { ConnectionMonitor } from '../delivery/connections';
import type { WhatsAppAdapter } from '../delivery/whatsapp';
import type { ManagedEmailSender } from '../email/managed';
import type { SettingsRepository } from '../repositories/settings';
import { encryptSettings } from '../settings/secrets';
import { ForbiddenError, HttpError } from '../errors';
import { readUser } from './auth';

export type SettingsRouteOptions = {
  auth: AuthService;
  jwtSecret: string;
  monitor: ConnectionMonitor;
  whatsapp: WhatsAppAdapter;
  email: ManagedEmailSender;
  settings: SettingsRepository;
  encryptionKey?: string;
};

export function registerSettingsRoutes(app: FastifyInstance, options: SettingsRouteOptions): void {
  const getPublicSettings = () => {
    const settings = options.email.getPublicSettings();
    return settings
      ? {
          ...settings,
          user: maskEmail(settings.user),
          fromEmail: maskEmail(settings.fromEmail),
        }
      : null;
  };

  app.get('/api/settings/connections', async (request, reply) => {
    const user = await readUser(request, options.auth, options.jwtSecret);
    const connections = await options.monitor.check();
    return reply.send({
      connections:
        user.role === 'master'
          ? connections
          : connections.map((connection) => ({ ...connection, detail: null })),
    });
  });

  app.get('/api/settings/email', async (request, reply) => {
    const user = await readUser(request, options.auth, options.jwtSecret);
    if (user.role !== 'master') throw new ForbiddenError();
    return reply.send({
      settings: getPublicSettings(),
      passwordConfigured: options.email.hasPassword(),
    });
  });

  app.put('/api/settings/email', async (request, reply) => {
    const user = await readUser(request, options.auth, options.jwtSecret);
    if (user.role !== 'master') throw new ForbiddenError();
    const parsed = smtpSettingsSchema.safeParse(request.body);
    if (!parsed.success) throw new HttpError(400, 'Check the SMTP settings and try again.');
    if (!options.encryptionKey) {
      throw new HttpError(503, 'Set SETTINGS_ENCRYPTION_KEY before saving email credentials.');
    }
    const encoded = encryptSettings(JSON.stringify(parsed.data), options.encryptionKey);
    await options.settings.set('smtp_transport', encoded);
    options.email.configure(parsed.data);
    return reply.send({
      settings: getPublicSettings(),
      passwordConfigured: true,
    });
  });

  app.post('/api/settings/email/test', async (request, reply) => {
    const user = await readUser(request, options.auth, options.jwtSecret);
    if (user.role !== 'master') throw new ForbiddenError();
    const parsed = emailTestBodySchema.safeParse(request.body);
    if (!parsed.success) throw new HttpError(400, 'Enter a valid test email address.');
    await options.email.send({
      to: parsed.data.to,
      subject: 'Healthcare News email connection test',
      text: 'Your Healthcare News email connection is working.',
      html: '<p>Your Healthcare News email connection is working.</p>',
    });
    return reply.send({ status: 'sent' });
  });

  app.post('/api/settings/connections/check', async (request, reply) => {
    const user = await readUser(request, options.auth, options.jwtSecret);
    if (user.role !== 'master') throw new ForbiddenError();
    return reply.send({ connections: await options.monitor.check() });
  });

  app.post('/api/settings/whatsapp/connect', async (request, reply) => {
    const user = await readUser(request, options.auth, options.jwtSecret);
    if (user.role !== 'master') throw new ForbiddenError();
    await options.whatsapp.connect();
    return reply.send({ status: await options.whatsapp.getStatus() });
  });

  app.post('/api/settings/whatsapp/logout', async (request, reply) => {
    const user = await readUser(request, options.auth, options.jwtSecret);
    if (user.role !== 'master') throw new ForbiddenError();
    await options.whatsapp.logout();
    await options.monitor.check();
    return reply.send({ status: await options.whatsapp.getStatus() });
  });
}
