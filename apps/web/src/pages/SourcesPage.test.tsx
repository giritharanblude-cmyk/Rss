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
        return jsonResponse(200, { sources: [] });
      return jsonResponse(500, { error: 'Unexpected request' });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: /add source/i }));
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
