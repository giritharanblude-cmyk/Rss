import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate } from 'react-router-dom';
import {
  TOPIC_CATEGORIES,
  maskEmail,
  maskPhone,
  recipientInputSchema,
  topicSetInputSchema,
  type Recipient,
  type RecipientInput,
  type TopicCategory,
  type TopicSet,
  type TopicSetInput,
} from '@healthcare/shared';
import { api, ApiError } from '../api/client';
import { createTopicSet, deleteTopicSet, listTopicSets, updateTopicSet } from '../api/topic-sets';
import { AppHeader } from '../components/AppHeader';
import { LoadingState } from '../components/LoadingState';
import { Toast } from '../components/Toast';
import { PageControls } from '../components/PageControls';

const pageSize = 25;

const blankRecipient: RecipientInput = {
  name: '',
  whatsappE164: null,
  email: null,
  topics: [],
  channel: 'email',
};

const blankTopicSet: TopicSetInput = { name: '', categoryKeys: [] };

function messageOf(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

function RecipientForm({
  initial,
  topicSets,
  onSave,
  onCancel,
}: {
  initial: RecipientInput;
  topicSets: TopicSet[];
  onSave: (value: RecipientInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [values, setValues] = useState(initial);
  const [selectedTopicSetId, setSelectedTopicSetId] = useState('');
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

  function applyTopicSet() {
    const topicSet = topicSets.find((set) => set.id === selectedTopicSetId);
    if (topicSet) setValues({ ...values, topics: [...topicSet.categoryKeys] });
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
      {initial.whatsappE164 === null && initial.channel !== 'email' ? (
        <p>Saved WhatsApp number is masked. Enter it again to keep WhatsApp enabled.</p>
      ) : null}
      <input
        id="recipient-phone"
        type="tel"
        placeholder="+919876543210"
        value={values.whatsappE164 ?? ''}
        onChange={(event) => setValues({ ...values, whatsappE164: event.target.value || null })}
      />
      <label htmlFor="recipient-email">Email id</label>
      {initial.email === null && initial.channel !== 'whatsapp' ? (
        <p>Saved email address is masked. Enter it again to keep email enabled.</p>
      ) : null}
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
        <label htmlFor="recipient-topic-set">Use a topic set</label>
        <select
          id="recipient-topic-set"
          value={selectedTopicSetId}
          onChange={(event) => setSelectedTopicSetId(event.target.value)}
        >
          <option value="">Choose a topic set</option>
          {topicSets.map((topicSet) => (
            <option key={topicSet.id} value={topicSet.id}>
              {topicSet.name}
            </option>
          ))}
        </select>
        <button type="button" disabled={!selectedTopicSetId} onClick={applyTopicSet}>
          Use this set
        </button>
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
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Recipient | null>(null);
  const [adding, setAdding] = useState(false);
  const [consentFor, setConsentFor] = useState<string | null>(null);
  const [consentNote, setConsentNote] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [topicSetFormOpen, setTopicSetFormOpen] = useState(false);
  const [editingTopicSetId, setEditingTopicSetId] = useState<string | null>(null);
  const [topicSetValues, setTopicSetValues] = useState<TopicSetInput>(blankTopicSet);
  const [topicSetError, setTopicSetError] = useState<string | null>(null);
  const me = useQuery({ queryKey: ['me'], queryFn: api.me, retry: false });
  const list = useQuery({
    queryKey: ['recipients', search, page],
    queryFn: () => api.recipients(search, { page, pageSize }),
    retry: false,
  });
  const topicSets = useQuery({
    queryKey: ['topic-sets'],
    queryFn: listTopicSets,
    retry: false,
  });
  const refresh = () => client.invalidateQueries({ queryKey: ['recipients'] });
  const refreshTopicSets = () => client.invalidateQueries({ queryKey: ['topic-sets'] });
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
  const saveTopicSet = useMutation({
    mutationFn: ({ id, input }: { id: string | null; input: TopicSetInput }) =>
      id ? updateTopicSet(id, input) : createTopicSet(input),
    onSuccess: refreshTopicSets,
  });
  const removeTopicSet = useMutation({
    mutationFn: deleteTopicSet,
    onSuccess: refreshTopicSets,
  });

  if (me.isLoading || list.isLoading)
    return (
      <main className="app-main">
        <LoadingState label="Loading recipients…" />
      </main>
    );
  if (me.isError || !me.data) return <Navigate to="/login" replace />;
  if (list.isError || !list.data) {
    return (
      <div className="app-frame">
        <AppHeader user={me.data.user} />
        <main className="app-main sources-main" id="main-content" tabIndex={-1}>
          <h1>Recipients</h1>
          <p className="banner banner-error" role="alert">
            Recipients could not be loaded.
          </p>
          <button type="button" onClick={() => void list.refetch()}>
            Retry
          </button>
        </main>
      </div>
    );
  }
  async function save(input: RecipientInput) {
    setNotice(null);
    if (editing) await update.mutateAsync({ id: editing.id, body: input });
    else await create.mutateAsync(input);
    setEditing(null);
    setAdding(false);
    setNotice(editing ? 'Recipient updated.' : 'Recipient added.');
  }

  async function submitConsent(event: FormEvent<HTMLFormElement>, recipientId: string) {
    event.preventDefault();
    setNotice(null);
    try {
      await consent.mutateAsync({ id: recipientId, status: 'granted', note: consentNote });
      setConsentFor(null);
      setConsentNote('');
      setError(null);
      setNotice('Consent recorded.');
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
    setNotice(null);
    try {
      await consent.mutateAsync({ id: recipient.id, status: 'revoked' });
      setError(null);
      setNotice(`Consent revoked for ${recipient.name}.`);
    } catch (caught) {
      setError(messageOf(caught));
    }
  }

  async function deleteRecipient(recipient: Recipient) {
    if (!window.confirm(`Delete ${recipient.name}?`)) return;
    setNotice(null);
    try {
      await remove.mutateAsync(recipient.id);
      setError(null);
      setNotice(`${recipient.name} deleted.`);
    } catch (caught) {
      setError(messageOf(caught));
    }
  }

  function editTopicSet(topicSet: TopicSet) {
    setEditingTopicSetId(topicSet.id);
    setTopicSetValues({ name: topicSet.name, categoryKeys: [...topicSet.categoryKeys] });
    setTopicSetFormOpen(true);
    setTopicSetError(null);
  }

  function toggleTopicSetCategory(category: TopicCategory) {
    setTopicSetValues((current) => ({
      ...current,
      categoryKeys: current.categoryKeys.includes(category)
        ? current.categoryKeys.filter((value) => value !== category)
        : [...current.categoryKeys, category],
    }));
  }

  async function submitTopicSet(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = topicSetInputSchema.safeParse(topicSetValues);
    if (!parsed.success) {
      setTopicSetError(parsed.error.issues[0]?.message ?? 'Check the topic set details.');
      return;
    }
    setTopicSetError(null);
    try {
      await saveTopicSet.mutateAsync({ id: editingTopicSetId, input: parsed.data });
      setTopicSetValues(blankTopicSet);
      setEditingTopicSetId(null);
      setTopicSetFormOpen(false);
      setNotice(editingTopicSetId ? 'Topic set renamed.' : 'Topic set created.');
    } catch (caught) {
      setTopicSetError(messageOf(caught));
    }
  }

  function cancelTopicSetForm() {
    setTopicSetFormOpen(false);
    setEditingTopicSetId(null);
    setTopicSetValues(blankTopicSet);
    setTopicSetError(null);
  }

  async function removeTopicSetById(topicSet: TopicSet) {
    if (!window.confirm(`Delete the "${topicSet.name}" topic set?`)) return;
    setTopicSetError(null);
    try {
      await removeTopicSet.mutateAsync(topicSet.id);
      setNotice('Topic set deleted.');
    } catch (caught) {
      setTopicSetError(messageOf(caught));
    }
  }

  return (
    <div className="app-frame">
      <AppHeader user={me.data.user} />
      <main className="app-main sources-main" id="main-content" tabIndex={-1}>
        <div className="section-heading">
          <div>
            <h1>Recipients</h1>
            <p className="auth-subtitle">
              Manage contacts, topic preferences, and consent records.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setEditing(null);
              setAdding(true);
            }}
          >
            Add recipient
          </button>
        </div>
        <Toast message={notice} onDismiss={() => setNotice(null)} />
        <section className="settings-section" aria-labelledby="topic-sets-heading">
          <div className="section-heading">
            <div>
              <h2 id="topic-sets-heading">Topic sets</h2>
              <p className="form-hint">
                Custom names are labels; matching uses the fixed categories.
              </p>
            </div>
            {!topicSetFormOpen ? (
              <button
                type="button"
                onClick={() => {
                  setTopicSetValues(blankTopicSet);
                  setEditingTopicSetId(null);
                  setTopicSetError(null);
                  setTopicSetFormOpen(true);
                }}
              >
                Create topic set
              </button>
            ) : null}
          </div>
          {topicSetError ? (
            <p className="banner banner-error" role="alert">
              {topicSetError}
            </p>
          ) : null}
          {topicSets.isLoading ? <LoadingState label="Loading topic sets…" /> : null}
          {topicSets.isError ? (
            <p className="banner banner-error" role="alert">
              Topic sets could not be loaded.
            </p>
          ) : null}
          {topicSetFormOpen ? (
            <form className="source-form" onSubmit={(event) => void submitTopicSet(event)}>
              <h3>{editingTopicSetId ? 'Rename topic set' : 'New topic set'}</h3>
              <label htmlFor="topic-set-name">Name</label>
              <input
                id="topic-set-name"
                value={topicSetValues.name}
                maxLength={80}
                onChange={(event) =>
                  setTopicSetValues({ ...topicSetValues, name: event.target.value })
                }
                required
              />
              <fieldset className="topic-options">
                <legend>Fixed categories</legend>
                {TOPIC_CATEGORIES.map((category) => (
                  <label className="check-option" key={category}>
                    <input
                      type="checkbox"
                      checked={topicSetValues.categoryKeys.includes(category)}
                      onChange={() => toggleTopicSetCategory(category)}
                    />
                    {category}
                  </label>
                ))}
              </fieldset>
              <div className="source-form-actions">
                <button type="submit" disabled={saveTopicSet.isPending}>
                  {saveTopicSet.isPending ? 'Saving…' : 'Save topic set'}
                </button>
                <button type="button" className="button-secondary" onClick={cancelTopicSetForm}>
                  Cancel
                </button>
              </div>
            </form>
          ) : null}
          {topicSets.data?.length === 0 ? (
            <p className="empty-state">No topic sets saved yet.</p>
          ) : null}
          <div className="source-list">
            {topicSets.data?.map((topicSet) => (
              <article className="source-card" key={topicSet.id}>
                <h3>{topicSet.name}</h3>
                <p>{topicSet.categoryKeys.join(', ') || 'No categories selected'}</p>
                <div className="source-actions">
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() => editTopicSet(topicSet)}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    className="button-danger"
                    onClick={() => void removeTopicSetById(topicSet)}
                  >
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
        <label htmlFor="recipient-search">Search recipients</label>
        <input
          id="recipient-search"
          type="search"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
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
                    whatsappE164: null,
                    email: null,
                    topics: editing.topics,
                    channel: editing.channel,
                  }
                : blankRecipient
            }
            topicSets={topicSets.data ?? []}
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
                    {recipient.whatsappE164
                      ? `WhatsApp: ${maskPhone(recipient.whatsappE164)}`
                      : 'No WhatsApp number'}{' '}
                    · {recipient.email ? `Email: ${maskEmail(recipient.email)}` : 'No email'}
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
        <PageControls
          page={page}
          pageSize={pageSize}
          total={list.data.total}
          label="recipients"
          onPageChange={setPage}
        />
      </main>
    </div>
  );
}
