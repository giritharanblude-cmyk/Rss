import type {
  LoginAccepted,
  LoginBody,
  PublicUser,
  ResendOtpBody,
  VerifyOtpBody,
} from '@healthcare/shared';

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
};
