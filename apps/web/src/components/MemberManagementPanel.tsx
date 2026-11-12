import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateMemberBody, Member } from '@healthcare/shared';
import { api } from '../api/client';
import { deleteMember as deleteMemberRequest } from '../api/member-delete';
import { LoadingState } from './LoadingState';
import { Toast } from './Toast';
import { PageControls } from './PageControls';

const pageSize = 25;

const emptyMember: CreateMemberBody = {
  name: '',
  email: '',
  password: '',
};

export function MemberManagementPanel() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const members = useQuery({
    queryKey: ['members', page],
    queryFn: () => api.members({ page, pageSize }),
    retry: false,
  });
  const [newMember, setNewMember] = useState(emptyMember);
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: api.createMember,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['members'] });
      setNewMember(emptyMember);
      setNotice('Member account created and login details emailed.');
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
  const remove = useMutation({
    mutationFn: (member: Member) => deleteMemberRequest(member.id),
    onSuccess: async (_result, member) => {
      await queryClient.invalidateQueries({ queryKey: ['members'] });
      setResettingId((current) => (current === member.id ? null : current));
      setNotice(`${member.name}'s account was deleted and their sessions were revoked.`);
    },
  });
  const error = create.error ?? update.error ?? reset.error ?? remove.error;

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

  function deleteMember(member: Member) {
    if (
      !window.confirm(
        `Permanently delete ${member.name}'s account? Their existing sessions will be revoked.`,
      )
    ) {
      return;
    }
    setNotice(null);
    remove.mutate(member);
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
        <p className="form-hint">
          Use at least 8 characters, including a letter, number, and symbol.
        </p>
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
              <button
                type="button"
                className="button-danger"
                disabled={remove.isPending}
                onClick={() => deleteMember(member)}
              >
                Delete member
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
                <p className="form-hint">
                  Use at least 8 characters, including a letter, number, and symbol.
                </p>
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
      {members.data ? (
        <PageControls
          page={page}
          pageSize={pageSize}
          total={members.data.total}
          label="members"
          onPageChange={setPage}
        />
      ) : null}
    </section>
  );
}
