import { ApiError } from './client';

export async function deleteMember(id: string): Promise<void> {
  const response = await fetch(`/api/members/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (response.status === 204) return;

  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw new ApiError(response.status, data.error ?? 'Something went wrong. Please try again.');
  }
}
