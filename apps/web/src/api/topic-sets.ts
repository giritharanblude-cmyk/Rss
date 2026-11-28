import {
  topicSetInputSchema,
  topicSetListResponseSchema,
  topicSetSchema,
  type TopicSetInput,
} from '@healthcare/shared';
import { ApiError } from './client';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'include',
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  if (response.status === 204) return undefined as T;

  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
        ? data.error
        : 'Something went wrong. Please try again.';
    throw new ApiError(response.status, message);
  }
  return data as T;
}

export async function listTopicSets() {
  return topicSetListResponseSchema.parse(await request<unknown>('/api/topic-sets')).topicSets;
}

export async function createTopicSet(input: TopicSetInput) {
  const data = await request<{ topicSet: unknown }>('/api/topic-sets', {
    method: 'POST',
    body: JSON.stringify(topicSetInputSchema.parse(input)),
  });
  return topicSetSchema.parse(data.topicSet);
}

export async function updateTopicSet(id: string, input: TopicSetInput) {
  const data = await request<{ topicSet: unknown }>(`/api/topic-sets/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(topicSetInputSchema.parse(input)),
  });
  return topicSetSchema.parse(data.topicSet);
}

export function deleteTopicSet(id: string) {
  return request<void>(`/api/topic-sets/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
