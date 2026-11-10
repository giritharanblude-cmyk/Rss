import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Navigate } from 'react-router-dom';
import { api } from '../api/client';
import type { DashboardNewsItem } from '../api/client';
import { AppHeader } from '../components/AppHeader';
import { LoadingState } from '../components/LoadingState';

export function HomePage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['me'],
    queryFn: api.me,
    retry: false,
  });
  const [online, setOnline] = useState(() => navigator.onLine);
  const [hidden, setHidden] = useState(() => document.visibilityState === 'hidden');

  useEffect(() => {
    const updateOnline = () => setOnline(navigator.onLine);
    const updateVisibility = () => setHidden(document.visibilityState === 'hidden');
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    document.addEventListener('visibilitychange', updateVisibility);
    return () => {
      window.removeEventListener('online', updateOnline);
      window.removeEventListener('offline', updateOnline);
      document.removeEventListener('visibilitychange', updateVisibility);
    };
  }, []);

  const live = useQuery({
    queryKey: ['dashboard-live'],
    queryFn: api.dashboardLive,
    enabled: online,
    refetchInterval: hidden ? 10_000 : 5_000,
    refetchIntervalInBackground: true,
    retry: false,
  });

  if (isLoading) {
    return (
      <main className="auth-page">
        <LoadingState label="Loading your account…" />
      </main>
    );
  }

  if (isError || !data) {
    return <Navigate to="/login" replace />;
  }

  const connections = live.data?.connections;

  return (
    <div className="app-frame">
      <AppHeader user={data.user} />
      <main className="app-main dashboard-main" id="main-content" tabIndex={-1}>
        <div className="section-heading">
          <div>
            <h1>Dashboard</h1>
            <p className="auth-subtitle">A live view of healthcare news collection and delivery.</p>
          </div>
          <span className="poll-state" role="status">
            {online
              ? live.isFetching
                ? 'Updating…'
                : 'Live updates on'
              : 'Offline · updates paused'}
          </span>
        </div>
        {live.isError ? (
          <p className="banner banner-error" role="alert">
            Dashboard data could not be refreshed. Retrying on the next poll.
          </p>
        ) : null}
        {live.data ? (
          <>
            <section className="metric-grid" aria-label="Today at a glance">
              <Metric label="Items today" value={live.data.itemsToday} />
              <Metric label="Active sources" value={live.data.activeSources} />
              <Metric label="Recipients" value={live.data.recipients} />
              <Metric label="Deliveries today" value={live.data.deliveriesToday} />
              <Metric label="Failed deliveries" value={live.data.failedDeliveries} />
              <Metric
                label="Last fetch"
                value={live.data.lastFetchAt ? formatDateTime(live.data.lastFetchAt) : 'Never'}
              />
            </section>
            <section className="connection-grid" aria-label="Service connections">
              <ConnectionLight
                label="OpenWA socket"
                connected={connections?.whatsapp ?? false}
                connectedText="Connected"
                disconnectedText={
                  connections?.whatsapp === undefined ? 'Not connected yet' : 'Disconnected'
                }
              />
              <ConnectionLight
                label="Hostinger email"
                connected={connections?.email ?? false}
                connectedText="Working"
                disconnectedText={
                  connections?.email === undefined ? 'Not connected yet' : 'Not working'
                }
              />
            </section>
            <section className="latest-section">
              <div className="section-heading">
                <h2>Latest items</h2>
                <a href="/news">View News Feed</a>
              </div>
              {live.data.latestItems.length ? (
                <div className="news-list">
                  {live.data.latestItems.map((item) => (
                    <LatestItem item={item} key={item.id} />
                  ))}
                </div>
              ) : (
                <p className="empty-state">No news items have been collected yet.</p>
              )}
            </section>
          </>
        ) : live.isLoading ? (
          <LoadingState label="Loading dashboard…" />
        ) : null}
      </main>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <article className="metric-card">
      <h2>{label}</h2>
      <p>{value}</p>
    </article>
  );
}

function ConnectionLight({
  label,
  connected,
  connectedText,
  disconnectedText,
}: {
  label: string;
  connected: boolean;
  connectedText: string;
  disconnectedText: string;
}) {
  return (
    <div className="connection-card">
      <span className={`connection-dot ${connected ? 'connection-ok' : 'connection-off'}`} />
      <span>{label}</span>
      <strong>{connected ? connectedText : disconnectedText}</strong>
    </div>
  );
}

function LatestItem({ item }: { item: DashboardNewsItem }) {
  return (
    <article className="news-card latest-card">
      <h3>
        <a href={item.link} target="_blank" rel="noopener noreferrer">
          {item.headline}
        </a>
      </h3>
      <p className="news-meta">
        {item.sourceName} · {item.category} · {formatDateTime(item.publishedAt ?? item.fetchedAt)}
      </p>
      {item.summary ? <p className="news-summary">{item.summary}</p> : null}
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
