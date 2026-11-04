import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate } from 'react-router-dom';
import {
  TOPIC_CATEGORIES,
  recipientInputSchema,
  type Recipient,
  type RecipientInput,
} from '@healthcare/shared';
import { api, ApiError } from '../api/client';
import { AppHeader } from '../components/AppHeader';

const blankRecipient: RecipientInput = {
  name: '',
  whatsappE164: null,
  email: null,
  topics: [],
  channel: 'email',
};

function messageOf(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

function RecipientForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: RecipientInput;
  onSave: (value: RecipientInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [values, setValues] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = recipientInputSchema.safeParse({
      ...values,
      name: values.name.trim(),
      email: values.email?.trim() || null,
      whatsappE164: values.whatsappE164?.trim() || null,
    });
    if (!result.success) {
      setError(result.error.issues[0]?.message ?? 'Check recipient details.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave(result.data);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  function toggleTopic(topic: RecipientInput['topics'][number]) {
    setValues({
      ...values,
      topics: values.topics.includes(topic)
        ? values.topics.filter((value) => value !== topic)
        : [...values.topics, topic],
    });
  }

  return (
    <form className="source-form recipient-form" onSubmit={(event) => void submit(event)}>
      {error ? (
        <p className="banner banner-error" role="alert">
          {error}
        </p>
      ) : null}
      <label htmlFor="recipient-name">Name</label>
      <input
        id="recipient-name"
        value={values.name}
        onChange={(event) => setValues({ ...values, name: event.target.value })}
        required
      />
      <label htmlFor="recipient-phone">WhatsApp number (E.164)</label>
      <input
        id="recipient-phone"
        type="tel"
        placeholder="+919876543210"
        value={values.whatsappE164 ?? ''}
        onChange={(event) => setValues({ ...values, whatsappE164: event.target.value || null })}
      />
      <label htmlFor="recipient-email">Email id</label>
      <input
        id="recipient-email"
        type="email"
        value={values.email ?? ''}
        onChange={(event) => setValues({ ...values, email: event.target.value || null })}
      />
      <label htmlFor="recipient-channel">Send through</label>
      <select
        id="recipient-channel"
        value={values.channel}
        onChange={(event) =>
          setValues({ ...values, channel: event.target.value as RecipientInput['channel'] })
        }
      >
        <option value="whatsapp">WhatsApp</option>
        <option value="email">Email</option>
        <option value="both">Both</option>
      </select>
      <fieldset className="topic-options">
        <legend>Topics they want</legend>
        {TOPIC_CATEGORIES.map((topic) => (
          <label className="check-option" key={topic}>
            <input
              type="checkbox"
              checked={values.topics.includes(topic)}
              onChange={() => toggleTopic(topic)}
            />
            {topic}
          </label>
        ))}
      </fieldset>
      <div className="source-form-actions">
        <button type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save recipient'}
        </button>
        <button type="button" className="button-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function RecipientsPage() {
  const client = useQueryClient();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Recipient | null>(null);
  const [adding, setAdding] = useState(false);
  const [consentFor, setConsentFor] = useState<string | null>(null);
  const [consentNote, setConsentNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const me = useQuery({ queryKey: ['me'], queryFn: api.me, retry: false });
  const list = useQuery({
    queryKey: ['recipients', search],
    queryFn: () => api.recipients(search),
    retry: false,
  });
  const refresh = () => client.invalidateQueries({ queryKey: ['recipients'] });
  const create = useMutation({ mutationFn: api.createRecipient, onSuccess: refresh });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: RecipientInput }) =>
      api.updateRecipient(id, body),
    onSuccess: refresh,
  });
  const remove = useMutation({ mutationFn: api.deleteRecipient, onSuccess: refresh });
  const consent = useMutation({
    mutationFn: ({
      id,
      status,
      note,
    }: {
      id: string;
      status: 'granted' | 'revoked';
      note?: string;
    }) => api.setConsent(id, { status, ...(note ? { note } : {}) }),
    onSuccess: refresh,
  });

  if (me.isLoading || list.isLoading)
    return (
      <main className="app-main">
        <p role="status">Loading recipients…</p>
      </main>
    );
  if (me.isError || !me.data || list.isError || !list.data) return <Navigate to="/login" replace />;
  const canEdit = me.data.user.role === 'master';

  async function save(input: RecipientInput) {
    if (editing) await update.mutateAsync({ id: editing.id, body: input });
    else await create.mutateAsync(input);
    setEditing(null);
    setAdding(false);
  }

  async function submitConsent(event: FormEvent<HTMLFormElement>, recipientId: string) {
    event.preventDefault();
    try {
      await consent.mutateAsync({ id: recipientId, status: 'granted', note: consentNote });
      setConsentFor(null);
      setConsentNote('');
      setError(null);
    } catch (caught) {
      setError(messageOf(caught));
    }
  }

  async function revoke(recipient: Recipient) {
    if (
      !window.confirm(
        `Revoke consent for ${recipient.name}? They will be excluded from previews and future sends.`,
      )
    )
      return;
    try {
      await consent.mutateAsync({ id: recipient.id, status: 'revoked' });
      setError(null);
    } catch (caught) {
      setError(messageOf(caught));
    }
  }

  async function deleteRecipient(recipient: Recipient) {
    if (!window.confirm(`Delete ${recipient.name}?`)) return;
    try {
      await remove.mutateAsync(recipient.id);
      setError(null);
    } catch (caught) {
      setError(messageOf(caught));
    }
  }

  return (
    <div className="app-frame">
      <AppHeader user={me.data.user} />
      <main className="app-main sources-main">
        <div className="section-heading">
          <div>
            <h1>Recipients</h1>
            <p className="auth-subtitle">
              Manage contacts, topic preferences, and consent records.
            </p>
          </div>
          {canEdit ? (
            <button
              type="button"
              onClick={() => {
                setEditing(null);
                setAdding(true);
              }}
            >
              Add recipient
            </button>
          ) : null}
        </div>
        <label htmlFor="recipient-search">Search recipients</label>
        <input
          id="recipient-search"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search name or email"
        />
        {error ? (
          <p className="banner banner-error" role="alert">
            {error}
          </p>
        ) : null}
        {adding || editing ? (
          <RecipientForm
            initial={
              editing
                ? {
                    name: editing.name,
                    whatsappE164: editing.whatsappE164,
                    email: editing.email,
                    topics: editing.topics,
                    channel: editing.channel,
                  }
                : blankRecipient
            }
            onSave={save}
            onCancel={() => {
              setAdding(false);
              setEditing(null);
            }}
          />
        ) : null}
        {list.data.recipients.length === 0 ? (
          <p className="empty-state">No recipients match this search.</p>
        ) : null}
        <div className="source-list">
          {list.data.recipients.map((recipient) => (
            <article className="source-card" key={recipient.id}>
              <div className="source-card-header">
                <div>
                  <h2>{recipient.name}</h2>
                  <p>
                    {recipient.whatsappE164 ?? 'No WhatsApp number'} ·{' '}
                    {recipient.email ?? 'No email'}
                  </p>
                </div>
                <span className={`consent-badge consent-${recipient.consentStatus}`}>
                  Consent: {recipient.consentStatus}
                </span>
              </div>
              <p>
                Topics: {recipient.topics.join(', ') || 'None selected'} · Channel:{' '}
                {recipient.channel}
              </p>
              {recipient.consentNote ? (
                <p>
                  Consent note: {recipient.consentNote} ·{' '}
                  {recipient.consentAt ? new Date(recipient.consentAt).toLocaleString() : ''}
                </p>
              ) : null}
              {canEdit ? (
                <div className="source-actions">
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() => {
                      setAdding(false);
                      setEditing(recipient);
                    }}
                  >
                    Edit
                  </button>
                  {recipient.consentStatus === 'granted' ? (
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() => void revoke(recipient)}
                    >
                      Revoke consent
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setConsentFor(recipient.id);
                        setConsentNote('');
                      }}
                    >
                      Confirm consent
                    </button>
                  )}
                  <button
                    type="button"
                    className="button-danger"
                    onClick={() => void deleteRecipient(recipient)}
                  >
                    Delete
                  </button>
                </div>
              ) : null}
              {consentFor === recipient.id ? (
                <form
                  className="consent-form"
                  onSubmit={(event) => void submitConsent(event, recipient.id)}
                >
                  <label htmlFor={`consent-note-${recipient.id}`}>Consent note (required)</label>
                  <input
                    id={`consent-note-${recipient.id}`}
                    value={consentNote}
                    onChange={(event) => setConsentNote(event.target.value)}
                    required
                    maxLength={500}
                    placeholder="Agreed on call, 4 Nov"
                  />
                  <button type="submit" disabled={consent.isPending}>
                    Save consent
                  </button>
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() => setConsentFor(null)}
                  >
                    Cancel
                  </button>
                </form>
              ) : null}
            </article>
          ))}
        </div>
      </main>
    </div>
  );
}
