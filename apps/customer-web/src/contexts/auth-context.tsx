'use client';

import React, { createContext, useState, useContext, useEffect, useCallback, ReactNode } from 'react';
import { authApi, profileApi } from '@/lib/api';
import type { ProfileUserRead } from '@/generated/api';
import { ApiError } from '@/lib/api-client';
import { getCurrentLoginHref } from '@/lib/auth/return-url';

// Type definitions.

export interface User {
  id: number;
  email: string;
  name: string;
  avatar: string;
  isActive: boolean;
}

interface AuthContextType {
  // State.
  isAuthenticated: boolean;
  isLoading: boolean;
  user: User | null;

  // Login/logout.
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;

  // Registration.
  register: (email: string, password: string, displayName: string, locale?: 'en' | 'zh') => Promise<void>;

  // Email verification.
  verifyEmail: (token: string) => Promise<void>;

  // Password reset request.
  requestPasswordReset: (email: string, locale?: 'en' | 'zh') => Promise<void>;

  // Password reset.
  resetPassword: (newPassword: string, token: string, locale?: 'en' | 'zh') => Promise<void>;

  // User refresh.
  refreshUser: () => Promise<void>;

  // Local user update.
  setUser: (user: User) => void;
}

// ============ Context ============

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// ============ Provider ============

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);

  /**
   * Convert an API user payload into the local user shape.
   */
  const mapApiUser = (apiUser: ProfileUserRead | undefined): User | null => {
    if (!apiUser) return null;
    return {
      id: apiUser.id,
      email: apiUser.email,
      name: apiUser.display_name || apiUser.email.split('@')[0],
      // Use avatar_url only when the backend returns a non-empty value; otherwise AvatarFallback renders initials.
      avatar: apiUser.avatar_url || '',
      isActive: apiUser.is_active,
    };
  };

  /**
   * Refresh the current user profile.
   */
  const refreshUser = useCallback(async () => {
    try {
      const response = await profileApi.getProfile({ suppressAuthRedirect: true });
      if (response.data?.user) {
        const mappedUser = mapApiUser(response.data.user);
        setUser(mappedUser);
        setIsAuthenticated(true);
      }
    } catch (error) {
      // Clear local auth state when the token is invalid.
      if (error instanceof ApiError && error.status === 401) {
        setIsAuthenticated(false);
        setUser(null);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Check the existing session on initialization.
   */
  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  /**
   * Log in with email and password.
   */
  const login = async (email: string, password: string) => {
    // Do not set isLoading here; failed login should not trigger global loading UI.
    await authApi.login(email, password);
    // Refresh user state after a successful login.
    await refreshUser();
  };

  /**
   * Log out and return to the login page.
   */
  const logout = async () => {
    await authApi.logout();
    setIsAuthenticated(false);
    setUser(null);
    if (typeof window !== 'undefined') {
      window.location.assign(getCurrentLoginHref());
    }
  };

  /**
   * Register a new user.
   */
  const register = async (
    email: string,
    password: string,
    displayName: string,
    locale: 'en' | 'zh' = 'zh'
  ) => {
    setIsLoading(true);
    try {
      await authApi.register({
        email,
        password,
        display_name: displayName,
        locale,
      });
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Verify an email address.
   */
  const verifyEmail = async (token: string) => {
    await authApi.verifyEmail(token);
  };

  /**
   * Request a password reset email.
   */
  const requestPasswordReset = async (
    email: string,
    locale: 'en' | 'zh' = 'zh'
  ) => {
    await authApi.requestPasswordReset(email, locale);
  };

  /**
   * Reset the password with a reset token.
   */
  const resetPassword = async (
    newPassword: string,
    token: string,
    locale: 'en' | 'zh' = 'zh'
  ) => {
    await authApi.resetPassword(newPassword, token, locale);
  };

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated,
        isLoading,
        user,
        login,
        logout,
        register,
        verifyEmail,
        requestPasswordReset,
        resetPassword,
        refreshUser,
        setUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

// ============ Hook ============

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export default AuthContext;
