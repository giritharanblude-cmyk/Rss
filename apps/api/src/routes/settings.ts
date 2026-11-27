import type { FastifyInstance } from 'fastify';
import { maskEmail, smtpSettingsSchema } from '@healthcare/shared';
import type { AuthService } from '../auth/service';
import type { ConnectionMonitor } from '../delivery/connections';
import type { WhatsAppAdapter } from '../delivery/whatsapp';
import type { ManagedEmailSender } from '../email/managed';
import type { SettingsRepository } from '../repositories/settings';
import { encryptSettings } from '../settings/secrets';
import { ForbiddenError, HttpError } from '../errors';
import { redactLogText } from '../logging';
import { readUser } from './auth';

const WHATSAPP_TEST_SEND_TIMEOUT_MS = 20_000;

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

  const whatsappTestFailureReason = (error: unknown, phone: string, email: string): string => {
    const reason =
      error instanceof Error && error.message.trim() ? error.message.trim() : 'Unknown OpenWA error.';
    return redactLogText(reason)
      .replaceAll(phone, '[REDACTED-PHONE]')
      .replaceAll(email, '[REDACTED-EMAIL]')
      .replace(
        /\b(?:api[_ -]?key|openwa[_ -]?key|access[_ -]?token|secret)\s*[:=]\s*\S+/gi,
        '[REDACTED-CREDENTIAL]',
      );
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
    if (!user.email?.trim()) {
      throw new HttpError(400, 'No email address is saved for your account.');
    }
    let emailConnected: boolean;
    try {
      emailConnected = (await options.email.verify()).ok;
    } catch {
      emailConnected = false;
    }
    if (!emailConnected) {
      throw new HttpError(503, 'Email is not connected. Check SMTP settings and try again.');
    }
    try {
      await options.email.send({
        to: user.email,
        subject: 'Healthcare News email connection test',
        text: 'Your Healthcare News email connection is working.',
        html: '<p>Your Healthcare News email connection is working.</p>',
      });
    } catch {
      throw new HttpError(502, 'Test email could not be sent. Check SMTP settings and try again.');
    }
    return reply.send({ status: 'sent', message: 'Test email sent successfully.' });
  });

  app.post('/api/settings/whatsapp/test', async (request, reply) => {
    const user = await readUser(request, options.auth, options.jwtSecret);
    if (user.role !== 'master') throw new ForbiddenError();
    if (!user.phone?.trim()) {
      throw new HttpError(400, 'No WhatsApp number is saved for your account.');
    }
    let whatsappConnected: boolean;
    try {
      whatsappConnected = (await options.whatsapp.getStatus()).connected;
    } catch {
      whatsappConnected = false;
    }
    if (!whatsappConnected) {
      throw new HttpError(503, 'WhatsApp is not connected. Connect OpenWA and try again.');
    }
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutSignal = Symbol('whatsapp-test-timeout');
    try {
      await Promise.race([
        options.whatsapp.sendText(
          user.phone,
          'This is a test message from Healthcare News. Your WhatsApp connection is working.',
        ),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(timeoutSignal), WHATSAPP_TEST_SEND_TIMEOUT_MS);
        }),
      ]);
    } catch (error) {
      const timedOut = error === timeoutSignal;
      request.log.warn(
        { outcome: timedOut ? 'timeout' : 'failed' },
        'WhatsApp test send did not complete',
      );
      throw new HttpError(
        timedOut ? 504 : 502,
        timedOut
          ? 'WhatsApp did not confirm the send within 20 seconds. Check the OpenWA session.'
          : `Test WhatsApp message could not be sent: ${whatsappTestFailureReason(error, user.phone, user.email)}`,
      );
    } finally {
      if (timeout) clearTimeout(timeout);
    }
    request.log.info({ outcome: 'confirmed' }, 'WhatsApp test send completed');
    return reply.send({ status: 'sent', message: 'Test WhatsApp message sent successfully.' });
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
