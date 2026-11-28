'use client';

import { createContext, useState, useContext, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { authenticationApi } from '../api';
import { clearPrincipalServerState } from '../cache';
import { navigateToLogin } from './document-navigation';
import { profileApi } from '@/features/account/profile/api';
import type { ProfileUserRead } from '@/generated/api';
import { ApiError } from '@/lib/http/customer-browser-transport';
import { subscribeToSessionInvalidation } from '@/lib/http/session-invalidation';
import { reportUnexpectedClientError } from '@/lib/observability';

type AuthenticationState =
  | { status: 'authenticated'; principal: ProfileUserRead }
  | { status: 'bootstrapping' | 'anonymous' | 'unavailable'; principal: null };

interface AuthenticationContextValue {
  status: AuthenticationState['status'];
  principal: ProfileUserRead | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshPrincipal: () => Promise<boolean | undefined>;
  replacePrincipal: (principal: ProfileUserRead) => void;
  clearPrincipal: () => void;
}

const AuthenticationContext = createContext<AuthenticationContextValue | undefined>(undefined);

export function AuthenticationProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [state, setState] = useState<AuthenticationState>({status: 'bootstrapping', principal: null});
  const current = useRef(state);
  const readGeneration = useRef(0);
  const mounted = useRef(false);
  const updateState = useCallback((next: AuthenticationState) => {
    current.current = next;
    setState(next);
  }, []);

  const clearPrincipal = useCallback(() => {
    readGeneration.current += 1;
    clearPrincipalServerState(client);
    updateState({status: 'anonymous', principal: null});
  }, [client, updateState]);

  const replacePrincipal = useCallback((principal: ProfileUserRead) => {
    readGeneration.current += 1;
    if (current.current.principal?.id !== principal.id) clearPrincipalServerState(client);
    updateState({status: 'authenticated', principal});
  }, [client, updateState]);

  useEffect(() => subscribeToSessionInvalidation(clearPrincipal), [clearPrincipal]);

  const refreshPrincipal = useCallback(async () => {
    const generation = ++readGeneration.current;
    try {
      const response = await profileApi.getProfile({suppressAuthRedirect: true});
      if (!mounted.current || generation !== readGeneration.current) return;
      replacePrincipal(response.user);
      return true;
    } catch (error) {
      if (!mounted.current || generation !== readGeneration.current) return;
      if (error instanceof ApiError && error.status === 401) {
        clearPrincipal();
        return false;
      }
      if (current.current.status !== 'authenticated') updateState({status: 'unavailable', principal: null});
      reportUnexpectedClientError(error, {area: 'authentication', action: 'refresh_principal'});
      throw error;
    }
  }, [clearPrincipal, replacePrincipal, updateState]);

  useEffect(() => {
    mounted.current = true;
    // refreshPrincipal has reported unexpected failures and projected unavailable.
    void Promise.resolve().then(refreshPrincipal).catch(() => undefined);
    return () => { mounted.current = false; readGeneration.current += 1; };
  }, [refreshPrincipal]);

  const signIn = useCallback(async (email: string, password: string) => {
    const principal = await authenticationApi.login(email, password);
    replacePrincipal(principal);
  }, [replacePrincipal]);

  const logout = useCallback(async () => {
    await authenticationApi.logout();
    clearPrincipal();
    navigateToLogin();
  }, [clearPrincipal]);

  return <AuthenticationContext.Provider value={{
    status: state.status, principal: state.principal,
    isAuthenticated: state.status === 'authenticated', isLoading: state.status === 'bootstrapping',
    signIn, logout, refreshPrincipal, replacePrincipal, clearPrincipal,
  }}>{children}</AuthenticationContext.Provider>;
}

export function useAuthentication() {
  const value = useContext(AuthenticationContext);
  if (value === undefined) throw new Error('useAuthentication must be used within an AuthenticationProvider');
  return value;
}
