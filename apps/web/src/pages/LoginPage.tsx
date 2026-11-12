import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { Toast } from '../components/Toast';

type Step = 'credentials' | 'otp';

function messageOf(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  return 'Something went wrong. Please try again.';
}

export function LoginPage() {
  const [step, setStep] = useState<Step>('credentials');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function handleCredentials(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.login({ name, password });
      setStep('otp');
      setCode('');
      setNotice('We emailed a 6-digit code to the admin email address.');
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  async function handleCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.verifyOtp({ name, code });
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      navigate('/', { replace: true });
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  async function handleResend() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.resendOtp({ name });
      setNotice('A new code has been sent.');
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="login-title">
        <h1 id="login-title">Healthcare News Reader</h1>
        <p className="auth-subtitle">Sign in with your name or email, password and email code.</p>

        {error ? (
          <p className="banner banner-error" role="alert">
            {error}
          </p>
        ) : null}
        <Toast message={notice} onDismiss={() => setNotice(null)} />

        {step === 'credentials' ? (
          <form onSubmit={handleCredentials} noValidate>
            <label htmlFor="name">Name or email</label>
            <input
              id="name"
              name="name"
              autoComplete="username"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />

            <label htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />

            <button type="submit" disabled={busy || !name || !password}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleCode} noValidate>
            <label htmlFor="code">Verification code</label>
            <input
              id="code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              required
            />
            <p className="form-hint">Enter the 6-digit code sent to the admin email address.</p>

            <button type="submit" disabled={busy || code.length !== 6}>
              {busy ? 'Checking…' : 'Verify and sign in'}
            </button>
            <button
              type="button"
              className="button-secondary"
              onClick={handleResend}
              disabled={busy}
            >
              Send a new code
            </button>
            <button
              type="button"
              className="button-link"
              onClick={() => {
                setStep('credentials');
                setCode('');
                setError(null);
                setNotice(null);
              }}
              disabled={busy}
            >
              Back
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
