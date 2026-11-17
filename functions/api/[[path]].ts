interface Environment {
  ORIGIN_BASE: string;
  ORIGIN_SECRET: string;
}

interface PagesFunctionContext {
  request: Request;
  env: Environment;
}

export async function onRequest({ request, env }: PagesFunctionContext): Promise<Response> {
  if (!env.ORIGIN_BASE || !env.ORIGIN_SECRET) {
    return new Response('API proxy is not configured.', { status: 500 });
  }

  const upstreamUrl = new URL(request.url);
  const originBase = new URL(env.ORIGIN_BASE);
  upstreamUrl.protocol = originBase.protocol;
  upstreamUrl.host = originBase.host;

  const headers = new Headers(request.headers);
  headers.set('X-Origin-Secret', env.ORIGIN_SECRET);

  const init: RequestInit & { duplex?: 'half' } = {
    method: request.method,
    headers,
    redirect: request.redirect,
  };
  if (request.body) {
    init.body = request.body;
    init.duplex = 'half';
  }

  const response = await fetch(new Request(upstreamUrl, init));
  const responseHeaders = new Headers(response.headers);
  const setCookies = response.headers.getSetCookie();
  if (setCookies.length > 0) {
    responseHeaders.delete('Set-Cookie');
    for (const cookie of setCookies) {
      responseHeaders.append('Set-Cookie', cookie.replace(/;\s*Domain=[^;]*/gi, ''));
    }
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
}
