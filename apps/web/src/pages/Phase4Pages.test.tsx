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
  consentStatus: 'pending',
  consentAt: null,
  consentNote: null,
  createdAt: '2026-11-04T08:00:00.000Z',
};

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: new Headers(),
  } as Response;
}

beforeEach(() => {
  window.history.pushState({}, '', '/recipients');
});

afterEach(() => vi.unstubAllGlobals());

describe('Phase 4 pages', () => {
  it('records consent only with a note and updates the recipient state', async () => {
    let consentStatus = 'pending';
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/auth/me') return jsonResponse(200, { user });
      if (path.startsWith('/api/recipients/') && path.endsWith('/consent')) {
        const body = JSON.parse(String(init?.body)) as { status: string; note: string };
        consentStatus = body.status;
        return jsonResponse(200, {
          recipient: { ...recipient, consentStatus, consentNote: body.note },
        });
      }
      if (path.startsWith('/api/recipients')) {
        return jsonResponse(200, {
          recipients: [{ ...recipient, consentStatus }],
        });
      }
      return jsonResponse(204, {});
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    expect(await screen.findByText('Consent: pending')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm consent' }));
    fireEvent.change(screen.getByLabelText('Consent note (required)'), {
      target: { value: 'Agreed on call, 4 Nov' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save consent' }));
    expect(await screen.findByText('Consent: granted')).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([, init]) => String(init?.body).includes('Agreed on call, 4 Nov')),
    ).toBe(true);
    expect(document.querySelectorAll('.module-nav .module-link')).toHaveLength(6);
  });

  it('shows a consent-safe grouped preview on the Alerts page', async () => {
    window.history.pushState({}, '', '/alerts');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const path = String(input);
        if (path === '/api/auth/me') return jsonResponse(200, { user });
        if (path === '/api/alert-rules') return jsonResponse(200, { rules: [] });
        if (path === '/api/alert-rules/preview') {
          return jsonResponse(200, {
            kind: 'digest',
            rule: {
              kind: 'digest',
              daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
              timeLocal: '08:00',
              timezone: 'Asia/Kolkata',
              topics: [],
              channels: ['email'],
              active: true,
            },
            generatedAt: '2026-11-04T08:00:00.000Z',
            groups: [
              {
                recipientId: recipient.id,
                recipientName: 'Asha',
                channels: ['email'],
                since: null,
                itemCount: 1,
                itemsByCategory: [
                  {
                    category: 'Outbreaks and public health',
                    items: [
                      {
                        id: 'item-1',
                        headline: 'Vaccine advisory',
                        summary: 'Guidance',
                        link: 'https://example.test',
                        sourceName: 'Health News',
                        category: 'Outbreaks and public health',
                        publishedAt: null,
                        fetchedAt: '2026-11-04T08:00:00.000Z',
                      },
                    ],
                  },
                ],
              },
            ],
            recipientCount: 1,
            itemCount: 1,
          });
        }
        return jsonResponse(204, {});
      }),
    );

    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Preview what would be sent now' }));
    expect(await screen.findByText('Asha · email')).toBeInTheDocument();
    expect(screen.getByText('Vaccine advisory — Health News')).toBeInTheDocument();
    expect(screen.getByText(/No messages sent/)).toBeInTheDocument();
  });

  it('lets a recipient unsubscribe from the public token page', async () => {
    const token = 'a'.repeat(64);
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      if (String(input) === `/api/public/unsubscribe/${token}`) {
        return jsonResponse(200, { status: 'unsubscribed', name: 'Asha' });
      }
      return jsonResponse(204, {});
    });
    vi.stubGlobal('fetch', fetchMock);
    window.history.pushState({}, '', `/unsubscribe/${token}`);
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Unsubscribe' }));
    expect(
      await screen.findByRole('heading', { name: 'You are unsubscribed' }),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/public/unsubscribe/${token}`,
      expect.objectContaining({ method: 'POST' }),
    );
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('You will no longer receive'),
    );
  });

  it('lets a recipient update topic preferences through the public link', async () => {
    const token = 'b'.repeat(64);
    let topics = ['Outbreaks and public health'];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input) === `/api/public/preferences/${token}`) {
        if (init?.method === 'PATCH') {
          topics = (JSON.parse(String(init.body)) as { topics: string[] }).topics;
        }
        return jsonResponse(200, { name: 'Asha', topics });
      }
      return jsonResponse(204, {});
    });
    vi.stubGlobal('fetch', fetchMock);
    window.history.pushState({}, '', `/preferences/${token}`);
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Manage topics' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Uncategorized')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Drugs and approvals'));
    fireEvent.click(screen.getByRole('button', { name: 'Save preferences' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Your topic preferences have been saved.',
    );
    expect(topics).toEqual(['Outbreaks and public health', 'Drugs and approvals']);
  });
});
