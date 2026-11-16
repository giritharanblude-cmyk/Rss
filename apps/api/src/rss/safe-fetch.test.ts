import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import {
  createSafeFetcher,
  requestPinned,
  SafeFetchError,
  type PinnedRequestOptions,
  type PinnedRequester,
  type RawFetchResponse,
  type ResolvedAddress,
} from './safe-fetch';

const publicIPv4: ResolvedAddress = { address: '1.1.1.1', family: 4 };

function rawResponse(
  status = 200,
  headers: Record<string, string> = {},
  body = 'ok',
): RawFetchResponse {
  return { status, headers: new Headers(headers), body: Buffer.from(body) };
}

const blockedAddresses: { name: string; address: string; family: 4 | 6 }[] = [
  { name: 'unspecified IPv4', address: '0.0.0.1', family: 4 },
  { name: 'private IPv4 10/8', address: '10.1.0.1', family: 4 },
  { name: 'carrier-grade NAT', address: '100.64.0.1', family: 4 },
  { name: 'loopback IPv4', address: '127.0.0.1', family: 4 },
  { name: 'link-local IPv4 and AWS metadata', address: '169.254.169.254', family: 4 },
  { name: 'private IPv4 172.16/12', address: '172.16.0.1', family: 4 },
  { name: 'protocol assignment IPv4', address: '192.0.0.8', family: 4 },
  { name: 'documentation IPv4 192.0.2/24', address: '192.0.2.1', family: 4 },
  { name: '6to4 relay anycast IPv4', address: '192.88.99.1', family: 4 },
  { name: 'private IPv4 192.168/16', address: '192.168.1.1', family: 4 },
  { name: 'benchmark IPv4', address: '198.18.0.1', family: 4 },
  { name: 'documentation IPv4 198.51.100/24', address: '198.51.100.1', family: 4 },
  { name: 'documentation IPv4 203.0.113/24', address: '203.0.113.1', family: 4 },
  { name: 'multicast IPv4', address: '224.0.0.1', family: 4 },
  { name: 'reserved IPv4', address: '240.0.0.1', family: 4 },
  { name: 'Azure metadata IPv4', address: '168.63.129.16', family: 4 },
  { name: 'IPv4 unspecified IPv6-compatible', address: '::', family: 6 },
  { name: 'loopback IPv6', address: '::1', family: 6 },
  { name: 'IPv4-compatible IPv6', address: '::7f00:1', family: 6 },
  { name: 'IPv4-mapped IPv6', address: '::ffff:7f00:1', family: 6 },
  { name: 'NAT64 IPv6', address: '64:ff9b::a9fe:a9fe', family: 6 },
  { name: 'local-use NAT64 IPv6', address: '64:ff9b:1::1', family: 6 },
  { name: 'discard-only IPv6', address: '100::1', family: 6 },
  { name: 'special-purpose IPv6', address: '2001::1', family: 6 },
  { name: 'documentation IPv6', address: '2001:db8::1', family: 6 },
  { name: '6to4 IPv6', address: '2002:7f00:1::', family: 6 },
  { name: 'documentation IPv6 3fff::/20', address: '3fff::1', family: 6 },
  { name: 'unique-local IPv6', address: 'fc00::1', family: 6 },
  { name: 'link-local IPv6', address: 'fe80::1', family: 6 },
  { name: 'multicast IPv6', address: 'ff02::1', family: 6 },
  { name: 'non-global IPv6', address: '4000::1', family: 6 },
];

function pinnedOptions(
  url: URL,
  address: ResolvedAddress,
  overrides: Partial<PinnedRequestOptions> = {},
): PinnedRequestOptions {
  return {
    connectAddress: address,
    hostname: url.hostname,
    hostHeader: url.host,
    ...(url.protocol === 'https:' ? { servername: url.hostname } : {}),
    rejectUnauthorized: true,
    lookup: (_hostname, options, callback) => {
      if (options.all) callback(null, [address]);
      else callback(null, address.address, address.family);
    },
    headers: new Headers({ host: url.host }),
    connectTimeoutMs: 100,
    readTimeoutMs: 100,
    maxResponseBytes: 1024,
    ...overrides,
  };
}

describe('safe RSS fetching', () => {
  it.each(blockedAddresses)('blocks $name', async ({ address, family }) => {
    const request = vi.fn(async () => rawResponse());
    const fetcher = createSafeFetcher({
      resolve: async () => [{ address, family }],
      request,
    });

    await expect(fetcher('https://feed.example.test/rss')).rejects.toMatchObject({
      code: 'blocked_destination',
    });
    expect(request).not.toHaveBeenCalled();
  });

  it('rejects mixed DNS answers if any resolved address is blocked', async () => {
    const request = vi.fn(async () => rawResponse());
    const fetcher = createSafeFetcher({
      resolve: async () => [
        publicIPv4,
        { address: '10.0.0.2', family: 4 },
      ],
      request,
    });

    await expect(fetcher('https://feed.example.test/rss')).rejects.toBeInstanceOf(SafeFetchError);
    expect(request).not.toHaveBeenCalled();
  });

  it('pins the validated DNS answer and preserves the original HTTP/TLS host identity', async () => {
    let resolutionCount = 0;
    const request = vi.fn(async (url: URL, options: PinnedRequestOptions) => {
      const socketAddress = await new Promise<string>((resolve, reject) => {
        options.lookup(url.hostname, {}, (error, result) => {
          if (error) reject(error);
          else resolve(typeof result === 'string' ? result : result[0]!.address);
        });
      });
      expect(socketAddress).toBe(publicIPv4.address);
      expect(options.connectAddress).toEqual(publicIPv4);
      expect(options.hostname).toBe('feed.example.test');
      expect(options.hostHeader).toBe('feed.example.test');
      expect(options.headers.get('host')).toBe('feed.example.test');
      expect(options.servername).toBe('feed.example.test');
      expect(options.rejectUnauthorized).toBe(true);
      return rawResponse();
    });
    const fetcher = createSafeFetcher({
      resolve: async () => {
        resolutionCount += 1;
        return resolutionCount === 1 ? [publicIPv4] : [{ address: '127.0.0.1', family: 4 }];
      },
      request,
    });

    await expect(fetcher('https://feed.example.test/rss')).resolves.toMatchObject({ ok: true });
    expect(resolutionCount).toBe(1);
    expect(request).toHaveBeenCalledOnce();
  });

  it('re-resolves and blocks a redirect to a private address', async () => {
    const resolve = vi.fn(async (hostname: string) =>
      hostname === 'private.example.test'
        ? [{ address: '10.0.0.1', family: 4 as const }]
        : [publicIPv4],
    );
    const request = vi.fn(async () =>
      rawResponse(302, { location: 'http://private.example.test/metadata' }),
    );
    const fetcher = createSafeFetcher({ resolve, request });

    await expect(fetcher('https://feed.example.test/rss')).rejects.toMatchObject({
      code: 'blocked_destination',
    });
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenCalledOnce();
  });

  it('follows a public redirect using the separately validated destination address', async () => {
    const otherPublic: ResolvedAddress = { address: '8.8.8.8', family: 4 };
    const request = vi
      .fn<PinnedRequester>()
      .mockResolvedValueOnce(rawResponse(302, { location: 'https://other.example.test/feed' }))
      .mockResolvedValueOnce(rawResponse(200, {}, 'feed'));
    const fetcher = createSafeFetcher({
      resolve: async (hostname) =>
        hostname === 'other.example.test' ? [otherPublic] : [publicIPv4],
      request,
    });

    const response = await fetcher('https://feed.example.test/start');

    expect(response.url).toBe('https://other.example.test/feed');
    expect(await response.text()).toBe('feed');
    expect(request.mock.calls.map(([, options]) => options.connectAddress)).toEqual([
      publicIPv4,
      otherPublic,
    ]);
  });

  it('rejects a redirect loop after five redirects', async () => {
    const resolve = vi.fn(async () => [publicIPv4]);
    const request = vi.fn(async () => rawResponse(302, { location: '/loop' }));
    const fetcher = createSafeFetcher({ resolve, request });

    await expect(fetcher('https://feed.example.test/start')).rejects.toMatchObject({
      code: 'redirect_limit',
    });
    expect(request).toHaveBeenCalledTimes(6);
    expect(resolve).toHaveBeenCalledTimes(6);
  });

  it('enforces the response size cap', async () => {
    const fetcher = createSafeFetcher({
      resolve: async () => [publicIPv4],
      request: async () => rawResponse(200, {}, '12345'),
      maxResponseBytes: 4,
    });

    await expect(fetcher('https://feed.example.test/rss')).rejects.toMatchObject({
      code: 'response_too_large',
    });
  });

  it('enforces a connection timeout if the pinned lookup never connects', async () => {
    const url = new URL('http://feed.example.test/rss');
    const options = pinnedOptions(url, publicIPv4, {
      connectTimeoutMs: 20,
      lookup: () => undefined,
    });

    await expect(requestPinned(url, options)).rejects.toMatchObject({ name: 'TimeoutError' });
  });

  it('enforces a read timeout after connecting', async () => {
    const server = createServer(() => undefined);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    const url = new URL(`http://feed.example.test:${port}/rss`);
    const address = { address: '127.0.0.1', family: 4 as const };

    try {
      await expect(
        requestPinned(
          url,
          pinnedOptions(url, address, {
            readTimeoutMs: 20,
          }),
        ),
      ).rejects.toMatchObject({ name: 'TimeoutError' });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
