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
    expect(forwarded.headers.get('x-client-id')).toBe('client-123');
    expect(forwarded.headers.get('x-origin-secret')).toBe('configured-secret');
    expect(await forwarded.text()).toBe(body);
    expect(response.status).toBe(201);
    expect(await response.text()).toBe('origin response');
  });
});
