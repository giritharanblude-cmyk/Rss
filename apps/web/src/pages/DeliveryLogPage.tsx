import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate } from 'react-router-dom';
import type { DeliveryFilters } from '../api/client';
import { api } from '../api/client';
import { AppHeader } from '../components/AppHeader';
import { LoadingState } from '../components/LoadingState';
import { Toast } from '../components/Toast';

const pageSize = 25;

export function DeliveryLogPage() {
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: api.me, retry: false });
  const recipients = useQuery({
    queryKey: ['recipients'],
    queryFn: () => api.recipients(),
    retry: false,
  });
  const [filters, setFilters] = useState<DeliveryFilters>({});
  const [draft, setDraft] = useState<DeliveryFilters>({});
  const [page, setPage] = useState(1);
  const [filterError, setFilterError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const deliveries = useQuery({
    queryKey: ['delivery-list', filters, page],
    queryFn: () => api.deliveries({ ...filters, page, pageSize }),
    retry: false,
  });
  const resend = useMutation({
    mutationFn: api.resendDelivery,
    onSuccess: () => {
      setNotice('Delivery queued again.');
      void queryClient.invalidateQueries({ queryKey: ['delivery-list'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard-live'] });
    },
  });

  if (me.isLoading)
    return (
      <main className="app-main">
        <LoadingState label="Loading your account…" />
      </main>
    );
  if (me.isError || !me.data) return <Navigate to="/login" replace />;

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (draft.from && draft.to && draft.from > draft.to) {
      setFilterError('The start date must not be after the end date.');
      return;
    }
    setFilterError(null);
    setPage(1);
    setFilters({ ...draft });
  }

  const totalPages = Math.max(1, Math.ceil((deliveries.data?.total ?? 0) / pageSize));

  return (
    <div className="app-frame">
      <AppHeader user={me.data.user} />
      <main className="app-main feed-main" id="main-content" tabIndex={-1}>
        <div className="section-heading">
          <div>
            <h1>Delivery Log</h1>
            <p className="auth-subtitle">
              Track queued, sent, and failed email and WhatsApp messages.
            </p>
          </div>
          <div className="export-links" aria-label="Export deliveries">
            <a href={api.deliveryExportUrl('csv', filters)}>Export CSV</a>
            <a href={api.deliveryExportUrl('xlsx', filters)}>Export Excel</a>
          </div>
        </div>
        <form className="feed-filters" onSubmit={applyFilters} aria-label="Filter deliveries">
          <label>
            From
            <input
              type="date"
              value={draft.from ?? ''}
              onChange={(event) => setDraft({ ...draft, from: event.target.value })}
            />
          </label>
          <label>
            To
            <input
              type="date"
              value={draft.to ?? ''}
              onChange={(event) => setDraft({ ...draft, to: event.target.value })}
            />
          </label>
          <label>
            Channel
            <select
              value={draft.channel ?? ''}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  channel: (event.target.value || undefined) as DeliveryFilters['channel'],
                })
              }
            >
              <option value="">All channels</option>
              <option value="email">Email</option>
              <option value="whatsapp">WhatsApp</option>
            </select>
          </label>
          <label>
            Recipient
            <select
              value={draft.recipientId ?? ''}
              onChange={(event) =>
                setDraft({ ...draft, recipientId: event.target.value || undefined })
              }
            >
              <option value="">All recipients</option>
              {(recipients.data?.recipients ?? []).map((recipient) => (
                <option key={recipient.id} value={recipient.id}>
                  {recipient.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select
              value={draft.status ?? ''}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  status: (event.target.value || undefined) as DeliveryFilters['status'],
                })
              }
            >
              <option value="">All statuses</option>
              {['pending', 'retrying', 'delivered', 'failed'].map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
          <button type="submit">Apply filters</button>
        </form>
        {filterError ? (
          <p className="banner banner-error" role="alert">
            {filterError}
          </p>
        ) : null}
        {recipients.isError ? (
          <p className="banner banner-error" role="alert">
            Recipients could not be loaded.
          </p>
        ) : null}
        {deliveries.isError ? (
          <p className="banner banner-error" role="alert">
            Delivery history could not be loaded.
          </p>
        ) : null}
        {resend.isError ? (
          <p className="banner banner-error" role="alert">
            {resend.error.message}
          </p>
        ) : null}
        <Toast message={notice} onDismiss={() => setNotice(null)} />
        {deliveries.isLoading ? <LoadingState label="Loading deliveries…" /> : null}
        {deliveries.data?.items.length === 0 ? (
          <p className="empty-state">No deliveries match these filters.</p>
        ) : null}
        {deliveries.data?.items.length ? (
          <div className="delivery-table-wrap">
            <table className="delivery-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Recipient</th>
                  <th>Channel</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Attempts</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {deliveries.data.items.map((delivery) => (
                  <tr key={delivery.id}>
                    <td>{formatDateTime(delivery.queuedAt)}</td>
                    <td>
                      {delivery.recipientName}
                      <small>{delivery.recipientContact ?? 'No contact'}</small>
                    </td>
                    <td>{delivery.channel}</td>
                    <td>{delivery.kind.replaceAll('_', ' ')}</td>
                    <td>
                      <span className={`delivery-status delivery-${delivery.status}`}>
                        {delivery.status}
                      </span>
                    </td>
                    <td>{delivery.attempts}</td>
                    <td>
                      {delivery.lastError ? <span>{delivery.lastError}</span> : null}
                      {delivery.status === 'failed' && me.data.user.role === 'master' ? (
                        <button
                          type="button"
                          className="button-secondary"
                          disabled={resend.isPending}
                          onClick={() => resend.mutate(delivery.id)}
                        >
                          Resend
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {deliveries.data && deliveries.data.total > 0 ? (
          <nav className="pagination" aria-label="Delivery pages">
            <button
              type="button"
              className="button-secondary"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </button>
            <span>
              Page {page} of {totalPages} · {deliveries.data.total} deliveries
            </span>
            <button
              type="button"
              className="button-secondary"
              disabled={page >= totalPages}
              onClick={() => setPage(page + 1)}
            >
              Next
            </button>
          </nav>
        ) : null}
      </main>
    </div>
  );
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(value));
}
