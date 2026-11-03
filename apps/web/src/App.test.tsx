import { fireEvent, render, screen } from '@testing-library/react';
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
  } as Response;
}

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
    const responses = [
      jsonResponse(401, { error: 'Please sign in to continue.' }),
      jsonResponse(202, { status: 'otp_sent', message: 'Check the admin email.' }),
      jsonResponse(200, { user }),
      jsonResponse(200, { user }),
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => responses.shift() ?? jsonResponse(500, { error: 'Unexpected request' })),
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
      vi.fn(async () =>
        jsonResponse(200, {
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
  });
});
