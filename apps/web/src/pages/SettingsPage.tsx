import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate } from 'react-router-dom';
import { DATABASE_STORAGE_LIMIT_BYTES } from '@healthcare/shared';
import type { SmtpSettings } from '../api/client';
import { api } from '../api/client';
import { AppHeader } from '../components/AppHeader';
import { MemberManagementPanel } from '../components/MemberManagementPanel';
import { LoadingState } from '../components/LoadingState';
import { Toast } from '../components/Toast';

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
    enabled: me.data?.user.role === 'master',
  });
  const connections = useQuery({
    queryKey: ['connection-settings'],
    queryFn: api.connectionSettings,
    retry: false,
    enabled: me.data?.user.role === 'master',
  });
  const health = useQuery({
    queryKey: ['health'],
    queryFn: api.health,
    retry: false,
    refetchInterval: 60_000,
    enabled: me.data?.user.role === 'master',
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
    onSuccess: (result) => {
      queryClient.setQueryData(['connection-settings'], result);
      setNotice('Connection status refreshed.');
    },
  });
  const connectWhatsApp = useMutation({
    mutationFn: api.connectWhatsApp,
    onSuccess: () => {
      setNotice('WhatsApp connection requested.');
      void queryClient.invalidateQueries({ queryKey: ['connection-settings'] });
    },
  });
  const logoutWhatsApp = useMutation({
    mutationFn: api.logoutWhatsApp,
    onSuccess: () => {
      setNotice('WhatsApp logout requested.');
      void queryClient.invalidateQueries({ queryKey: ['connection-settings'] });
    },
  });

  useEffect(() => {
    if (email.data?.settings) setSettings(email.data.settings);
  }, [email.data]);

  if (me.isLoading)
    return (
      <main className="app-main">
        <LoadingState label="Loading your account…" />
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
  const connectionByService = new Map(
    (connections.isSuccess && !connections.isFetching ? connections.data.connections : []).map(
      (connection) => [connection.service, connection],
    ),
  );
  const storagePercent = health.data
    ? (health.data.databaseSizeBytes / DATABASE_STORAGE_LIMIT_BYTES) * 100
    : null;

  return (
    <div className="app-frame">
      <AppHeader user={me.data.user} />
      <main className="app-main feed-main" id="main-content" tabIndex={-1}>
        <h1>Settings</h1>
        <p className="auth-subtitle">
          Configure delivery services and check their current connection status.
        </p>
        <Toast message={notice} onDismiss={() => setNotice(null)} />
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
        {health.isError ? (
          <p className="banner banner-error" role="alert">
            Database size could not be loaded.
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
                onClick={() => {
                  setNotice(null);
                  connectWhatsApp.mutate();
                }}
              >
                Connect
              </button>
              <button
                type="button"
                className="button-danger"
                disabled={logoutWhatsApp.isPending}
                onClick={() => {
                  setNotice(null);
                  logoutWhatsApp.mutate();
                }}
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
              onClick={() => {
                setNotice(null);
                check.mutate();
              }}
            >
              Check now
            </button>
          </div>
          <div className="connection-grid">
            {(['email', 'whatsapp'] as const).map((service) => {
              const connection = connectionByService.get(service);
              return (
                <article className="connection-card settings-connection" key={service}>
                  <span
                    className={`connection-dot ${connection && ['working', 'connected'].includes(connection.state) ? 'connection-ok' : 'connection-off'}`}
                  />
                  <span>{service === 'email' ? 'Email' : 'WhatsApp'}</span>
                  <strong>{connection?.state ?? 'Not checked'}</strong>
                  <small>
                    {connection
                      ? `Checked ${formatDateTime(connection.checkedAt)}`
                      : 'No check recorded yet.'}
                    {connection?.detail ? ` · ${connection.detail}` : ''}
                  </small>
                </article>
              );
            })}
          </div>
        </section>
        <section className="settings-section">
          <h2>Database storage</h2>
          {health.isLoading ? (
            <p role="status">Loading database size…</p>
          ) : health.data && storagePercent !== null ? (
            <p
              className={`banner ${storagePercent > 70 ? 'banner-error' : 'banner-notice'}`}
              role={storagePercent > 70 ? 'alert' : 'status'}
            >
              Database uses {formatBytes(health.data.databaseSizeBytes)} of the{' '}
              {formatBytes(DATABASE_STORAGE_LIMIT_BYTES)} free-tier limit (
              {storagePercent.toFixed(1)}%).
              {storagePercent > 70 ? ' Storage has passed the 70% warning threshold.' : ''}
            </p>
          ) : null}
        </section>
        <MemberManagementPanel />
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

function formatBytes(value: number): string {
  return value >= 1_000_000_000
    ? `${(value / 1_000_000_000).toFixed(2)} GB`
    : `${(value / 1_000_000).toFixed(1)} MB`;
}
