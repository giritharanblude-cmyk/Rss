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
  latestItems: [],
  lastFetchAt: null,
  connections: { whatsapp: false, email: false },
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
    expect(screen.getByLabelText(/^name$/i)).toBeInTheDocument();
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
          return jsonResponse(202, { status: 'otp_sent', message: 'Check the admin email.' });
        }
        if (path === '/api/auth/verify-otp') {
          hasSession = true;
          return jsonResponse(200, { user });
        }
        if (path === '/api/dashboard/live') return jsonResponse(200, emptyDashboard);
        return hasSession
          ? jsonResponse(200, { user })
          : jsonResponse(401, { error: 'Please sign in to continue.' });
      }),
    );

    render(<App />);
    fireEvent.change(await screen.findByLabelText(/^name$/i), {
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
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
    expect(
      within(screen.getByRole('navigation', { name: 'Modules' })).getAllByRole('link'),
    ).toHaveLength(6);
    expect(screen.getByRole('link', { name: 'Skip to main content' })).toHaveAttribute(
      'href',
      '#main-content',
    );
    expect(await screen.findByRole('main')).toHaveAttribute('id', 'main-content');
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
    ).toEqual(['News Feed', 'Sources', 'Recipients', 'Delivery Log']);
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
