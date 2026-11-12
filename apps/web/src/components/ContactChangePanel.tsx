import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  requestContactChangeBodySchema,
  verifyContactChangeBodySchema,
  type PublicUser,
  type RequestContactChangeBody,
} from '@healthcare/shared';
import { ApiError } from '../api/client';
import { requestContactChange, verifyContactChange } from '../api/contact-change';

function messageOf(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

export function ContactChangePanel({ user }: { user: PublicUser }) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState(user.email ?? '');
  const [phone, setPhone] = useState(user.phone ?? '');
  const [code, setCode] = useState('');
  const [requestedContacts, setRequestedContacts] = useState<RequestContactChangeBody | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const verify = useMutation({
    mutationFn: verifyContactChange,
    onSuccess: (_result, contacts) => {
      queryClient.setQueryData<{ user: PublicUser }>(['me'], (current) =>
        current
          ? {
              user: { ...current.user, email: contacts.email, phone: contacts.phone },
            }
          : current,
      );
      setEmail(contacts.email);
      setPhone(contacts.phone ?? '');
      setCode('');
      setRequestedContacts(null);
      setValidationError(null);
    },
  });
  const request = useMutation({
    mutationFn: requestContactChange,
    onSuccess: (_result, contacts) => {
      setRequestedContacts(contacts);
      setValidationError(null);
      verify.reset();
    },
  });

  function submitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = requestContactChangeBodySchema.safeParse({
      email: email.trim(),
      phone: phone.trim() || null,
    });
    if (!parsed.success) {
      setValidationError(parsed.error.issues[0]?.message ?? 'Check the contact details.');
      return;
    }
    setValidationError(null);
    request.mutate(parsed.data);
  }

  function submitVerification(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!requestedContacts) return;
    const parsed = verifyContactChangeBodySchema.safeParse({ ...requestedContacts, code });
    if (!parsed.success) {
      setValidationError(parsed.error.issues[0]?.message ?? 'Enter the verification code.');
      return;
    }
    setValidationError(null);
    verify.mutate(parsed.data);
  }

  const mutationError = requestedContacts ? verify.error : request.error;

  return (
    <section className="settings-section">
      <h2>Change email and phone</h2>
      <p className="form-hint">
        A verification code will be sent to your current email. Contact details change only after
        that code is verified.
      </p>
      <form className="settings-form" onSubmit={submitRequest}>
        <label>
          Email
          <input
            required
            type="email"
            value={email}
            disabled={Boolean(requestedContacts) || request.isPending}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label>
          Phone (E.164)
          <input
            type="tel"
            placeholder="+14155552671"
            value={phone}
            disabled={Boolean(requestedContacts) || request.isPending}
            onChange={(event) => setPhone(event.target.value)}
          />
        </label>
        <button type="submit" disabled={Boolean(requestedContacts) || request.isPending}>
          {request.isPending ? 'Sending code…' : 'Request contact change'}
        </button>
      </form>
      {requestedContacts ? (
        <form className="settings-inline-form" onSubmit={submitVerification}>
          <p role="status">Code sent to your current email. Verify it to apply the change.</p>
          <label>
            Verification code
            <input
              required
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </label>
          <button type="submit" disabled={verify.isPending}>
            {verify.isPending ? 'Verifying…' : 'Verify and save'}
          </button>
        </form>
      ) : null}
      {validationError ? (
        <p className="banner banner-error" role="alert">
          {validationError}
        </p>
      ) : null}
      {mutationError ? (
        <p className="banner banner-error" role="alert">
          {messageOf(mutationError)}
        </p>
      ) : null}
      {verify.isSuccess ? (
        <p className="banner banner-notice" role="status">
          Contact information updated.
        </p>
      ) : null}
    </section>
  );
}
