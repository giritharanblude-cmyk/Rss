import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateMemberBody, Member } from '@healthcare/shared';
import { api } from '../api/client';
import { LoadingState } from './LoadingState';
import { Toast } from './Toast';

const emptyMember: CreateMemberBody = {
  name: '',
  email: '',
  password: '',
};

export function MemberManagementPanel() {
  const queryClient = useQueryClient();
  const members = useQuery({ queryKey: ['members'], queryFn: api.members, retry: false });
  const [newMember, setNewMember] = useState(emptyMember);
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: api.createMember,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['members'] });
      setNewMember(emptyMember);
      setNotice('Member account created.');
    },
  });
  const update = useMutation({
    mutationFn: ({ member, disabled }: { member: Member; disabled: boolean }) =>
      api.updateMember(member.id, disabled),
    onSuccess: async (_result, variables) => {
      await queryClient.invalidateQueries({ queryKey: ['members'] });
      setNotice(
        `${variables.member.name}'s access is now ${variables.disabled ? 'disabled' : 'enabled'}.`,
      );
    },
  });
  const reset = useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) =>
      api.resetMemberPassword(id, password),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['members'] });
      setResettingId(null);
      setResetPassword('');
      setNotice('Password reset. The member’s existing sessions are revoked.');
    },
  });
  const error = create.error ?? update.error ?? reset.error;

  function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    create.mutate(newMember);
  }

  function submitReset(event: FormEvent<HTMLFormElement>, memberId: string) {
    event.preventDefault();
    setNotice(null);
    reset.mutate({ id: memberId, password: resetPassword });
  }

  function setMemberDisabled(member: Member, disabled: boolean) {
    if (disabled && !window.confirm(`Disable access for ${member.name}?`)) return;
    setNotice(null);
    update.mutate({ member, disabled });
  }

  return (
    <section className="settings-section">
      <h2>Member management</h2>
      <p className="form-hint">Add team accounts, manage access, or reset a member’s password.</p>
      <Toast message={notice} onDismiss={() => setNotice(null)} />
      {error ? (
        <p className="banner banner-error" role="alert">
          {error.message}
        </p>
      ) : null}
      <form className="settings-form" onSubmit={submitCreate}>
        <h3>Add member</h3>
        <label>
          Name
          <input
            required
            maxLength={100}
            value={newMember.name}
            onChange={(event) => setNewMember({ ...newMember, name: event.target.value })}
          />
        </label>
        <label>
          Email
          <input
            required
            type="email"
            value={newMember.email}
            onChange={(event) => setNewMember({ ...newMember, email: event.target.value })}
          />
        </label>
        <label>
          Initial password
          <input
            required
            type="password"
            autoComplete="new-password"
            minLength={8}
            maxLength={200}
            value={newMember.password}
            onChange={(event) => setNewMember({ ...newMember, password: event.target.value })}
          />
        </label>
        <button type="submit" disabled={create.isPending}>
          Add member
        </button>
      </form>
      <h3>Team members</h3>
      {members.isLoading ? <LoadingState label="Loading members…" /> : null}
      {members.isError ? (
        <p className="banner banner-error" role="alert">
          Member accounts could not be loaded.
        </p>
      ) : null}
      {members.data?.members.length === 0 ? (
        <p className="empty-state">No member accounts yet.</p>
      ) : null}
      <div className="source-list">
        {members.data?.members.map((member) => (
          <article className="source-card" key={member.id}>
            <div className="source-card-main">
              <h3>{member.name}</h3>
              <p>{member.email}</p>
              <p>{member.disabled ? 'Access disabled' : 'Access enabled'}</p>
            </div>
            <div className="source-actions">
              <button
                type="button"
                className="button-secondary"
                disabled={update.isPending}
                onClick={() => setMemberDisabled(member, !member.disabled)}
              >
                {member.disabled ? 'Enable access' : 'Disable access'}
              </button>
              <button
                type="button"
                className="button-secondary"
                onClick={() => {
                  setResettingId(member.id);
                  setResetPassword('');
                }}
              >
                Reset password
              </button>
            </div>
            {resettingId === member.id ? (
              <form
                className="settings-inline-form"
                onSubmit={(event) => submitReset(event, member.id)}
              >
                <label>
                  New password for {member.name}
                  <input
                    required
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    maxLength={200}
                    value={resetPassword}
                    onChange={(event) => setResetPassword(event.target.value)}
                  />
                </label>
                <button type="submit" disabled={reset.isPending}>
                  Set password and revoke sessions
                </button>
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => {
                    setResettingId(null);
                    setResetPassword('');
                  }}
                >
                  Cancel
                </button>
              </form>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
