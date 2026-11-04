import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate } from 'react-router-dom';
import type { SmtpSettings } from '../api/client';
import { api } from '../api/client';
import { AppHeader } from '../components/AppHeader';

const emptySettings: SmtpSettings = {
  host: '',
  port: 465,
  secure: true,
  user: '',
  fromName: 'Healthcare News',
  fromEmail: '',
};

export function SettingsPage() {
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: api.me, retry: false });
  const email = useQuery({
    queryKey: ['email-settings'],
    queryFn: api.emailSettings,
    retry: false,
  });
  const connections = useQuery({
    queryKey: ['connection-settings'],
    queryFn: api.connectionSettings,
    retry: false,
  });
  const [settings, setSettings] = useState<SmtpSettings>(emptySettings);
  const [password, setPassword] = useState('');
  const [testTo, setTestTo] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => api.saveEmailSettings({ ...settings, password }),
    onSuccess: (result) => {
      setPassword('');
      setNotice('Email settings saved. The password is encrypted at rest.');
      queryClient.setQueryData(['email-settings'], result);
      void queryClient.invalidateQueries({ queryKey: ['connection-settings'] });
    },
  });
  const test = useMutation({
    mutationFn: () => api.testEmailSettings(testTo),
    onSuccess: () => setNotice(`Test email sent to ${testTo}.`),
  });
  const check = useMutation({
    mutationFn: api.checkConnections,
    onSuccess: (result) => queryClient.setQueryData(['connection-settings'], result),
  });
  const connectWhatsApp = useMutation({
    mutationFn: api.connectWhatsApp,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['connection-settings'] }),
  });
  const logoutWhatsApp = useMutation({
    mutationFn: api.logoutWhatsApp,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['connection-settings'] }),
  });

  useEffect(() => {
    if (email.data?.settings) setSettings(email.data.settings);
  }, [email.data]);

  if (me.isLoading)
    return (
      <main className="app-main">
        <p role="status">Loading…</p>
      </main>
    );
  if (me.isError || !me.data) return <Navigate to="/login" replace />;
  if (me.data.user.role !== 'master') return <Navigate to="/news" replace />;

  function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    save.mutate();
  }
  function sendTest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    test.mutate();
  }

  const mutationError =
    save.error ?? test.error ?? check.error ?? connectWhatsApp.error ?? logoutWhatsApp.error;

  return (
    <div className="app-frame">
      <AppHeader user={me.data.user} />
      <main className="app-main feed-main">
        <h1>Settings</h1>
        <p className="auth-subtitle">
          Configure delivery services and check their current connection status.
        </p>
        {notice ? (
          <p className="banner banner-notice" role="status">
            {notice}
          </p>
        ) : null}
        {mutationError ? (
          <p className="banner banner-error" role="alert">
            {mutationError.message}
          </p>
        ) : null}
        {email.isError ? (
          <p className="banner banner-error" role="alert">
            Email settings could not be loaded.
          </p>
        ) : null}
        {connections.isError ? (
          <p className="banner banner-error" role="alert">
            Connection status could not be loaded.
          </p>
        ) : null}
        <section className="settings-section">
          <div className="section-heading">
            <div>
              <h2>Email delivery (SMTP)</h2>
              <p className="form-hint">
                {email.data?.passwordConfigured
                  ? 'A password is configured. Re-enter it when saving changes.'
                  : 'No SMTP password has been saved.'}
              </p>
            </div>
          </div>
          <form className="settings-form" onSubmit={saveSettings}>
            <label>
              SMTP host
              <input
                required
                maxLength={255}
                value={settings.host}
                onChange={(event) => setSettings({ ...settings, host: event.target.value })}
              />
            </label>
            <label>
              Port
              <input
                required
                type="number"
                min={1}
                max={65535}
                value={settings.port}
                onChange={(event) => setSettings({ ...settings, port: Number(event.target.value) })}
              />
            </label>
            <label>
              Username
              <input
                required
                maxLength={255}
                value={settings.user}
                onChange={(event) => setSettings({ ...settings, user: event.target.value })}
              />
            </label>
            <label>
              Password
              <input
                required
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <label>
              Sender name
              <input
                required
                maxLength={120}
                value={settings.fromName}
                onChange={(event) => setSettings({ ...settings, fromName: event.target.value })}
              />
            </label>
            <label>
              Sender email
              <input
                required
                type="email"
                value={settings.fromEmail}
                onChange={(event) => setSettings({ ...settings, fromEmail: event.target.value })}
              />
            </label>
            <label className="check-option">
              <input
                type="checkbox"
                checked={settings.secure}
                onChange={(event) => setSettings({ ...settings, secure: event.target.checked })}
              />
              Use implicit TLS (usually port 465)
            </label>
            <button type="submit" disabled={save.isPending || email.isLoading}>
              Save email settings
            </button>
          </form>
          <form className="settings-inline-form" onSubmit={sendTest}>
            <label>
              Send test email to
              <input
                required
                type="email"
                value={testTo}
                onChange={(event) => setTestTo(event.target.value)}
              />
            </label>
            <button type="submit" className="button-secondary" disabled={test.isPending}>
              Send test
            </button>
          </form>
        </section>
        <section className="settings-section">
          <div className="section-heading">
            <div>
              <h2>WhatsApp (OpenWA)</h2>
              <p className="form-hint">
                The socket connection is not proof that a WhatsApp account is linked. Scan the QR
                code on the configured OpenWA service host.
              </p>
            </div>
            <div className="source-actions">
              <button
                type="button"
                className="button-secondary"
                disabled={connectWhatsApp.isPending}
                onClick={() => connectWhatsApp.mutate()}
              >
                Connect
              </button>
              <button
                type="button"
                className="button-danger"
                disabled={logoutWhatsApp.isPending}
                onClick={() => logoutWhatsApp.mutate()}
              >
                Log out
              </button>
            </div>
          </div>
        </section>
        <section className="settings-section">
          <div className="section-heading">
            <h2>Connection status</h2>
            <button
              type="button"
              className="button-secondary"
              disabled={check.isPending}
              onClick={() => check.mutate()}
            >
              Check now
            </button>
          </div>
          {(connections.data?.connections ?? []).length ? (
            <div className="connection-grid">
              {connections.data?.connections.map((connection) => (
                <article className="connection-card settings-connection" key={connection.service}>
                  <span
                    className={`connection-dot ${['working', 'connected'].includes(connection.state) ? 'connection-ok' : 'connection-off'}`}
                  />
                  <span>{connection.service === 'email' ? 'Email' : 'WhatsApp'}</span>
                  <strong>{connection.state}</strong>
                  <small>
                    Checked {formatDateTime(connection.checkedAt)}
                    {connection.detail ? ` · ${connection.detail}` : ''}
                  </small>
                </article>
              ))}
            </div>
          ) : (
            <p className="empty-state">
              No connection checks recorded yet. Use “Check now” to verify services.
            </p>
          )}
        </section>
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
