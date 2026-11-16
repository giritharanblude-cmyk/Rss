import type { LookupAddress, LookupOptions } from 'node:dns';
import { lookup as dnsLookup } from 'node:dns/promises';
import {
  request as httpRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type RequestOptions,
} from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';

export type SafeFetchResponse = Pick<Response, 'ok' | 'status' | 'url' | 'headers' | 'text'>;
export type SafeFetcher = (input: string | URL, init?: RequestInit) => Promise<SafeFetchResponse>;

export type ResolvedAddress = {
  address: string;
  family: 4 | 6;
};

export type RawFetchResponse = {
  status: number;
  headers: Headers;
  body: Buffer;
};

export type PinnedRequestOptions = {
  connectAddress: ResolvedAddress;
  hostname: string;
  hostHeader: string;
  servername?: string;
  rejectUnauthorized: true;
  lookup: NonNullable<RequestOptions['lookup']>;
  headers: Headers;
  signal?: AbortSignal;
  connectTimeoutMs: number;
  readTimeoutMs: number;
  maxResponseBytes: number;
};

export type PinnedRequester = (
  url: URL,
  options: PinnedRequestOptions,
) => Promise<RawFetchResponse>;

export type SafeFetcherOptions = {
  resolve?: (hostname: string) => Promise<ResolvedAddress[]>;
  request?: PinnedRequester;
  connectTimeoutMs?: number;
  readTimeoutMs?: number;
  maxResponseBytes?: number;
  maxRedirects?: number;
};

const connectTimeoutMs = 5_000;
const readTimeoutMs = 5_000;
const maxResponseBytes = 5 * 1024 * 1024;
const maxRedirects = 5;
const redirectStatuses = new Set([301, 302, 303, 307, 308]);

const blockedIPv4 = new BlockList();
const blockedIPv4Ranges: [string, number][] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
  ['168.63.129.16', 32],
];
for (const [range, prefix] of blockedIPv4Ranges) {
  blockedIPv4.addSubnet(range, prefix, 'ipv4');
}

const globalIPv6 = new BlockList();
globalIPv6.addSubnet('2000::', 3, 'ipv6');

const blockedIPv6 = new BlockList();
const blockedIPv6Ranges: [string, number][] = [
  ['::', 96],
  ['::1', 128],
  ['::ffff:0:0', 96],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
];
for (const [range, prefix] of blockedIPv6Ranges) {
  blockedIPv6.addSubnet(range, prefix, 'ipv6');
}

export class SafeFetchError extends Error {
  constructor(
    message: string,
    readonly code: 'blocked_destination' | 'redirect_limit' | 'timeout' | 'response_too_large',
  ) {
    super(message);
    this.name = code === 'timeout' ? 'TimeoutError' : 'SafeFetchError';
  }
}

function isPublicAddress(address: string, family: number): boolean {
  if (family === 4) return !blockedIPv4.check(address, 'ipv4');
  if (family !== 6) return false;
  return globalIPv6.check(address, 'ipv6') && !blockedIPv6.check(address, 'ipv6');
}

function hostnameOf(url: URL): string {
  return url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname;
}

function validateUrl(url: URL): void {
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    !url.hostname ||
    url.username ||
    url.password
  ) {
    throw new SafeFetchError(
      'Only credential-free HTTP and HTTPS URLs are allowed.',
      'blocked_destination',
    );
  }
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('Request aborted.');
}

async function resolveWithSignal(
  resolve: (hostname: string) => Promise<ResolvedAddress[]>,
  hostname: string,
  signal?: AbortSignal,
): Promise<ResolvedAddress[]> {
  if (!signal) return resolve(hostname);
  if (signal.aborted) throw abortError(signal);

  return new Promise((resolveResult, reject) => {
    const onAbort = () => {
      cleanup();
      reject(abortError(signal));
    };
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    signal.addEventListener('abort', onAbort, { once: true });
    resolve(hostname).then(
      (addresses) => {
        cleanup();
        resolveResult(addresses);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}

async function resolveAndValidate(
  url: URL,
  resolve: (hostname: string) => Promise<ResolvedAddress[]>,
  signal?: AbortSignal,
): Promise<ResolvedAddress> {
  validateUrl(url);
  const hostname = hostnameOf(url);
  const literalFamily = isIP(hostname);
  const addresses: ResolvedAddress[] = literalFamily
    ? [{ address: hostname, family: literalFamily === 4 ? 4 : 6 }]
    : await resolveWithSignal(resolve, hostname, signal);

  if (addresses.length === 0) {
    throw new SafeFetchError('The destination hostname did not resolve.', 'blocked_destination');
  }
  for (const address of addresses) {
    const family = isIP(address.address);
    if (family !== address.family || !isPublicAddress(address.address, family)) {
      throw new SafeFetchError(
        'The destination resolves to a blocked IP address.',
        'blocked_destination',
      );
    }
  }
  return addresses[0]!;
}

function pinnedLookup(address: ResolvedAddress): NonNullable<RequestOptions['lookup']> {
  return (
    _hostname: string,
    options: LookupOptions,
    callback: (
      error: NodeJS.ErrnoException | null,
      result: string | LookupAddress[],
      family?: number,
    ) => void,
  ) => {
    if (options.all) {
      callback(null, [{ address: address.address, family: address.family }]);
    } else {
      callback(null, address.address, address.family);
    }
  };
}

function headersFromResponse(headers: IncomingHttpHeaders): Headers {
  const result = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) result.append(name, item);
    } else {
      result.set(name, value);
    }
  }
  return result;
}

export function requestPinned(
  url: URL,
  options: PinnedRequestOptions,
): Promise<RawFetchResponse> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(abortError(options.signal));
      return;
    }

    const commonOptions: RequestOptions = {
      hostname: options.hostname,
      port: url.port || undefined,
      path: `${url.pathname || '/'}${url.search}`,
      method: 'GET',
      headers: {
        ...Object.fromEntries(options.headers.entries()),
        host: options.hostHeader,
      },
      lookup: options.lookup,
      agent: false,
    };
    let response: IncomingMessage | undefined;
    const onResponse = (incoming: IncomingMessage) => {
      if (settled) {
        incoming.destroy();
        return;
      }
      response = incoming;
      const length = Number(incoming.headers['content-length']);
      if (Number.isFinite(length) && length > options.maxResponseBytes) {
        fail(new SafeFetchError('The response exceeded the size limit.', 'response_too_large'));
        return;
      }

      startReadTimer();
      const chunks: Buffer[] = [];
      let totalBytes = 0;
      incoming.on('data', (chunk: Buffer | string) => {
        startReadTimer();
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        totalBytes += bytes.byteLength;
        if (totalBytes > options.maxResponseBytes) {
          fail(new SafeFetchError('The response exceeded the size limit.', 'response_too_large'));
          return;
        }
        chunks.push(bytes);
      });
      incoming.on('end', () => {
        const status = incoming.statusCode;
        if (!status) {
          fail(new Error('The response did not include an HTTP status.'));
          return;
        }
        finish({
          status,
          headers: headersFromResponse(incoming.headers),
          body: Buffer.concat(chunks),
        });
      });
      incoming.on('aborted', () => fail(new Error('The response was interrupted.')));
      incoming.on('error', fail);
    };
    const request =
      url.protocol === 'https:'
        ? httpsRequest(
            {
              ...commonOptions,
              ...(options.servername ? { servername: options.servername } : {}),
              rejectUnauthorized: options.rejectUnauthorized,
            },
            onResponse,
          )
        : httpRequest(commonOptions, onResponse);

    let settled = false;
    let connectTimer: NodeJS.Timeout | undefined;
    let readTimer: NodeJS.Timeout | undefined;
    const cleanup = () => {
      if (connectTimer) clearTimeout(connectTimer);
      if (readTimer) clearTimeout(readTimer);
      options.signal?.removeEventListener('abort', onAbort);
    };
    const finish = (result: RawFetchResponse) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      response?.destroy();
      request.destroy();
      reject(error);
    };
    const startReadTimer = () => {
      if (settled) return;
      if (readTimer) clearTimeout(readTimer);
      readTimer = setTimeout(
        () => fail(new SafeFetchError('The response timed out.', 'timeout')),
        options.readTimeoutMs,
      );
    };
    const onAbort = () => fail(abortError(options.signal!));

    options.signal?.addEventListener('abort', onAbort, { once: true });
    request.on('socket', (socket) => {
      if (settled) return;
      connectTimer = setTimeout(
        () => fail(new SafeFetchError('The connection timed out.', 'timeout')),
        options.connectTimeoutMs,
      );
      const connected = () => {
        if (connectTimer) clearTimeout(connectTimer);
        startReadTimer();
      };
      if (socket.connecting) socket.once('connect', connected);
      else connected();
    });
    request.on('error', fail);
    request.end();
  });
}

function responseFromRaw(url: URL, response: RawFetchResponse): SafeFetchResponse {
  const body = response.body;
  return {
    status: response.status,
    ok: response.status >= 200 && response.status < 300,
    url: url.href,
    headers: response.headers,
    text: async () => body.toString('utf8'),
  };
}

export function createSafeFetcher(options: SafeFetcherOptions = {}): SafeFetcher {
  const resolve =
    options.resolve ??
    (async (hostname) => {
      const addresses = await dnsLookup(hostname, { all: true, verbatim: true });
      return addresses.map(({ address, family }): ResolvedAddress => {
        if (family !== 4 && family !== 6) {
          throw new SafeFetchError(
            'The destination hostname resolved to an invalid address.',
            'blocked_destination',
          );
        }
        return { address, family: family === 4 ? 4 : 6 };
      });
    });
  const request = options.request ?? requestPinned;
  const limits = {
    connectTimeoutMs: options.connectTimeoutMs ?? connectTimeoutMs,
    readTimeoutMs: options.readTimeoutMs ?? readTimeoutMs,
    maxResponseBytes: options.maxResponseBytes ?? maxResponseBytes,
  };
  const redirectLimit = options.maxRedirects ?? maxRedirects;

  return async (input, init = {}) => {
    let url = new URL(input);
    const headers = new Headers(init.headers);
    const signal = init.signal ?? undefined;

    for (let redirects = 0; ; redirects += 1) {
      if (signal?.aborted) throw abortError(signal);
      const address = await resolveAndValidate(url, resolve, signal);
      const hostname = hostnameOf(url);
      const requestHeaders = new Headers(headers);
      requestHeaders.set('host', url.host);
      requestHeaders.set('accept-encoding', 'identity');
      const response = await request(url, {
        ...limits,
        connectAddress: address,
        hostname,
        hostHeader: url.host,
        ...(url.protocol === 'https:' && isIP(hostname) === 0 ? { servername: hostname } : {}),
        rejectUnauthorized: true,
        lookup: pinnedLookup(address),
        headers: requestHeaders,
        signal,
      });
      if (response.body.byteLength > limits.maxResponseBytes) {
        throw new SafeFetchError('The response exceeded the size limit.', 'response_too_large');
      }
      const location = response.headers.get('location');
      if (!redirectStatuses.has(response.status) || !location) {
        return responseFromRaw(url, response);
      }
      if (redirects >= redirectLimit) {
        throw new SafeFetchError('The request exceeded the redirect limit.', 'redirect_limit');
      }

      const nextUrl = new URL(location, url);
      validateUrl(nextUrl);
      if (url.origin !== nextUrl.origin) {
        headers.delete('authorization');
        headers.delete('cookie');
        headers.delete('proxy-authorization');
      }
      url = nextUrl;
    }
  };
}

export const safeFetch = createSafeFetcher();
