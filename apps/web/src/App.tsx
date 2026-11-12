import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { NewsFeedPage } from './pages/NewsFeedPage';
import { RecipientsPage } from './pages/RecipientsPage';
import { AlertsPage } from './pages/AlertsPage';
import { SourcesPage } from './pages/SourcesPage';
import { DeliveryLogPage } from './pages/DeliveryLogPage';
import { SettingsPage } from './pages/SettingsPage';
import { ProfilePage } from './pages/ProfilePage';
import { ManageTopicsPage, UnsubscribePage } from './pages/PublicRecipientPage';

export function App() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, refetchOnWindowFocus: false },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/sources" element={<SourcesPage />} />
          <Route path="/news" element={<NewsFeedPage />} />
          <Route path="/recipients" element={<RecipientsPage />} />
          <Route path="/alerts" element={<AlertsPage />} />
          <Route path="/deliveries" element={<DeliveryLogPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/preferences/:token" element={<ManageTopicsPage />} />
          <Route path="/unsubscribe/:token" element={<UnsubscribePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
