import type {
  FeedTestResponse,
  AlertPreviewInput,
  AlertRule,
  AlertRuleInput,
  LoginAccepted,
  LoginBody,
  PublicUser,
  Recipient,
  RecipientInput,
  ResendOtpBody,
  Source,
  SourceInput,
  VerifyOtpBody,
} from '@healthcare/shared';
import type { NEWS_CATEGORIES } from '@healthcare/shared';

export type NewsCategory = (typeof NEWS_CATEGORIES)[number];
export type DashboardNewsItem = {
  id: string;
  sourceId: string;
  sourceName: string;
  headline: string;
  summary: string;
  link: string;
  category: NewsCategory;
  publishedAt: string | null;
  fetchedAt: string;
  important: boolean;
};
export type DashboardLive = {
  itemsToday: number;
  activeSources: number;
  recipients: number;
  deliveriesToday: number;
  failedDeliveries: number;
  latestItems: DashboardNewsItem[];
  lastFetchAt: string | null;
  connections: { whatsapp: boolean; email: boolean };
};
export type NewsFeedFilters = {
  category?: NewsCategory;
  sourceId?: string;
  from?: string;
  to?: string;
  q?: string;
  page: number;
  pageSize: number;
};
export type NewsFeedPage = {
  items: DashboardNewsItem[];
  page: number;
  pageSize: number;
  total: number;
};
export type DeliveryFilters = {
  from?: string;
  to?: string;
  channel?: 'email' | 'whatsapp';
  recipientId?: string;
  status?: 'pending' | 'delivered' | 'retrying' | 'failed';
};
export type DeliveryRecord = {
  id: string;
  queuedAt: string;
  sentAt: string | null;
  recipientId: string;
  recipientName: string;
  recipientContact: string | null;
  channel: 'email' | 'whatsapp';
  kind: 'digest' | 'instant' | 'manual' | 'unsubscribe_confirmation';
  status: 'pending' | 'delivered' | 'retrying' | 'failed';
  attempts: number;
  lastError: string | null;
};
export type DeliveryPage = {
  items: DeliveryRecord[];
  page: number;
  pageSize: number;
  total: number;
};
export type SmtpSettings = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  fromName: string;
  fromEmail: string;
};
export type ConnectionRecord = {
  service: 'whatsapp' | 'email';
  state: string;
  checkedAt: string;
  detail: string | null;
};
export type AlertPreview = {
  kind: 'digest' | 'instant';
  rule: AlertRuleInput;
  generatedAt: string;
  groups: {
    recipientId: string;
    recipientName: string;
    channels: ('email' | 'whatsapp')[];
    since: string | null;
    itemsByCategory: {
      category: NewsCategory;
      items: {
        id: string;
        headline: string;
        summary: string;
        link: string;
        sourceName: string;
        category: NewsCategory;
        publishedAt: string | null;
        fetchedAt: string;
      }[];
    }[];
    itemCount: number;
  }[];
  recipientCount: number;
  itemCount: number;
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'include',
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw new ApiError(response.status, data.error ?? 'Something went wrong. Please try again.');
  }
  return data as T;
}

let dashboardEtag: string | null = null;
let dashboardSnapshot: DashboardLive | null = null;

async function requestDashboardLive(): Promise<DashboardLive> {
  const response = await fetch('/api/dashboard/live', {
    credentials: 'include',
    headers: dashboardEtag ? { 'if-none-match': dashboardEtag } : {},
  });
  if (response.status === 304) {
    if (dashboardSnapshot) return dashboardSnapshot;
    return request<DashboardLive>('/api/dashboard/live');
  }
  const data = (await response.json().catch(() => ({}))) as DashboardLive & { error?: string };
  if (!response.ok) {
    throw new ApiError(response.status, data.error ?? 'Something went wrong. Please try again.');
  }
  dashboardEtag = response.headers.get('etag');
  dashboardSnapshot = data;
  return data;
}

export const api = {
  me: () => request<{ user: PublicUser }>('/api/auth/me'),
  login: (body: LoginBody) =>
    request<LoginAccepted>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  verifyOtp: (body: VerifyOtpBody) =>
    request<{ user: PublicUser }>('/api/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  resendOtp: (body: ResendOtpBody) =>
    request<LoginAccepted>('/api/auth/resend-otp', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  logout: () => request<void>('/api/auth/logout', { method: 'POST' }),
  sources: () => request<{ sources: Source[] }>('/api/sources'),
  createSource: (body: SourceInput) =>
    request<{ source: Source }>('/api/sources', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateSource: (id: string, body: Partial<SourceInput>) =>
    request<{ source: Source }>(`/api/sources/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteSource: (id: string) =>
    request<void>(`/api/sources/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  testFeed: (rssUrl: string) =>
    request<FeedTestResponse>('/api/sources/test', {
      method: 'POST',
      body: JSON.stringify({ rssUrl }),
    }),
  feedTestStatus: (id: string) =>
    request<FeedTestResponse>(`/api/sources/test/${encodeURIComponent(id)}`),
  dashboardLive: requestDashboardLive,
  news: (filters: NewsFeedFilters) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== '') params.set(key, String(value));
    }
    return request<NewsFeedPage>(`/api/news?${params.toString()}`);
  },
  setImportant: (id: string, important: boolean) =>
    request<{ id: string; important: boolean }>(`/api/news/${encodeURIComponent(id)}/important`, {
      method: 'PATCH',
      body: JSON.stringify({ important }),
    }),
  sendNewsNow: (id: string, channel: 'email' | 'whatsapp') =>
    request<{ queued: number }>(`/api/news/${encodeURIComponent(id)}/send`, {
      method: 'POST',
      body: JSON.stringify({ channel }),
    }),
  deliveries: (filters: DeliveryFilters & { page: number; pageSize: number }) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== '') params.set(key, String(value));
    }
    return request<DeliveryPage>(`/api/deliveries?${params.toString()}`);
  },
  deliveryExportUrl: (format: 'csv' | 'xlsx', filters: DeliveryFilters) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== '') params.set(key, String(value));
    }
    return `/api/deliveries/export.${format}?${params.toString()}`;
  },
  resendDelivery: (id: string) =>
    request<{ status: 'queued' }>(`/api/deliveries/${encodeURIComponent(id)}/resend`, {
      method: 'POST',
    }),
  emailSettings: () =>
    request<{ settings: SmtpSettings | null; passwordConfigured: boolean }>('/api/settings/email'),
  saveEmailSettings: (settings: SmtpSettings & { password: string }) =>
    request<{ settings: SmtpSettings; passwordConfigured: boolean }>('/api/settings/email', {
      method: 'PUT',
      body: JSON.stringify(settings),
    }),
  testEmailSettings: (to: string) =>
    request<{ status: 'sent' }>('/api/settings/email/test', {
      method: 'POST',
      body: JSON.stringify({ to }),
    }),
  connectionSettings: () =>
    request<{ connections: ConnectionRecord[] }>('/api/settings/connections'),
  checkConnections: () =>
    request<{ connections: ConnectionRecord[] }>('/api/settings/connections/check', {
      method: 'POST',
    }),
  connectWhatsApp: () =>
    request<{ status: { connected: boolean; detail?: string } }>('/api/settings/whatsapp/connect', {
      method: 'POST',
    }),
  logoutWhatsApp: () =>
    request<{ status: { connected: boolean; detail?: string } }>('/api/settings/whatsapp/logout', {
      method: 'POST',
    }),
  recipients: (query = '') =>
    request<{ recipients: Recipient[] }>(
      `/api/recipients${query ? `?q=${encodeURIComponent(query)}` : ''}`,
    ),
  createRecipient: (body: RecipientInput) =>
    request<{ recipient: Recipient }>('/api/recipients', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateRecipient: (id: string, body: RecipientInput) =>
    request<{ recipient: Recipient }>(`/api/recipients/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  setConsent: (id: string, body: { status: 'pending' | 'granted' | 'revoked'; note?: string }) =>
    request<{ recipient: Recipient }>(`/api/recipients/${encodeURIComponent(id)}/consent`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteRecipient: (id: string) =>
    request<void>(`/api/recipients/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  alertRules: () => request<{ rules: AlertRule[] }>('/api/alert-rules'),
  createAlertRule: (body: AlertRuleInput) =>
    request<{ rule: AlertRule }>('/api/alert-rules', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateAlertRule: (id: string, body: AlertRuleInput) =>
    request<{ rule: AlertRule }>(`/api/alert-rules/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteAlertRule: (id: string) =>
    request<void>(`/api/alert-rules/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  alertPreview: (body: AlertPreviewInput) =>
    request<AlertPreview>('/api/alert-rules/preview', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  publicPreferences: (token: string) =>
    request<{ name: string; topics: RecipientInput['topics'] }>(
      `/api/public/preferences/${encodeURIComponent(token)}`,
    ),
  updatePublicPreferences: (token: string, topics: RecipientInput['topics']) =>
    request<{ name: string; topics: RecipientInput['topics'] }>(
      `/api/public/preferences/${encodeURIComponent(token)}`,
      { method: 'PATCH', body: JSON.stringify({ topics }) },
    ),
  publicUnsubscribe: (token: string) =>
    request<{ status: 'unsubscribed'; name: string }>(
      `/api/public/unsubscribe/${encodeURIComponent(token)}`,
      { method: 'POST' },
    ),
};
