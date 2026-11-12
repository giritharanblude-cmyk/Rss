import { useQuery } from '@tanstack/react-query';
import { Navigate } from 'react-router-dom';
import { api } from '../api/client';
import { AppHeader } from '../components/AppHeader';
import { ContactChangePanel } from '../components/ContactChangePanel';
import { LoadingState } from '../components/LoadingState';

export function ProfilePage() {
  const me = useQuery({ queryKey: ['me'], queryFn: api.me, retry: false });

  if (me.isLoading) {
    return (
      <main className="app-main">
        <LoadingState label="Loading your profile…" />
      </main>
    );
  }
  if (me.isError || !me.data) return <Navigate to="/login" replace />;

  return (
    <div className="app-frame">
      <AppHeader user={me.data.user} />
      <main className="app-main feed-main" id="main-content" tabIndex={-1}>
        <h1>Profile</h1>
        <ContactChangePanel user={me.data.user} />
      </main>
    </div>
  );
}
