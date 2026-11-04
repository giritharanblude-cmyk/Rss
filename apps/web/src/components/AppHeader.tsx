import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import type { PublicUser } from '@healthcare/shared';
import { api } from '../api/client';

const modules = [
  { label: 'News Feed', href: '/news' },
  { label: 'Sources', href: '/sources' },
  { label: 'Recipients', href: '/recipients' },
  { label: 'Alerts & Schedule', href: '/alerts' },
];

const plannedModules = ['Delivery Log', 'Settings'];

export function AppHeader({ user }: { user: PublicUser }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [signOutError, setSignOutError] = useState<string | null>(null);

  async function handleSignOut() {
    try {
      await api.logout();
      queryClient.clear();
      navigate('/login', { replace: true });
    } catch (error) {
      setSignOutError(error instanceof Error ? error.message : 'Unable to sign out.');
    }
  }

  return (
    <>
      <header className="app-header">
        <Link className="app-title" to="/">
          Healthcare News Reader
        </Link>
        <div className="app-user">
          <span className="app-user-name">{user.name}</span>
          <span className={`role-badge role-${user.role}`}>{user.role}</span>
          <button type="button" className="button-link" onClick={handleSignOut}>
            Sign out
          </button>
        </div>
      </header>
      {signOutError ? (
        <p className="banner banner-error" role="alert">
          {signOutError}
        </p>
      ) : null}
      <nav className="module-nav" aria-label="Modules">
        {modules.map((module) => (
          <NavLink
            key={module.href}
            to={module.href}
            className={({ isActive }) => (isActive ? 'module-link module-active' : 'module-link')}
          >
            {module.label}
          </NavLink>
        ))}
        {plannedModules.map((label) => (
          <span className="module-link module-disabled" aria-disabled="true" key={label}>
            {label}
          </span>
        ))}
      </nav>
    </>
  );
}
