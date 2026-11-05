import type { FastifyInstance } from 'fastify';

export type SecurityHeaderOptions = {
  /** HSTS is only meaningful when the response is served over HTTPS. */
  hsts?: boolean;
};

const contentSecurityPolicy = [
  "default-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

/**
 * The API only returns JSON, files, and redirects. A deny-by-default CSP,
 * frame protection, and no-referrer policy are safe for every route and keep
 * the surface small if a response is ever rendered directly by a browser.
 */
export function registerSecurityHeaders(
  app: FastifyInstance,
  options: SecurityHeaderOptions = {},
): void {
  app.addHook('onRequest', async (_request, reply) => {
    reply
      .header('X-Content-Type-Options', 'nosniff')
      .header('X-Frame-Options', 'DENY')
      .header('Content-Security-Policy', contentSecurityPolicy)
      .header('Referrer-Policy', 'no-referrer')
      .header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
      .header('Cross-Origin-Opener-Policy', 'same-origin')
      .header('Cross-Origin-Resource-Policy', 'same-origin')
      .header('X-DNS-Prefetch-Control', 'off');

    if (options.hsts) {
      reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
  });
}
