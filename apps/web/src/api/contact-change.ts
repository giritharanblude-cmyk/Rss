import type { RequestContactChangeBody, VerifyContactChangeBody } from '@healthcare/shared';
import { ApiError } from './client';

async function post(path: string, body: unknown): Promise<void> {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (response.status === 204) return;

  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw new ApiError(response.status, data.error ?? 'Something went wrong. Please try again.');
  }
}

export function requestContactChange(body: RequestContactChangeBody): Promise<void> {
  return post('/api/auth/contact-change/request', body);
}

export function verifyContactChange(body: VerifyContactChangeBody): Promise<void> {
  return post('/api/auth/contact-change/verify', body);
}
