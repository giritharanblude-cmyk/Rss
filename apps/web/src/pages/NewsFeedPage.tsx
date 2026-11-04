import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate } from 'react-router-dom';
import { NEWS_CATEGORIES } from '@healthcare/shared';
import type { NewsCategory } from '../api/client';
import { api, type DashboardNewsItem, type NewsFeedFilters } from '../api/client';
import { AppHeader } from '../components/AppHeader';
import { LoadingState } from '../components/LoadingState';
import { Toast } from '../components/Toast';

const pageSize = 20;

export function NewsFeedPage() {
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: api.me, retry: false });
  const sources = useQuery({ queryKey: ['sources'], queryFn: api.sources, retry: false });
  const [filters, setFilters] = useState<NewsFeedFilters>({ page: 1, pageSize });
  const [queryText, setQueryText] = useState('');
  const [category, setCategory] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [filterError, setFilterError] = useState<string | null>(null);
  const news = useQuery({
    queryKey: ['news', filters],
    queryFn: () => api.news(filters),
    retry: false,
  });
  const importance = useMutation({
    mutationFn: ({ id, important }: { id: string; important: boolean }) =>
      api.setImportant(id, important),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['news'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard-live'] });
    },
  });
  const sendNow = useMutation({
    mutationFn: ({ id, channel }: { id: string; channel: 'email' | 'whatsapp' }) =>
      api.sendNewsNow(id, channel),
    onSuccess: (result) => {
      setSendNotice(`Queued ${result.queued} ${result.queued === 1 ? 'delivery' : 'deliveries'}.`);
      void queryClient.invalidateQueries({ queryKey: ['delivery-list'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard-live'] });
    },
  });
  const [sendNotice, setSendNotice] = useState<string | null>(null);

  if (me.isLoading)
    return (
      <main className="app-main">
        <LoadingState label="Loading your account…" />
      </main>
    );
  if (me.isError || !me.data) return <Navigate to="/login" replace />;

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (from && to && from > to) {
      setFilterError('The start date must not be after the end date.');
      return;
    }
    setFilterError(null);
    setFilters({
      page: 1,
      pageSize,
      ...(queryText.trim() ? { q: queryText.trim() } : {}),
      ...(category ? { category: category as NewsCategory } : {}),
      ...(sourceId ? { sourceId } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    });
  }

  const totalPages = Math.max(1, Math.ceil((news.data?.total ?? 0) / pageSize));
  const canManage = me.data.user.role === 'master';

  return (
    <div className="app-frame">
      <AppHeader user={me.data.user} />
      <main className="app-main feed-main" id="main-content" tabIndex={-1}>
        <div className="section-heading">
          <div>
            <h1>News Feed</h1>
            <p className="auth-subtitle">The latest healthcare updates from your sources.</p>
          </div>
        </div>
        <form className="feed-filters" onSubmit={applyFilters} aria-label="Filter news">
          <label>
            Keyword
            <input
              type="search"
              value={queryText}
              onChange={(event) => setQueryText(event.target.value)}
              placeholder="Search headlines and summaries"
              maxLength={120}
            />
          </label>
          <label>
            Category
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="">All categories</option>
              {NEWS_CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label>
            Source
            <select value={sourceId} onChange={(event) => setSourceId(event.target.value)}>
              <option value="">All sources</option>
              {(sources.data?.sources ?? []).map((source) => (
                <option key={source.id} value={source.id}>
                  {source.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            From
            <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          </label>
          <label>
            To
            <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          </label>
          <button type="submit">Apply filters</button>
        </form>
        {filterError ? (
          <p className="banner banner-error" role="alert">
            {filterError}
          </p>
        ) : null}
        {sources.isError ? (
          <p className="banner banner-error" role="alert">
            Source filters could not be loaded.
          </p>
        ) : null}
        {news.isError ? (
          <p className="banner banner-error" role="alert">
            News could not be loaded. Try again.
          </p>
        ) : null}
        {news.isLoading ? <LoadingState label="Loading news…" /> : null}
        {news.data?.items.length === 0 ? (
          <p className="empty-state">No news matches these filters.</p>
        ) : null}
        <div className="news-list">
          {news.data?.items.map((item) => (
            <NewsCard
              key={item.id}
              item={item}
              isSaving={importance.isPending && importance.variables?.id === item.id}
              onToggle={() => importance.mutate({ id: item.id, important: !item.important })}
              canManage={canManage}
              canSend={canManage}
              sendPending={sendNow.isPending && sendNow.variables?.id === item.id}
              onSend={(channel) => sendNow.mutate({ id: item.id, channel })}
            />
          ))}
        </div>
        {importance.isError ? (
          <p className="banner banner-error" role="alert">
            {importance.error instanceof Error
              ? importance.error.message
              : 'Importance could not be updated.'}
          </p>
        ) : null}
        {sendNow.isError ? (
          <p className="banner banner-error" role="alert">
            {sendNow.error.message}
          </p>
        ) : null}
        <Toast message={sendNotice} onDismiss={() => setSendNotice(null)} />
        {news.data && news.data.total > 0 ? (
          <nav className="pagination" aria-label="News pages">
            <button
              type="button"
              className="button-secondary"
              disabled={filters.page <= 1}
              onClick={() => setFilters({ ...filters, page: filters.page - 1 })}
            >
              Previous
            </button>
            <span>
              Page {filters.page} of {totalPages} · {news.data.total} items
            </span>
            <button
              type="button"
              className="button-secondary"
              disabled={filters.page >= totalPages}
              onClick={() => setFilters({ ...filters, page: filters.page + 1 })}
            >
              Next
            </button>
          </nav>
        ) : null}
      </main>
    </div>
  );
}

function NewsCard({
  item,
  isSaving,
  onToggle,
  canManage,
  canSend,
  sendPending,
  onSend,
}: {
  item: DashboardNewsItem;
  isSaving: boolean;
  onToggle: () => void;
  canManage: boolean;
  canSend: boolean;
  sendPending: boolean;
  onSend: (channel: 'email' | 'whatsapp') => void;
}) {
  return (
    <article className={`news-card ${item.important ? 'news-important' : ''}`}>
      <div className="news-card-heading">
        <h2>{item.headline}</h2>
        {item.important ? <span className="important-label">Important</span> : null}
      </div>
      <p className="news-meta">
        {item.sourceName} · {item.category} · {formatDateTime(item.publishedAt ?? item.fetchedAt)}
      </p>
      {item.summary ? <p className="news-summary">{item.summary}</p> : null}
      <div className="news-actions">
        <a href={item.link} target="_blank" rel="noopener noreferrer">
          Read full article
        </a>
        {canManage ? (
          <button type="button" className="button-secondary" disabled={isSaving} onClick={onToggle}>
            {item.important ? 'Remove importance' : 'Mark as important'}
          </button>
        ) : null}
        {canSend ? (
          <>
            <button
              type="button"
              className="button-secondary"
              disabled={sendPending}
              onClick={() => onSend('whatsapp')}
            >
              Send now to WhatsApp
            </button>
            <button
              type="button"
              className="button-secondary"
              disabled={sendPending}
              onClick={() => onSend('email')}
            >
              Send now by email
            </button>
          </>
        ) : null}
      </div>
    </article>
  );
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(value));
}
