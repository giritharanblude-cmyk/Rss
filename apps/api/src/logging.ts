import type { FastifyRequest } from 'fastify';

export type LogActor = { id: string; role: string };

declare module 'fastify' {
  interface FastifyRequest {
    actor?: LogActor;
    startedAt?: bigint;
  }
}

const sensitiveKeyPattern =
  /^(?:password|newPassword|currentPassword|passwordHash|code|otp|otpCode|token|unsubscribeToken|secret|originSecret|jwt|jwtSecret|apiKey|openwaApiKey|smtpPassword|fromEmail|authorization|cookie|set-cookie|recipientContact|whatsappE164|email|phone)$/i;

const redactedValue = '[REDACTED]';

/**
 * Paths handed to pino so structured logs never print credentials or session
 * material, even if a caller logs a whole request object by mistake.
 */
export const loggerRedactPaths = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers["x-origin-secret"]',
  'res.headers["set-cookie"]',
  'password',
  'newPassword',
  'currentPassword',
  'passwordHash',
  'code',
  'otp',
  'token',
  'unsubscribeToken',
  'secret',
  'originSecret',
  'jwtSecret',
  'apiKey',
  'smtpPassword',
  'fromEmail',
  'recipientContact',
  'whatsappE164',
  'phone',
  'email',
  '*.password',
  '*.newPassword',
  '*.currentPassword',
  '*.code',
  '*.token',
  '*.secret',
  '*.apiKey',
  '*.smtpPassword',
  '*.fromEmail',
  '*.recipientContact',
  '*.whatsappE164',
  '*.phone',
  '*.email',
  '*.cookie',
];

export const loggerOptions = {
  level: process.env.LOG_LEVEL ?? 'info',
  redact: { paths: loggerRedactPaths, censor: redactedValue },
  serializers: {
    req(request: FastifyRequest) {
      return {
        method: request.method,
        url: sanitizeUrl(request.url),
        host: request.host,
        remoteAddress: request.ip,
      };
    },
    err(error: Error & { code?: string }) {
      return {
        type: error.name,
        code: error.code,
        message: redactLogText(error.message),
        stack: error.stack ? redactLogText(error.stack) : '',
      };
    },
  },
};

/**
 * Redacts capability tokens that appear in a URL path (public preference and
 * unsubscribe links) and secret-looking query parameters.
 */
export function sanitizeUrl(value: string): string {
  return value
    .replace(/(\/api\/public\/(?:preferences|unsubscribe)\/)[^/?#]+/gi, '$1[REDACTED]')
    .replace(/([?&](?:token|secret|password|code|otp|key|apiKey)=)[^&#]*/gi, `$1${redactedValue}`)
    .replace(/\b[a-f0-9]{64}\b/gi, redactedValue);
}

/**
 * Defence-in-depth for free-text values (error messages, URLs, provider
 * responses). Structured secrets should use the pino redact paths above.
 */
export function redactLogText(value: string): string {
  return value
    .replace(/contact:v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, 'contact:[REDACTED]')
    .replace(/v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]*/g, '[REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED-JWT]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[REDACTED-EMAIL]')
    .replace(/\+\d{8,15}\b/g, '[REDACTED-PHONE]')
    .replace(/\b[a-f0-9]{64}\b/gi, '[REDACTED-TOKEN]');
}

export function scrubLogPayload(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[TRUNCATED]';
  if (typeof value === 'string') return redactLogText(value);
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((entry) => scrubLogPayload(entry, depth + 1));

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    output[key] = sensitiveKeyPattern.test(key) ? redactedValue : scrubLogPayload(entry, depth + 1);
  }
  return output;
}

export function requestLogEntry(
  request: FastifyRequest,
  statusCode: number,
  durationMs: number,
): Record<string, unknown> {
  return {
    requestId: request.id,
    method: request.method,
    route: request.routeOptions.url ?? sanitizeUrl(request.url),
    statusCode,
    durationMs: Math.round(durationMs * 100) / 100,
    actorId: request.actor?.id ?? null,
    actorRole: request.actor?.role ?? null,
  };
}
