export default async (request, context) => {
  const secret = globalThis.Deno?.env.get('ORIGIN_SECRET');
  if (!secret) {
    return new Response('Origin proxy is not configured.', { status: 500 });
  }

  const headers = new Headers(request.headers);
  headers.set('x-origin-secret', secret);
  return context.next(new Request(request, { headers }));
};

export const config = { path: '/api/*' };
