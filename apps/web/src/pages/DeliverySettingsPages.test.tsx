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
  whatsappE164: null,
  hasWhatsapp: true,
  email: null,
  hasEmail: true,
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
  recipientContact: null,
  channel: 'email',
  kind: 'manual',
  status: 'failed',
  attempts: 3,
  lastError: 'Delivery failed; check the configured connection.',
};
const member = {
  id: '00000000-0000-4000-8000-000000000003',
  name: 'Ravi',
  email: 'ravi@example.test',
  role: 'member',
  disabled: false,
  createdAt: '2026-11-03T08:00:00.000Z',
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
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

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
    let memberCreated = false;
    let memberDisabled = false;
    let memberDeleted = false;
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const path = String(input);
        calls.push({ path, init });
        if (path === '/api/auth/me') return jsonResponse(200, { user });
        if (path === '/api/members' && init?.method === 'POST') {
          memberCreated = true;
          return jsonResponse(201, { member });
        }
        if (path === '/api/members' && (!init?.method || init.method === 'GET')) {
          return jsonResponse(200, {
            members:
              memberCreated && !memberDeleted ? [{ ...member, disabled: memberDisabled }] : [],
          });
        }
        if (path.endsWith('/reset-password')) return jsonResponse(204, {});
        if (path.startsWith('/api/members/') && init?.method === 'DELETE') {
          memberDeleted = true;
          return jsonResponse(204, {});
        }
        if (path.startsWith('/api/members/') && init?.method === 'PATCH') {
          memberDisabled = true;
          return jsonResponse(200, { member: { ...member, disabled: true } });
        }
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
    expect(
      await screen.findByText(
        'Saved username: ad***@example.test · Sender email: ad***@example.test. Re-enter both when saving changes.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByDisplayValue('admin@example.test')).not.toBeInTheDocument();
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

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ravi' } });
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'ravi@example.test' },
    });
    fireEvent.change(screen.getByLabelText('Initial password'), {
      target: { value: 'member-password-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add member' }));
    expect(
      await screen.findByText('Member account created and login details emailed.'),
    ).toBeInTheDocument();
    expect(await screen.findByText('Ravi')).toBeInTheDocument();
    expect(await screen.findByText('ra***@example.test')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Disable access' }));
    await waitFor(() =>
      expect(
        calls.some(({ path, init }) => path.endsWith(member.id) && init?.method === 'PATCH'),
      ).toBe(true),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));
    fireEvent.change(screen.getByLabelText('New password for Ravi'), {
      target: { value: 'member-password-2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Set password and revoke sessions' }));
    expect(
      await screen.findByText('Password reset. The member’s existing sessions are revoked.'),
    ).toBeInTheDocument();
    const resetCall = calls.find(({ path }) => path.endsWith('/reset-password'));
    expect(JSON.parse(String(resetCall?.init?.body))).toEqual({ password: 'member-password-2' });

    fireEvent.click(await screen.findByRole('button', { name: 'Delete member' }));
    expect(confirm).toHaveBeenCalledWith(
      "Permanently delete Ravi's account? Their existing sessions will be revoked.",
    );
    await waitFor(() =>
      expect(
        calls.some(({ path, init }) => path.endsWith(member.id) && init?.method === 'DELETE'),
      ).toBe(true),
    );
    expect(
      await screen.findByText("Ravi's account was deleted and their sessions were revoked."),
    ).toBeInTheDocument();
  });
});
