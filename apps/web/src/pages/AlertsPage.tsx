import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate } from 'react-router-dom';
import {
  TOPIC_CATEGORIES,
  alertRuleInputSchema,
  type AlertRule,
  type AlertRuleInput,
} from '@healthcare/shared';
import { api, ApiError, type AlertPreview } from '../api/client';
import { AppHeader } from '../components/AppHeader';

const defaultRule: AlertRuleInput = {
  kind: 'digest',
  daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
  timeLocal: '08:00',
  timezone: 'Asia/Kolkata',
  topics: [],
  channels: ['email'],
  active: true,
};
const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function messageOf(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

export function AlertsPage() {
  const client = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: api.me, retry: false });
  const rules = useQuery({ queryKey: ['alert-rules'], queryFn: api.alertRules, retry: false });
  const [values, setValues] = useState<AlertRuleInput>(defaultRule);
  const [editing, setEditing] = useState<string | null>(null);
  const [limit, setLimit] = useState(10);
  const [preview, setPreview] = useState<AlertPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => client.invalidateQueries({ queryKey: ['alert-rules'] });
  const save = useMutation({
    mutationFn: () =>
      editing ? api.updateAlertRule(editing, values) : api.createAlertRule(values),
    onSuccess: async () => {
      await refresh();
      setEditing(null);
      setValues(defaultRule);
      setPreview(null);
    },
  });
  const remove = useMutation({ mutationFn: api.deleteAlertRule, onSuccess: refresh });
  const toggle = useMutation({
    mutationFn: (rule: AlertRule) => {
      const { id: _id, createdAt: _createdAt, ...input } = rule;
      return api.updateAlertRule(rule.id, { ...input, active: !rule.active });
    },
    onSuccess: refresh,
  });
  const previewMutation = useMutation({
    mutationFn: () =>
      api.alertPreview({
        kind: values.kind,
        rule: values,
        limit,
      }),
    onSuccess: (value) => {
      setPreview(value);
      setError(null);
    },
    onError: (caught) => setError(messageOf(caught)),
  });

  if (me.isLoading || rules.isLoading)
    return (
      <main className="app-main">
        <p role="status">Loading alert rules…</p>
      </main>
    );
  if (me.isError || !me.data) return <Navigate to="/login" replace />;
  if (rules.isError || !rules.data)
    return (
      <main className="app-main">
        <p role="alert">Alert rules could not be loaded.</p>
      </main>
    );
  if (me.data.user.role !== 'master')
    return (
      <main className="app-main">
        <p role="alert">Only the master can manage alert rules.</p>
      </main>
    );

  function updateList<K extends keyof AlertRuleInput>(key: K, value: AlertRuleInput[K]) {
    setValues({ ...values, [key]: value });
  }

  function toggleDay(day: number) {
    updateList(
      'daysOfWeek',
      values.daysOfWeek.includes(day)
        ? values.daysOfWeek.filter((value) => value !== day)
        : [...values.daysOfWeek, day].sort(),
    );
  }

  function toggleTopic(topic: AlertRuleInput['topics'][number]) {
    updateList(
      'topics',
      values.topics.includes(topic)
        ? values.topics.filter((value) => value !== topic)
        : [...values.topics, topic],
    );
  }

  function toggleChannel(channel: 'email' | 'whatsapp') {
    updateList(
      'channels',
      values.channels.includes(channel)
        ? values.channels.filter((value) => value !== channel)
        : [...values.channels, channel],
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = alertRuleInputSchema.safeParse(values);
    if (!result.success) {
      setError(result.error.issues[0]?.message ?? 'Check the schedule settings.');
      return;
    }
    try {
      await save.mutateAsync();
      setError(null);
    } catch (caught) {
      setError(messageOf(caught));
    }
  }

  async function deleteRule(rule: AlertRule) {
    if (!window.confirm(`Delete this ${rule.kind} rule?`)) return;
    try {
      await remove.mutateAsync(rule.id);
      setError(null);
    } catch (caught) {
      setError(messageOf(caught));
    }
  }

  async function toggleRule(rule: AlertRule) {
    try {
      await toggle.mutateAsync(rule);
      setError(null);
    } catch (caught) {
      setError(messageOf(caught));
    }
  }

  function editRule(rule: AlertRule) {
    const { id, createdAt: _createdAt, ...input } = rule;
    setEditing(id);
    setValues(input);
    setPreview(null);
  }

  return (
    <div className="app-frame">
      <AppHeader user={me.data.user} />
      <main className="app-main sources-main">
        <div className="section-heading">
          <div>
            <h1>Alerts &amp; Schedule</h1>
            <p className="auth-subtitle">
              Configure digest schedules and optional instant alerts for important news.
            </p>
          </div>
        </div>
        {error ? (
          <p className="banner banner-error" role="alert">
            {error}
          </p>
        ) : null}
        <form className="source-form alert-form" onSubmit={(event) => void submit(event)}>
          <h2>{editing ? 'Edit alert rule' : 'New alert rule'}</h2>
          <p className="form-hint">Default digest: every day at 8:00 AM Asia/Kolkata.</p>
          <label htmlFor="alert-kind">Rule type</label>
          <select
            id="alert-kind"
            value={values.kind}
            onChange={(event) => updateList('kind', event.target.value as AlertRuleInput['kind'])}
          >
            <option value="digest">Digest</option>
            <option value="instant">Instant alert for important items</option>
          </select>
          {values.kind === 'digest' ? (
            <fieldset className="topic-options">
              <legend>Days of week</legend>
              <div className="check-grid">
                {weekdays.map((day, index) => (
                  <label className="check-option" key={day}>
                    <input
                      type="checkbox"
                      checked={values.daysOfWeek.includes(index)}
                      onChange={() => toggleDay(index)}
                    />
                    {day}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
          <label htmlFor="alert-time">Local time</label>
          <input
            id="alert-time"
            type="time"
            value={values.timeLocal}
            onChange={(event) => updateList('timeLocal', event.target.value)}
          />
          <label htmlFor="alert-timezone">Timezone</label>
          <input
            id="alert-timezone"
            value={values.timezone}
            onChange={(event) => updateList('timezone', event.target.value)}
            placeholder="Asia/Kolkata"
          />
          <fieldset className="topic-options">
            <legend>Topics (none selected means all categories)</legend>
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
          <fieldset className="topic-options">
            <legend>Channels</legend>
            {(['email', 'whatsapp'] as const).map((channel) => (
              <label className="check-option" key={channel}>
                <input
                  type="checkbox"
                  checked={values.channels.includes(channel)}
                  onChange={() => toggleChannel(channel)}
                />
                {channel === 'email' ? 'Email' : 'WhatsApp'}
              </label>
            ))}
          </fieldset>
          <label className="check-option">
            <input
              type="checkbox"
              checked={values.active}
              onChange={(event) => updateList('active', event.target.checked)}
            />
            Rule enabled
          </label>
          <label htmlFor="alert-item-limit">Maximum items per recipient</label>
          <input
            id="alert-item-limit"
            type="number"
            min={1}
            max={50}
            value={limit}
            onChange={(event) =>
              setLimit(Math.min(50, Math.max(1, Number(event.target.value) || 1)))
            }
          />
          <div className="source-form-actions">
            <button type="submit" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : editing ? 'Save changes' : 'Save rule'}
            </button>
            {editing ? (
              <button
                type="button"
                className="button-secondary"
                onClick={() => {
                  setEditing(null);
                  setValues(defaultRule);
                }}
              >
                Cancel edit
              </button>
            ) : null}
            <button
              type="button"
              className="button-secondary"
              disabled={previewMutation.isPending}
              onClick={() => previewMutation.mutate()}
            >
              {previewMutation.isPending ? 'Building preview…' : 'Preview what would be sent now'}
            </button>
          </div>
        </form>

        <h2>Saved rules</h2>
        {rules.data.rules.length === 0 ? (
          <p className="empty-state">
            No saved rules yet. The form starts with the daily 8:00 AM IST digest default.
          </p>
        ) : null}
        <div className="source-list">
          {rules.data.rules.map((rule) => (
            <article className="source-card" key={rule.id}>
              <div className="source-card-header">
                <div>
                  <h3>
                    {rule.kind === 'digest' ? 'Digest' : 'Instant alert'} · {rule.timeLocal}{' '}
                    {rule.timezone}
                  </h3>
                  <p>
                    {rule.kind === 'digest'
                      ? rule.daysOfWeek.map((day) => weekdays[day]).join(', ') || 'No days selected'
                      : 'When an item is marked important'}
                  </p>
                </div>
                <span className={`source-state ${rule.active ? 'source-active' : ''}`}>
                  {rule.active ? 'Enabled' : 'Disabled'}
                </span>
              </div>
              <p>
                Topics: {rule.topics.join(', ') || 'All categories'} · Channels:{' '}
                {rule.channels.join(', ')}
              </p>
              <div className="source-actions">
                <button type="button" className="button-secondary" onClick={() => editRule(rule)}>
                  Edit
                </button>
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => void toggleRule(rule)}
                >
                  {rule.active ? 'Disable' : 'Enable'}
                </button>
                <button
                  type="button"
                  className="button-danger"
                  onClick={() => void deleteRule(rule)}
                >
                  Delete
                </button>
              </div>
            </article>
          ))}
        </div>
        {preview ? <PreviewResult preview={preview} /> : null}
      </main>
    </div>
  );
}

function PreviewResult({ preview }: { preview: AlertPreview }) {
  return (
    <section className="preview-result" aria-label="Preview results">
      <h2>Preview · {preview.kind}</h2>
      <p>
        {preview.recipientCount} eligible recipients · {preview.itemCount} items · No messages sent
      </p>
      {preview.groups.length === 0 ? (
        <p className="empty-state">No eligible, consented recipients have matching items.</p>
      ) : null}
      {preview.groups.map((group) => (
        <article className="source-card" key={group.recipientId}>
          <h3>
            {group.recipientName} · {group.channels.join(', ')}
          </h3>
          {group.itemsByCategory.map((category) => (
            <section key={category.category}>
              <h4>{category.category}</h4>
              <ul>
                {category.items.map((item) => (
                  <li key={item.id}>
                    {item.headline} — {item.sourceName}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </article>
      ))}
    </section>
  );
}
