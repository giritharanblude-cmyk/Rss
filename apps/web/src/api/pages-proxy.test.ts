import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequest } from '../../../../functions/api/[[path]]';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Cloudflare Pages API proxy', () => {
  it('forwards the request and adds the configured origin secret', async () => {
    const body = '{"message":"hello"}';
    const fetchMock = vi.fn(
      async (_request: Request) => new Response('origin response', { status: 201 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await onRequest({
      request: new Request('https://pages.example/api/news?q=health', {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          cookie: 'session=session-token',
          'x-client-id': 'client-123',
          'x-origin-secret': 'untrusted-value',
        },
        body,
      }),
      env: {
        ORIGIN_BASE: 'https://origin.example.test',
        ORIGIN_SECRET: 'configured-secret',
      },
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const forwarded = fetchMock.mock.calls[0]?.[0];
    expect(forwarded).toBeInstanceOf(Request);
    if (!(forwarded instanceof Request)) throw new Error('Expected a forwarded Request.');

    expect(forwarded.url).toBe('https://origin.example.test/api/news?q=health');
    expect(forwarded.method).toBe('PATCH');
    expect(forwarded.headers.get('content-type')).toBe('application/json');
    expect(forwarded.headers.get('cookie')).toBe('session=session-token');
    expect(forwarded.headers.get('x-client-id')).toBe('client-123');
    expect(forwarded.headers.get('x-origin-secret')).toBe('configured-secret');
    expect(await forwarded.text()).toBe(body);
    expect(response.status).toBe(201);
    expect(await response.text()).toBe('origin response');
  });

  it('returns a host-only session cookie and forwards it on the next login request', async () => {
    const cookie =
      'session=session-token; Domain=origin.example.test; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800';
    const fetchMock = vi.fn(async (request: Request) => {
      if (request.headers.get('cookie') === 'session=session-token') {
        return Response.json({ status: 'session_active' });
      }
      return new Response(JSON.stringify({ status: 'session_active' }), {
        headers: { 'Set-Cookie': cookie },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const env = {
      ORIGIN_BASE: 'https://origin.example.test',
      ORIGIN_SECRET: 'configured-secret',
    };

    const login = await onRequest({
      request: new Request('https://pages.example/api/auth/login', { method: 'POST' }),
      env,
    });
    const [browserCookie] = login.headers.getSetCookie();

    expect(browserCookie).toBeDefined();
    expect(browserCookie).not.toMatch(/;\s*Domain=/i);
    expect(browserCookie).toContain('HttpOnly');
    expect(browserCookie).toContain('Secure');
    expect(browserCookie).toContain('SameSite=Lax');
    expect(browserCookie).toContain('Path=/');
    expect(browserCookie).toContain('Max-Age=604800');

    const nextLogin = await onRequest({
      request: new Request('https://pages.example/api/auth/login', {
        method: 'POST',
        headers: { cookie: browserCookie?.split(';', 1)[0] ?? '' },
      }),
      env,
    });

    expect(nextLogin.status).toBe(200);
    expect(await nextLogin.json()).toEqual({ status: 'session_active' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
