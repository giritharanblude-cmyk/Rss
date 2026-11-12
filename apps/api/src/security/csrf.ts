import type { FastifyInstance } from 'fastify';
import { HttpError } from '../errors';

const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);

export type CsrfOptions = {
  /** The public browser origin that is allowed to submit state-changing requests. */
  allowedOrigins?: string[];
};

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function normaliseOrigin(value: string): string {
  try {
    return new URL(value).origin.toLowerCase();
  } catch {
    return value.trim().toLowerCase();
  }
}

function isPagesDeploymentOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.username === '' &&
      url.password === '' &&
      url.port === '' &&
      /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.rss-2t2\.pages\.dev$/i.test(url.hostname)
    );
  } catch {
    return false;
  }
}

/**
 * Small CSRF guard for the single-URL deployment. The browser and API share one
 * origin, so a state-changing request from another origin is never legitimate.
 * Non-browser clients that send no Origin header (for example the Netlify proxy)
 * are still protected by the origin secret.
 */
export function registerCsrfProtection(app: FastifyInstance, options: CsrfOptions = {}): void {
  const allowed = new Set((options.allowedOrigins ?? []).map(normaliseOrigin));

  app.addHook('onRequest', async (request) => {
    if (safeMethods.has(request.method)) {
      return;
    }

    const fetchSite = headerValue(request.headers['sec-fetch-site']);
    if (fetchSite === 'cross-site') {
      throw new HttpError(403, 'Cross-site request rejected.');
    }

    const origin = headerValue(request.headers.origin);
    if (!origin) {
      return;
    }
    if (
      allowed.size === 0 ||
      allowed.has(normaliseOrigin(origin)) ||
      isPagesDeploymentOrigin(origin)
    ) {
      return;
    }
    throw new HttpError(403, 'Request origin is not allowed.');
  });
}
