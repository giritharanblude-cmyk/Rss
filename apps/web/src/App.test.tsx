import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

beforeEach(() => {
  window.history.pushState({}, '', '/');
});

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: new Headers(),
  } as Response;
}

const emptyDashboard = {
  itemsToday: 0,
  activeSources: 0,
  recipients: 0,
  deliveriesToday: 0,
  failedDeliveries: 0,
  dailyActivity: [],
  deliveryOutcomes: { delivered: 0, failed: 0 },
  latestItems: [],
  lastFetchAt: null,
  connections: { whatsapp: false, email: false },
};

const disconnectedConnections = {
  connections: [
    {
      service: 'whatsapp',
      state: 'disconnected',
      checkedAt: '2026-11-03T08:00:00.000Z',
      detail: null,
    },
    {
      service: 'email',
      state: 'disconnected',
      checkedAt: '2026-11-03T08:00:00.000Z',
      detail: null,
    },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('App', () => {
  it('shows the sign-in page when there is no session', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(401, { error: 'Please sign in to continue.' })),
    );

    render(<App />);

    expect(await screen.findByRole('button', { name: /sign in/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /healthcare news reader/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/^name or email$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
  });

  it('moves from name and password to OTP verification and signs in', async () => {
    const user = {
      id: '00000000-0000-4000-8000-000000000000',
      name: 'Admin',
      role: 'master',
    };
    let hasSession = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const path = String(input);
        if (path === '/api/auth/login') {
          return jsonResponse(202, { status: 'otp_sent', message: 'Check your account email.' });
        }
        if (path === '/api/auth/verify-otp') {
          hasSession = true;
          return jsonResponse(200, { user });
        }
        if (path === '/api/dashboard/live') return jsonResponse(200, emptyDashboard);
        if (path === '/api/settings/connections') {
          return jsonResponse(200, disconnectedConnections);
        }
        return hasSession
          ? jsonResponse(200, { user })
          : jsonResponse(401, { error: 'Please sign in to continue.' });
      }),
    );

    render(<App />);
    fireEvent.change(await screen.findByLabelText(/^name or email$/i), {
      target: { value: 'Admin' },
    });
    fireEvent.change(screen.getByLabelText(/^password$/i), {
      target: { value: 'master-password-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    const code = await screen.findByLabelText(/verification code/i);
    fireEvent.change(code, { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /verify and sign in/i }));

    expect(await screen.findByText('Admin')).toBeInTheDocument();
    expect(screen.getByText('master')).toBeInTheDocument();
  });

  it('shows the username and role when signed in', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) =>
        String(input) === '/api/dashboard/live'
          ? jsonResponse(200, emptyDashboard)
          : String(input) === '/api/settings/connections'
            ? jsonResponse(200, disconnectedConnections)
            : jsonResponse(200, {
                user: {
                  id: '00000000-0000-4000-8000-000000000000',
                  name: 'Admin',
                  role: 'master',
                },
              }),
      ),
    );

    render(<App />);

    expect(await screen.findByText('Admin')).toBeInTheDocument();
    expect(screen.getByText('master')).toBeInTheDocument();
    expect(await screen.findByText('Disconnected')).toBeInTheDocument();
    expect(screen.getByText('Not working')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
    expect(
      within(screen.getByRole('navigation', { name: 'Modules' })).getAllByRole('link'),
    ).toHaveLength(7);
    expect(screen.getByRole('link', { name: 'Skip to main content' })).toHaveAttribute(
      'href',
      '#main-content',
    );
    expect(await screen.findByRole('main')).toHaveAttribute('id', 'main-content');
  });

  it('renders default connection statuses when dashboard connection data is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const path = String(input);
        if (path === '/api/dashboard/live') {
          return jsonResponse(200, {
            itemsToday: 0,
            activeSources: 0,
            recipients: 0,
            deliveriesToday: 0,
            failedDeliveries: 0,
            latestItems: [],
            lastFetchAt: null,
          });
        }
        if (path === '/api/settings/connections') return jsonResponse(200, { connections: [] });
        return jsonResponse(200, {
          user: {
            id: '00000000-0000-4000-8000-000000000000',
            name: 'Admin',
            role: 'master',
          },
        });
      }),
    );

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(await screen.findAllByText('Not checked yet')).toHaveLength(2);
  });

  it('shows members only the modules allowed by their role', async () => {
    const member = {
      id: '00000000-0000-4000-8000-000000000001',
      name: 'Mina',
      role: 'member',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) =>
        String(input) === '/api/auth/me'
          ? jsonResponse(200, { user: member })
          : String(input) === '/api/dashboard/live'
            ? jsonResponse(200, emptyDashboard)
            : jsonResponse(204, {}),
      ),
    );

    render(<App />);

    const navigation = await screen.findByRole('navigation', { name: 'Modules' });
    expect(
      within(navigation)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['News Feed', 'Sources', 'Recipients', 'Delivery Log', 'Profile']);
  });

  it('lets members change contacts from their profile only after requesting a code', async () => {
    const calls: { path: string; init?: RequestInit }[] = [];
    const member = {
      id: '00000000-0000-4000-8000-000000000001',
      name: 'Mina',
      role: 'member',
      email: 'mina@example.test',
      phone: null,
    };
    window.history.pushState({}, '', '/profile');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const path = String(input);
        calls.push({ path, init });
        if (path === '/api/auth/me') return jsonResponse(200, { user: member });
        if (path === '/api/auth/contact-change/request') {
          return jsonResponse(202, { status: 'otp_sent', message: 'Check your current email.' });
        }
        return jsonResponse(204, {});
      }),
    );

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Profile' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'mina.new@example.test' },
    });
    fireEvent.change(screen.getByLabelText('Phone (E.164)'), {
      target: { value: '+14155552671' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Request contact change' }));
    expect(await screen.findByLabelText('Verification code')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Verification code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify and save' }));

    expect(await screen.findByText('Contact information updated.')).toBeInTheDocument();
    expect(calls.map(({ path }) => path)).toEqual([
      '/api/auth/me',
      '/api/auth/contact-change/request',
      '/api/auth/contact-change/verify',
    ]);
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({
      email: 'mina.new@example.test',
      phone: '+14155552671',
    });
    expect(JSON.parse(String(calls[2]?.init?.body))).toEqual({
      email: 'mina.new@example.test',
      phone: '+14155552671',
      code: '123456',
    });
  });

  it.each(['/alerts', '/settings'])('redirects members away from %s', async (path) => {
    const calls: string[] = [];
    const member = {
      id: '00000000-0000-4000-8000-000000000001',
      name: 'Mina',
      role: 'member',
    };
    window.history.pushState({}, '', path);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        calls.push(url);
        if (url === '/api/auth/me') return jsonResponse(200, { user: member });
        if (url === '/api/sources') return jsonResponse(200, { sources: [] });
        if (url.startsWith('/api/news?')) {
          return jsonResponse(200, { page: 1, pageSize: 20, total: 0, items: [] });
        }
        return jsonResponse(204, {});
      }),
    );

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'News Feed' })).toBeInTheDocument();
    expect(calls).not.toContain('/api/alert-rules');
    expect(calls).not.toContain('/api/settings/email');
    expect(calls).not.toContain('/api/settings/connections');
  });
});
