import React, { createContext, useContext, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api/client.js';
import { queryKeys } from '../api/queryKeys.js';

export interface User {
  id: string;
  email: string;
  display_name: string;
  org_role: string;
}

export interface Membership {
  team_id: string;
  role: string;
  team_name?: string;
}

export interface AuthContextType {
  user: User | null;
  memberships: Membership[];
  token: string | null;
  login: (token: string, user: User) => void;
  logout: () => Promise<void>;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const queryClient = useQueryClient();
  const [token, setToken] = useState<string | null>(() => {
    return typeof window !== 'undefined' ? sessionStorage.getItem('opsflow_token') : null;
  });

  const { data, isLoading } = useQuery<{ user: User; memberships: Membership[] }>({
    queryKey: queryKeys.me,
    queryFn: () => apiFetch('/me'),
    enabled: !!token,
    retry: false,
  });

  const login = (newToken: string, newUser: User) => {
    sessionStorage.setItem('opsflow_token', newToken);
    setToken(newToken);
    queryClient.setQueryData(queryKeys.me, { user: newUser, memberships: [] });
    queryClient.invalidateQueries({ queryKey: queryKeys.me });
  };

  const logout = async () => {
    try {
      if (token) {
        await apiFetch('/auth/logout', { method: 'POST' });
      }
    } catch {
      // ignore
    } finally {
      sessionStorage.removeItem('opsflow_token');
      setToken(null);
      queryClient.clear();
    }
  };

  useEffect(() => {
    const handleUnauthorized = () => {
      sessionStorage.removeItem('opsflow_token');
      setToken(null);
      queryClient.clear();
    };

    window.addEventListener('opsflow:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('opsflow:unauthorized', handleUnauthorized);
  }, [queryClient]);

  const value: AuthContextType = {
    user: data?.user || null,
    memberships: data?.memberships || [],
    token,
    login,
    logout,
    isLoading: !!token && isLoading,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
