import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, useNavigate } from 'react-router-dom';
import { api } from '../api/client';

export function HomePage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['me'],
    queryFn: api.me,
    retry: false,
  });
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  if (isLoading) {
    return (
      <main className="auth-page">
        <p role="status">Loading…</p>
      </main>
    );
  }

  if (isError || !data) {
    return <Navigate to="/login" replace />;
  }

  async function handleSignOut() {
    await api.logout();
    queryClient.clear();
    navigate('/login', { replace: true });
  }

  return (
    <div className="app-frame">
      <header className="app-header">
        <span className="app-title">Healthcare News Reader</span>
        <div className="app-user">
          <span className="app-user-name">{data.user.name}</span>
          <span className={`role-badge role-${data.user.role}`}>{data.user.role}</span>
          <button type="button" className="button-link" onClick={() => navigate('/sources')}>
            Sources
          </button>
          <button type="button" className="button-link" onClick={handleSignOut}>
            Sign out
          </button>
        </div>
      </header>

      <main className="app-main">
        <h1>Welcome, {data.user.name}</h1>
        <p>
          You are signed in. Sources are available now; News Feed, Recipients, Alerts and Schedule,
          Delivery Log, and Settings are planned for later phases.
        </p>
      </main>
    </div>
  );
}
