import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

beforeEach(() => {
  window.history.pushState({}, '', '/sources');
});

afterEach(() => vi.unstubAllGlobals());

describe('SourcesPage', () => {
  it('lets members add and manage their sources without showing the feed-test control', async () => {
    let createdSource: unknown;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const path = String(input);
      if (String(input) === '/api/auth/me') {
        return jsonResponse(200, {
          user: {
            id: '00000000-0000-4000-8000-000000000001',
            name: 'Mina',
            role: 'member',
          },
        });
      }
      if (path.startsWith('/api/sources') && _init?.method === 'POST') {
        createdSource = JSON.parse(String(_init.body));
        return jsonResponse(201, {
          source: {
            id: '00000000-0000-4000-8000-000000000003',
            name: 'Member source',
            website: 'https://member.example.test',
            rssUrl: 'https://member.example.test/feed.xml',
            mode: 'all',
            topics: [],
            region: null,
            intervalMinutes: 60,
            active: true,
            lastFetchedAt: null,
            lastStatus: null,
            createdAt: '2026-11-04T08:00:00.000Z',
          },
        });
      }
      if (path.startsWith('/api/sources')) {
        return jsonResponse(200, {
          sources: [
            {
              id: '00000000-0000-4000-8000-000000000002',
              name: '[DEMO] Sample source',
              website: 'https://example.test',
              rssUrl: 'https://example.test/feed.xml',
              mode: 'all',
              topics: [],
              region: null,
              intervalMinutes: 60,
              active: true,
              lastFetchedAt: null,
              lastStatus: null,
              createdAt: '2026-11-04T08:00:00.000Z',
            },
          ],
        });
      }
      return jsonResponse(204, {});
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    expect(await screen.findByText('[DEMO] Sample source')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add source' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Test feed' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add source' }));
    fireEvent.change(screen.getByLabelText(/source name/i), {
      target: { value: 'Member source' },
    });
    fireEvent.change(screen.getByLabelText(/^website$/i), {
      target: { value: 'https://member.example.test' },
    });
    fireEvent.change(screen.getByLabelText(/rss link/i), {
      target: { value: 'https://member.example.test/feed.xml' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save source/i }));

    expect(await screen.findByText('Source added.')).toBeInTheDocument();
    expect(createdSource).toMatchObject({
      name: 'Member source',
      website: 'https://member.example.test',
      rssUrl: 'https://member.example.test/feed.xml',
    });
  });

  it('validates HTTP feed URLs and presents only supported intervals', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/auth/me') {
        return jsonResponse(200, {
          user: {
            id: '00000000-0000-4000-8000-000000000000',
            name: 'Admin',
            role: 'master',
          },
        });
      }
      if (String(input) === '/api/sources' && init?.method !== 'POST')
        return jsonResponse(200, {
          sources: [
            {
              id: '00000000-0000-4000-8000-000000000004',
              name: 'Master source',
              website: 'https://master.example.test',
              rssUrl: 'https://master.example.test/feed.xml',
              mode: 'all',
              topics: [],
              region: null,
              intervalMinutes: 60,
              active: true,
              lastFetchedAt: null,
              lastStatus: null,
              createdAt: '2026-11-04T08:00:00.000Z',
            },
          ],
        });
      return jsonResponse(500, { error: 'Unexpected request' });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    expect(await screen.findByRole('button', { name: 'Add source' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Test feed' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /add source/i }));
    fireEvent.change(screen.getByLabelText(/source name/i), {
      target: { value: 'Health News' },
    });
    fireEvent.change(screen.getByLabelText(/^website$/i), {
      target: { value: 'ftp://news.example.test' },
    });
    fireEvent.change(screen.getByLabelText(/rss link/i), {
      target: { value: 'https://news.example.test/rss' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save source/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a valid HTTP or HTTPS URL');
    expect(screen.getByLabelText(/fetch time/i).querySelectorAll('option')).toHaveLength(3);
    expect(fetchMock.mock.calls.some(([input]) => String(input) === '/api/sources')).toBe(true);
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) => String(input) === '/api/sources' && init?.method === 'POST',
      ),
    ).toBe(false);

    fireEvent.change(screen.getByLabelText(/^website$/i), {
      target: { value: 'https://news.example.test' },
    });
    fireEvent.change(screen.getByLabelText(/update mode/i), { target: { value: 'topics' } });
    fireEvent.click(screen.getByRole('button', { name: /save source/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Enter at least one topic for Specific Topics mode.',
    );
  });
});
