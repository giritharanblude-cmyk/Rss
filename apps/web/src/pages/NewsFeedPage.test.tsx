import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';

const user = {
  id: '00000000-0000-4000-8000-000000000000',
  name: 'Admin',
  role: 'master',
};
const source = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Health News',
  website: 'https://news.example.test',
  rssUrl: 'https://news.example.test/feed.xml',
  mode: 'all',
  topics: [],
  region: null,
  intervalMinutes: 60,
  active: true,
  lastFetchedAt: null,
  lastStatus: null,
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

beforeEach(() => {
  window.history.pushState({}, '', '/news');
});

afterEach(() => vi.unstubAllGlobals());

describe('NewsFeedPage', () => {
  it('filters news, marks an item important, and keeps safe external links', async () => {
    let important = false;
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const path = String(input);
        calls.push(path);
        if (path === '/api/auth/me') return jsonResponse(200, { user });
        if (path === '/api/sources') return jsonResponse(200, { sources: [source] });
        if (path.startsWith('/api/news/') && path.endsWith('/important')) {
          important = true;
          return jsonResponse(200, {
            id: '00000000-0000-4000-8000-000000000002',
            important,
          });
        }
        if (path.startsWith('/api/news?')) {
          return jsonResponse(200, {
            page: 1,
            pageSize: 20,
            total: 1,
            items: [
              {
                id: '00000000-0000-4000-8000-000000000002',
                sourceId: source.id,
                sourceName: source.name,
                headline: 'Vaccine advisory for hospitals',
                summary: 'New vaccine guidance for clinicians.',
                link: 'https://news.example.test/story',
                category: 'Outbreaks and public health',
                publishedAt: '2026-11-03T08:00:00.000Z',
                fetchedAt: '2026-11-03T08:00:00.000Z',
                important,
              },
            ],
          });
        }
        return jsonResponse(204, {});
      }),
    );

    render(<App />);

    expect(
      await screen.findByRole('heading', { name: 'Vaccine advisory for hospitals' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Modules' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Read full article' })[0]).toHaveAttribute(
      'rel',
      'noopener noreferrer',
    );
    expect(screen.getByRole('button', { name: 'Send now to WhatsApp' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Keyword'), { target: { value: 'vaccine' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    await waitFor(() => expect(calls.some((path) => path.includes('q=vaccine'))).toBe(true));

    const importantButton = await screen.findByRole('button', { name: 'Mark as important' });
    fireEvent.click(importantButton);
    expect(await screen.findByText('Important')).toBeInTheDocument();
    expect(calls.some((path) => path.endsWith('/important'))).toBe(true);
  });
});
