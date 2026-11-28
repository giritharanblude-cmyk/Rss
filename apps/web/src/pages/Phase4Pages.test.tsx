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
  whatsappE164: '+91********10',
  hasWhatsapp: true,
  email: 'as***@example.test',
  hasEmail: true,
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
afterEach(() => vi.restoreAllMocks());

describe('Phase 4 pages', () => {
  it('lets a member create and delete their own topic set', async () => {
    const member = { ...user, name: 'Mina', role: 'member' };
    let topicSets: {
      id: string;
      name: string;
      categoryKeys: string[];
      createdAt: string;
      updatedAt: string;
    }[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/auth/me') return jsonResponse(200, { user: member });
      if (path === '/api/topic-sets' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as {
          name: string;
          categoryKeys: string[];
        };
        topicSets = [
          {
            id: '00000000-0000-4000-8000-000000000020',
            ...body,
            createdAt: '2026-11-04T08:00:00.000Z',
            updatedAt: '2026-11-04T08:00:00.000Z',
          },
        ];
        return jsonResponse(201, { topicSet: topicSets[0] });
      }
      if (path.startsWith('/api/topic-sets/') && init?.method === 'DELETE') {
        topicSets = [];
        return jsonResponse(204, {});
      }
      if (path === '/api/topic-sets') return jsonResponse(200, { topicSets });
      if (path.startsWith('/api/recipients')) {
        return jsonResponse(200, { recipients: [], page: 1, pageSize: 25, total: 0 });
      }
      return jsonResponse(204, {});
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Topic sets' })).toBeInTheDocument();
    expect(
      screen.getByText('Custom names are labels; matching uses the fixed categories.'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create topic set' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Mina updates' } });
    fireEvent.click(screen.getByLabelText('Drugs and approvals'));
    fireEvent.click(screen.getByRole('button', { name: 'Save topic set' }));

    expect(await screen.findByRole('heading', { name: 'Mina updates' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/topic-sets',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          name: 'Mina updates',
          categoryKeys: ['Drugs and approvals'],
        }),
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Topic set deleted.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Mina updates' })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/topic-sets/00000000-0000-4000-8000-000000000020',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('shows only topic sets returned for the signed-in member', async () => {
    const member = { ...user, name: 'Mina', role: 'member' };
    const memberSet = {
      id: '00000000-0000-4000-8000-000000000021',
      name: 'Mina topics',
      categoryKeys: ['Hospitals and industry'],
      createdAt: '2026-11-04T08:00:00.000Z',
      updatedAt: '2026-11-04T08:00:00.000Z',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const path = String(input);
        if (path === '/api/auth/me') return jsonResponse(200, { user: member });
        if (path === '/api/topic-sets') return jsonResponse(200, { topicSets: [memberSet] });
        if (path.startsWith('/api/recipients')) {
          return jsonResponse(200, { recipients: [], page: 1, pageSize: 25, total: 0 });
        }
        return jsonResponse(204, {});
      }),
    );

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Mina topics' })).toBeInTheDocument();
    expect(screen.queryByText('Admin topics')).not.toBeInTheDocument();
  });

  it("applies a topic set to a recipient's topics", async () => {
    const member = { ...user, name: 'Mina', role: 'member' };
    const memberSet = {
      id: '00000000-0000-4000-8000-000000000022',
      name: 'Hospital updates',
      categoryKeys: ['Hospitals and industry', 'Drugs and approvals'],
      createdAt: '2026-11-04T08:00:00.000Z',
      updatedAt: '2026-11-04T08:00:00.000Z',
    };
    let createdRecipient: Record<string, unknown> | null = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        if (path === '/api/auth/me') return jsonResponse(200, { user: member });
        if (path === '/api/topic-sets') return jsonResponse(200, { topicSets: [memberSet] });
        if (path.startsWith('/api/recipients') && init?.method === 'POST') {
          createdRecipient = JSON.parse(String(init.body)) as Record<string, unknown>;
          return jsonResponse(201, { recipient });
        }
        if (path.startsWith('/api/recipients')) {
          return jsonResponse(200, { recipients: [], page: 1, pageSize: 25, total: 0 });
        }
        return jsonResponse(204, {});
      }),
    );

    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Add recipient' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Mina contact' } });
    fireEvent.change(screen.getByLabelText('Email id'), {
      target: { value: 'contact@example.test' },
    });
    fireEvent.change(screen.getByLabelText('Use a topic set'), {
      target: { value: memberSet.id },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Use this set' }));

    expect(screen.getByLabelText('Hospitals and industry')).toBeChecked();
    expect(screen.getByLabelText('Drugs and approvals')).toBeChecked();
    expect(screen.getByLabelText('Outbreaks and public health')).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Save recipient' }));

    await waitFor(() =>
      expect(createdRecipient).toMatchObject({
        name: 'Mina contact',
        topics: ['Hospitals and industry', 'Drugs and approvals'],
      }),
    );
  });

  it('rejects topic sets with invalid category keys in the UI', async () => {
    const invalidSet = {
      id: '00000000-0000-4000-8000-000000000023',
      name: 'Invalid set',
      categoryKeys: ['Custom category'],
      createdAt: '2026-11-04T08:00:00.000Z',
      updatedAt: '2026-11-04T08:00:00.000Z',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const path = String(input);
        if (path === '/api/auth/me') return jsonResponse(200, { user });
        if (path === '/api/topic-sets') return jsonResponse(200, { topicSets: [invalidSet] });
        if (path.startsWith('/api/recipients')) {
          return jsonResponse(200, { recipients: [], page: 1, pageSize: 25, total: 0 });
        }
        return jsonResponse(204, {});
      }),
    );

    render(<App />);

    expect(await screen.findByText('Topic sets could not be loaded.')).toBeInTheDocument();
    expect(screen.queryByText('Invalid set')).not.toBeInTheDocument();
  });

  it('lets members add and manage their recipients', async () => {
    const member = { ...user, name: 'Mina', role: 'member' };
    let createdRecipient: unknown;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/auth/me') return jsonResponse(200, { user: member });
      if (path.startsWith('/api/recipients')) {
        if (init?.method === 'POST') {
          createdRecipient = JSON.parse(String(init.body));
          return jsonResponse(201, { recipient });
        }
        return jsonResponse(200, { recipients: [recipient] });
      }
      return jsonResponse(204, {});
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    expect(await screen.findByText('Asha')).toBeInTheDocument();
    expect(
      screen.getByText('WhatsApp: +91********10 · Email: as***@example.test'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add recipient' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm consent' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add recipient' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Mina recipient' } });
    fireEvent.change(screen.getByLabelText('WhatsApp number (E.164)'), {
      target: { value: '+919876543210' },
    });
    fireEvent.change(screen.getByLabelText('Email id'), {
      target: { value: 'mina@example.test' },
    });
    fireEvent.change(screen.getByLabelText('Send through'), { target: { value: 'both' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save recipient' }));

    expect(await screen.findByText('Recipient added.')).toBeInTheDocument();
    expect(createdRecipient).toMatchObject({
      name: 'Mina recipient',
      whatsappE164: '+919876543210',
      email: 'mina@example.test',
      channel: 'both',
    });
  });

  it('records consent only with a note and updates the recipient state', async () => {
    let consentStatus = 'pending';
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
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
    expect(await screen.findByRole('button', { name: 'Add recipient' })).toBeInTheDocument();
    expect(await screen.findByText('Consent: pending')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm consent' }));
    fireEvent.change(screen.getByLabelText('Consent note (required)'), {
      target: { value: 'Agreed on call, 4 Nov' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save consent' }));
    expect(await screen.findByText('Consent: granted')).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([, init]) => String(init?.body).includes('Agreed on call, 4 Nov')),
    ).toBe(true);
    expect(document.querySelectorAll('.module-nav .module-link')).toHaveLength(7);
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

  it('lets a member open Alerts & Schedule and see their saved rule', async () => {
    const member = { ...user, name: 'Mina', role: 'member' };
    const memberRule = {
      id: '00000000-0000-4000-8000-000000000010',
      kind: 'digest',
      daysOfWeek: [1, 3, 5],
      timeLocal: '09:30',
      timezone: 'Asia/Kolkata',
      topics: ['Hospitals and industry'],
      channels: ['email'],
      active: true,
      createdAt: '2026-11-04T08:00:00.000Z',
    };
    const calls: string[] = [];
    window.history.pushState({}, '', '/alerts');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const path = String(input);
        calls.push(path);
        if (path === '/api/auth/me') return jsonResponse(200, { user: member });
        if (path.startsWith('/api/alert-rules')) {
          return jsonResponse(200, { rules: [memberRule], page: 1, pageSize: 25, total: 1 });
        }
        return jsonResponse(204, {});
      }),
    );

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Alerts & Schedule' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Alerts & Schedule' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Digest · 09:30 Asia/Kolkata' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Topics: Hospitals and industry · Channels: email'),
    ).toBeInTheDocument();
    expect(calls).toContain('/api/alert-rules');
  });

  it('lets a recipient unsubscribe from the public token page', async () => {
    const token = 'a'.repeat(64);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
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
