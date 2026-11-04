import { useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { TOPIC_CATEGORIES } from '@healthcare/shared';
import type { RecipientInput } from '@healthcare/shared';
import { api, ApiError } from '../api/client';
import { LoadingState } from '../components/LoadingState';
import { Toast } from '../components/Toast';

function errorText(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

export function ManageTopicsPage() {
  const { token = '' } = useParams();
  const preferences = useQuery({
    queryKey: ['public-preferences', token],
    queryFn: () => api.publicPreferences(token),
    retry: false,
  });
  const [topics, setTopics] = useState<RecipientInput['topics'] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const update = useMutation({
    mutationFn: (selected: RecipientInput['topics']) =>
      api.updatePublicPreferences(token, selected),
    onSuccess: (response) => {
      setTopics(response.topics);
      setNotice('Your topic preferences have been saved.');
    },
  });

  if (preferences.isLoading)
    return (
      <main className="auth-page">
        <LoadingState label="Loading preferences…" />
      </main>
    );
  if (preferences.isError || !preferences.data) {
    return (
      <main className="auth-page">
        <section className="auth-card public-card">
          <h1>Preferences unavailable</h1>
          <p className="banner banner-error" role="alert">
            {preferences.error
              ? errorText(preferences.error)
              : 'This preferences link is invalid or has expired.'}
          </p>
        </section>
      </main>
    );
  }
  const selected = topics ?? preferences.data.topics;

  function toggle(topic: RecipientInput['topics'][number]) {
    setTopics(
      selected.includes(topic) ? selected.filter((item) => item !== topic) : [...selected, topic],
    );
    setNotice(null);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    update.mutate(selected);
  }

  return (
    <main className="auth-page">
      <section className="auth-card public-card">
        <h1>Manage topics</h1>
        <p className="auth-subtitle">
          Choose the healthcare topics you want to receive, {preferences.data.name}.
        </p>
        <form onSubmit={submit}>
          <fieldset className="topic-options">
            <legend>Your topics</legend>
            {TOPIC_CATEGORIES.map((topic) => (
              <label className="check-option" key={topic}>
                <input
                  type="checkbox"
                  checked={selected.includes(topic)}
                  onChange={() => toggle(topic)}
                />
                {topic}
              </label>
            ))}
          </fieldset>
          <Toast message={notice} onDismiss={() => setNotice(null)} />
          {update.isError ? (
            <p className="banner banner-error" role="alert">
              {errorText(update.error)}
            </p>
          ) : null}
          <button type="submit" disabled={update.isPending}>
            {update.isPending ? 'Saving…' : 'Save preferences'}
          </button>
        </form>
        <a className="public-link" href={`/unsubscribe/${encodeURIComponent(token)}`}>
          Unsubscribe from all updates
        </a>
      </section>
    </main>
  );
}

export function UnsubscribePage() {
  const { token = '' } = useParams();
  const [done, setDone] = useState(false);
  const unsubscribe = useMutation({
    mutationFn: () => api.publicUnsubscribe(token),
    onSuccess: () => setDone(true),
  });

  return (
    <main className="auth-page">
      <section className="auth-card public-card">
        <h1>{done ? 'You are unsubscribed' : 'Unsubscribe'}</h1>
        {done ? (
          <p role="status">You will no longer receive these updates.</p>
        ) : (
          <>
            <p className="auth-subtitle">Confirm to stop all future updates to this contact.</p>
            {unsubscribe.isError ? (
              <p className="banner banner-error" role="alert">
                {errorText(unsubscribe.error)}
              </p>
            ) : null}
            <button
              type="button"
              disabled={unsubscribe.isPending}
              onClick={() => unsubscribe.mutate()}
            >
              {unsubscribe.isPending ? 'Updating…' : 'Unsubscribe'}
            </button>
          </>
        )}
      </section>
    </main>
  );
}
