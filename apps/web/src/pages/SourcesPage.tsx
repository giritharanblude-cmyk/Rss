import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate } from 'react-router-dom';
import {
  NEWS_CATEGORIES,
  SOURCE_INTERVALS,
  sourceInputSchema,
  type Source,
  type SourceInput,
} from '@healthcare/shared';
import { api, ApiError } from '../api/client';
import { AppHeader } from '../components/AppHeader';
import { LoadingState } from '../components/LoadingState';
import { Toast } from '../components/Toast';
import { PageControls } from '../components/PageControls';

const pageSize = 25;

const blankSource: SourceInput = {
  name: '',
  website: '',
  rssUrl: '',
  mode: 'all',
  topics: [],
  region: null,
  intervalMinutes: 60,
  active: true,
};

function errorText(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

function SourceForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: SourceInput;
  onSave: (input: SourceInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [values, setValues] = useState(initial);
  const [topicText, setTopicText] = useState(initial.topics.join(', '));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const topics = topicText
      .split(',')
      .map((topic) => topic.trim())
      .filter(Boolean);
    if (values.mode === 'topics' && topics.length === 0) {
      setError('Enter at least one topic for Specific Topics mode.');
      return;
    }
    const result = sourceInputSchema.safeParse({
      ...values,
      topics,
      region: values.region?.trim() || null,
    });
    if (!result.success) {
      setError(result.error.issues[0]?.message ?? 'Check the source details.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave(result.data);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="source-form" onSubmit={(event) => void submit(event)}>
      {error ? (
        <p role="alert" className="banner banner-error">
          {error}
        </p>
      ) : null}
      <label htmlFor="source-name">Source name</label>
      <input
        id="source-name"
        value={values.name}
        onChange={(event) => setValues({ ...values, name: event.target.value })}
        required
      />
      <label htmlFor="source-website">Website</label>
      <input
        id="source-website"
        type="url"
        value={values.website}
        onChange={(event) => setValues({ ...values, website: event.target.value })}
        required
      />
      <label htmlFor="source-rss">RSS link</label>
      <input
        id="source-rss"
        type="url"
        value={values.rssUrl}
        onChange={(event) => setValues({ ...values, rssUrl: event.target.value })}
        required
      />
      <label htmlFor="source-mode">Update mode</label>
      <select
        id="source-mode"
        value={values.mode}
        onChange={(event) =>
          setValues({ ...values, mode: event.target.value as SourceInput['mode'] })
        }
      >
        <option value="all">All Updates</option>
        <option value="topics">Specific Topics</option>
      </select>
      {values.mode === 'topics' ? (
        <>
          <label htmlFor="source-topics">Topics (comma separated)</label>
          <input
            id="source-topics"
            value={topicText}
            onChange={(event) => setTopicText(event.target.value)}
          />
        </>
      ) : null}
      <label htmlFor="source-region">Region (optional)</label>
      <input
        id="source-region"
        value={values.region ?? ''}
        onChange={(event) => setValues({ ...values, region: event.target.value || null })}
      />
      <label htmlFor="source-interval">Fetch time</label>
      <select
        id="source-interval"
        value={values.intervalMinutes}
        onChange={(event) =>
          setValues({
            ...values,
            intervalMinutes: Number(event.target.value) as SourceInput['intervalMinutes'],
          })
        }
      >
        {SOURCE_INTERVALS.map((minutes) => (
          <option key={minutes} value={minutes}>
            {minutes === 30 ? '30 minutes' : minutes === 60 ? '1 hour' : '6 hours'}
          </option>
        ))}
      </select>
      <div className="source-form-actions">
        <button type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save source'}
        </button>
        <button type="button" className="button-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

async function waitForFeedTest(id: string) {
  for (let attempt = 0; attempt < 36; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    const job = await api.feedTestStatus(id);
    if (job.status === 'done' || job.status === 'failed') return job;
  }
  throw new Error('The feed test is taking too long. Check the source status and try again.');
}

export function SourcesPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Source | null>(null);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const me = useQuery({ queryKey: ['me'], queryFn: api.me, retry: false });
  const sources = useQuery({
    queryKey: ['sources', page],
    queryFn: () => api.sources({ page, pageSize }),
    retry: false,
  });

  const refresh = async () => queryClient.invalidateQueries({ queryKey: ['sources'] });
  const create = useMutation({
    mutationFn: api.createSource,
    onSuccess: async () => {
      await refresh();
      setNotice('Source added.');
    },
  });
  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<SourceInput> }) =>
      api.updateSource(id, input),
    onSuccess: async () => {
      await refresh();
      setNotice('Source updated.');
    },
  });
  const remove = useMutation({
    mutationFn: api.deleteSource,
    onSuccess: async () => {
      await refresh();
      setNotice('Source deleted.');
    },
  });

  if (me.isLoading || sources.isLoading)
    return (
      <main className="app-main">
        <LoadingState label="Loading sources…" />
      </main>
    );
  if (me.isError || !me.data) return <Navigate to="/login" replace />;
  if (sources.isError || !sources.data) {
    return (
      <div className="app-frame">
        <AppHeader user={me.data.user} />
        <main className="app-main sources-main" id="main-content" tabIndex={-1}>
          <h1>Sources</h1>
          <p className="banner banner-error" role="alert">
            Sources could not be loaded.
          </p>
          <button type="button" onClick={() => void sources.refetch()}>
            Retry
          </button>
        </main>
      </div>
    );
  }
  const canEdit = me.data.user.role === 'master';

  async function save(input: SourceInput) {
    setNotice(null);
    if (editing) {
      await update.mutateAsync({ id: editing.id, input });
      setEditing(null);
    } else {
      await create.mutateAsync(input);
      setAdding(false);
    }
    setError(null);
  }

  async function toggle(source: Source) {
    setNotice(null);
    try {
      await update.mutateAsync({ id: source.id, input: { active: !source.active } });
      setError(null);
    } catch (caught) {
      setError(errorText(caught));
    }
  }

  async function testFeed(rssUrl: string) {
    setNotice(null);
    setNotice('Feed test queued…');
    setError(null);
    try {
      const job = await api.testFeed(rssUrl);
      const result = await waitForFeedTest(job.id);
      if (result.status === 'failed') throw new Error(result.message ?? 'Feed test failed.');
      setNotice(`Feed is readable: ${result.itemCount ?? 0} items found.`);
    } catch (caught) {
      setError(errorText(caught));
      setNotice(null);
    }
  }

  async function deleteSource(source: Source) {
    if (!window.confirm(`Delete ${source.name}?`)) return;
    try {
      await remove.mutateAsync(source.id);
      setError(null);
    } catch (caught) {
      setError(errorText(caught));
    }
  }

  return (
    <div className="app-frame">
      <AppHeader user={me.data.user} />
      <main className="app-main sources-main" id="main-content" tabIndex={-1}>
        <div className="section-heading">
          <div>
            <h1>Sources</h1>
            <p className="auth-subtitle">Manage the RSS feeds used to collect healthcare news.</p>
          </div>
          {canEdit ? (
            <button
              type="button"
              onClick={() => {
                setEditing(null);
                setAdding(true);
              }}
            >
              Add source
            </button>
          ) : null}
        </div>
        <Toast message={notice} onDismiss={() => setNotice(null)} />
        {error ? (
          <p className="banner banner-error" role="alert">
            {error}
          </p>
        ) : null}
        {adding || editing ? (
          <SourceForm
            initial={
              editing
                ? {
                    name: editing.name,
                    website: editing.website,
                    rssUrl: editing.rssUrl,
                    mode: editing.mode,
                    topics: editing.topics,
                    region: editing.region,
                    intervalMinutes: editing.intervalMinutes,
                    active: editing.active,
                  }
                : blankSource
            }
            onSave={save}
            onCancel={() => {
              setAdding(false);
              setEditing(null);
            }}
          />
        ) : null}
        {sources.data.sources.length === 0 ? <p>No sources have been added yet.</p> : null}
        <div className="source-list">
          {sources.data.sources.map((source) => (
            <article className="source-card" key={source.id}>
              <div className="source-card-header">
                <div>
                  <h2>{source.name}</h2>
                  <a href={source.website} target="_blank" rel="noopener noreferrer">
                    {source.website}
                  </a>
                </div>
                <span className={`source-state ${source.active ? 'source-active' : ''}`}>
                  {source.active ? 'Active' : 'Paused'}
                </span>
              </div>
              <p>
                <a href={source.rssUrl} target="_blank" rel="noopener noreferrer">
                  RSS feed
                </a>{' '}
                ·{' '}
                {source.mode === 'all'
                  ? 'All Updates'
                  : `Specific Topics: ${source.topics.join(', ') || 'none set'}`}
              </p>
              <p>
                Region: {source.region || 'Any'} · Fetch every{' '}
                {source.intervalMinutes === 30
                  ? '30 minutes'
                  : source.intervalMinutes === 60
                    ? '1 hour'
                    : '6 hours'}
              </p>
              <p>Last status: {source.lastStatus ?? 'Not fetched yet'}</p>
              {canEdit ? (
                <div className="source-actions">
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() => void testFeed(source.rssUrl)}
                  >
                    Test feed
                  </button>
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() => {
                      setAdding(false);
                      setEditing(source);
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() => void toggle(source)}
                  >
                    {source.active ? 'Pause' : 'Resume'}
                  </button>
                  <button
                    type="button"
                    className="button-danger"
                    onClick={() => void deleteSource(source)}
                  >
                    Delete
                  </button>
                </div>
              ) : null}
            </article>
          ))}
        </div>
        <details className="category-config">
          <summary>News categories</summary>
          <p>Category keywords are configured in the API categorizer.</p>
          <ul>
            {NEWS_CATEGORIES.map((category) => (
              <li key={category}>{category}</li>
            ))}
          </ul>
        </details>
        <PageControls
          page={page}
          pageSize={pageSize}
          total={sources.data.total}
          label="sources"
          onPageChange={setPage}
        />
      </main>
    </div>
  );
}
