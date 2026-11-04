import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';

const user = {
  id: '00000000-0000-4000-8000-000000000000',
  name: 'Admin',
  role: 'master',
};
const recipient = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Asha',
  whatsappE164: '+919876543210',
  email: 'asha@example.test',
  topics: ['Outbreaks and public health'],
  channel: 'both',
  consentStatus: 'granted',
  consentAt: '2026-11-03T08:00:00.000Z',
  consentNote: 'Agreed',
  createdAt: '2026-11-03T08:00:00.000Z',
};
const delivery = {
  id: '00000000-0000-4000-8000-000000000002',
  queuedAt: '2026-11-03T08:00:00.000Z',
  sentAt: null,
  recipientId: recipient.id,
  recipientName: 'Asha',
  recipientContact: recipient.email,
  channel: 'email',
  kind: 'manual',
  status: 'failed',
  attempts: 3,
  lastError: 'Delivery failed; check the configured connection.',
};

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: new Headers(),
  } as Response;
}

beforeEach(() => window.history.pushState({}, '', '/deliveries'));
afterEach(() => vi.unstubAllGlobals());

describe('Phase 5 pages', () => {
  it('filters delivery history, exports it, and resends failed deliveries', async () => {
    const calls: { path: string; init?: RequestInit }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const path = String(input);
        calls.push({ path, init });
        if (path === '/api/auth/me') return jsonResponse(200, { user });
        if (path.startsWith('/api/recipients'))
          return jsonResponse(200, { recipients: [recipient] });
        if (path.startsWith('/api/deliveries?')) {
          return jsonResponse(200, { items: [delivery], page: 1, pageSize: 25, total: 1 });
        }
        if (path.endsWith('/resend')) return jsonResponse(202, { status: 'queued' });
        return jsonResponse(204, {});
      }),
    );

    render(<App />);
    expect(
      await screen.findByText('Delivery failed; check the configured connection.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Export CSV' })).toHaveAttribute(
      'href',
      '/api/deliveries/export.csv?',
    );
    expect(screen.getByRole('link', { name: 'Export Excel' })).toHaveAttribute(
      'href',
      '/api/deliveries/export.xlsx?',
    );
    fireEvent.change(screen.getByLabelText('Channel'), { target: { value: 'email' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    await waitFor(() =>
      expect(calls.some(({ path }) => path.includes('channel=email'))).toBe(true),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Resend' }));
    await waitFor(() => expect(calls.some(({ path }) => path.endsWith('/resend'))).toBe(true));
  });

  it('saves SMTP settings without exposing secrets and allows connection checks', async () => {
    const calls: { path: string; init?: RequestInit }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const path = String(input);
        calls.push({ path, init });
        if (path === '/api/auth/me') return jsonResponse(200, { user });
        if (path === '/api/health') {
          return jsonResponse(200, {
            status: 'ok',
            service: 'healthcare-rss-api',
            version: '0.0.0',
            uptimeSeconds: 100,
            timestamp: '2026-11-03T08:00:00.000Z',
            databaseSizeBytes: 710_000_000,
          });
        }
        if (path === '/api/settings/email' && init?.method !== 'PUT') {
          return jsonResponse(200, { settings: null, passwordConfigured: false });
        }
        if (path === '/api/settings/connections') {
          return jsonResponse(200, {
            connections: [
              {
                service: 'email',
                state: 'working',
                checkedAt: '2026-11-03T08:00:00.000Z',
                detail: null,
              },
              {
                service: 'whatsapp',
                state: 'connected',
                checkedAt: '2026-11-03T08:00:00.000Z',
                detail: null,
              },
            ],
          });
        }
        if (path === '/api/settings/email' && init?.method === 'PUT') {
          return jsonResponse(200, {
            settings: {
              host: 'smtp.example.test',
              port: 465,
              secure: true,
              user: 'admin@example.test',
              fromName: 'Healthcare News',
              fromEmail: 'admin@example.test',
            },
            passwordConfigured: true,
          });
        }
        if (path === '/api/settings/connections/check') {
          return jsonResponse(200, {
            connections: [
              {
                service: 'email',
                state: 'working',
                checkedAt: '2026-11-03T08:05:00.000Z',
                detail: null,
              },
            ],
          });
        }
        return jsonResponse(204, {});
      }),
    );
    window.history.pushState({}, '', '/settings');
    render(<App />);

    const storageWarning = await screen.findByRole('alert');
    expect(storageWarning).toHaveTextContent('Storage has passed the 70% warning threshold.');
    expect(storageWarning).toHaveTextContent('710.0 MB');
    expect(screen.getAllByText(/Checked /)).toHaveLength(2);

    fireEvent.change(await screen.findByLabelText('SMTP host'), {
      target: { value: 'smtp.example.test' },
    });
    fireEvent.change(screen.getByLabelText('Username'), {
      target: { value: 'admin@example.test' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'not-for-ui-response' },
    });
    fireEvent.change(screen.getByLabelText('Sender email'), {
      target: { value: 'admin@example.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save email settings' }));
    expect(await screen.findByRole('status')).toHaveTextContent('password is encrypted at rest');
    const saveCall = calls.find(
      ({ path, init }) => path === '/api/settings/email' && init?.method === 'PUT',
    );
    expect(JSON.parse(String(saveCall?.init?.body))).toMatchObject({
      host: 'smtp.example.test',
      password: 'not-for-ui-response',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Check now' }));
    await waitFor(() =>
      expect(calls.some(({ path }) => path === '/api/settings/connections/check')).toBe(true),
    );
  });
});
