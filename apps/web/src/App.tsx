import React, { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './state/auth.js';
import { ToastProvider } from './components/ToastContext.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { Navbar } from './components/Navbar.js';
import { CreateItemDialog } from './components/CreateItemDialog.js';

import { LoginPage } from './pages/LoginPage.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { ItemsPage } from './pages/ItemsPage.js';
import { ItemDetailPage } from './pages/ItemDetailPage.js';
import { TeamMembersPage } from './pages/TeamMembersPage.js';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      staleTime: 5000,
      refetchOnWindowFocus: false,
    },
  },
});

const ProtectedLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { token, isLoading } = useAuth();
  const location = useLocation();
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  if (isLoading) {
    return (
      <div style={{ padding: '60px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
        Authenticating...
      </div>
    );
  }

  if (!token) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Navbar onOpenCreateItem={() => setIsCreateOpen(true)} />
      <main style={{ flex: 1 }}>{children}</main>
      <CreateItemDialog isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} />
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <AuthProvider>
            <BrowserRouter>
              <Routes>
                <Route path="/login" element={<LoginPage />} />

                <Route
                  path="/"
                  element={
                    <ProtectedLayout>
                      <ErrorBoundary>
                        <DashboardPage />
                      </ErrorBoundary>
                    </ProtectedLayout>
                  }
                />

                <Route
                  path="/items"
                  element={
                    <ProtectedLayout>
                      <ErrorBoundary>
                        <ItemsPage />
                      </ErrorBoundary>
                    </ProtectedLayout>
                  }
                />

                <Route
                  path="/items/:id"
                  element={
                    <ProtectedLayout>
                      <ErrorBoundary>
                        <ItemDetailPage />
                      </ErrorBoundary>
                    </ProtectedLayout>
                  }
                />

                <Route
                  path="/teams/:teamId/members"
                  element={
                    <ProtectedLayout>
                      <ErrorBoundary>
                        <TeamMembersPage />
                      </ErrorBoundary>
                    </ProtectedLayout>
                  }
                />

                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </BrowserRouter>
          </AuthProvider>
        </ToastProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
};
