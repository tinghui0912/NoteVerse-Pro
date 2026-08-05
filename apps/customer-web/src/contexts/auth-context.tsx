'use client';

import React, { createContext, useState, useContext, useEffect, useCallback, ReactNode } from 'react';
import { authApi, profileApi } from '@/lib/api';
import type { User as ApiUser } from '@/types/api';
import { ApiError } from '@/lib/api-client';
import { getCurrentLoginHref } from '@/lib/auth/return-url';

// ============ 类型定义 ============

export interface User {
  id: number;
  email: string;
  name: string;
  avatar: string;
  isActive: boolean;
}

interface AuthContextType {
  // 状态
  isAuthenticated: boolean;
  isLoading: boolean;
  user: User | null;

  // 登录/登出
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;

  // 注册
  register: (email: string, password: string, displayName: string, locale?: 'en' | 'zh') => Promise<void>;

  // 验证邮箱
  verifyEmail: (token: string) => Promise<void>;

  // 请求重置密码
  requestPasswordReset: (email: string, locale?: 'en' | 'zh') => Promise<void>;

  // 重置密码
  resetPassword: (newPassword: string, token: string, locale?: 'en' | 'zh') => Promise<void>;

  // 刷新用户信息
  refreshUser: () => Promise<void>;

  // 更新用户（本地）
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
   * 从 API 用户转换为本地用户格式
   */
  const mapApiUser = (apiUser: ApiUser | undefined): User | null => {
    if (!apiUser) return null;
    return {
      id: apiUser.id,
      email: apiUser.email,
      name: apiUser.display_name || apiUser.email.split('@')[0],
      // 只有当后端返回了有效的 avatar_url 时才使用，否则使用 AvatarFallback
      avatar: apiUser.avatar_url || '',
      isActive: apiUser.is_active,
    };
  };

  /**
   * 刷新用户信息
   */
  const refreshUser = useCallback(async () => {
    try {
      const response = await profileApi.getProfile({ suppressAuthRedirect: true });
      if (response.data?.user) {
        const mappedUser = mapApiUser(response.data.user as unknown as ApiUser);
        setUser(mappedUser);
        setIsAuthenticated(true);
      }
    } catch (error) {
      // Token 无效，清除
      if (error instanceof ApiError && error.status === 401) {
        setIsAuthenticated(false);
        setUser(null);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * 初始化时检查 token
   */
  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  /**
   * 登录
   */
  const login = async (email: string, password: string) => {
    // 不在这里设置 isLoading，避免登录失败时触发全局重渲染
    await authApi.login(email, password);
    // 登录成功后刷新用户信息
    await refreshUser();
  };

  /**
   * 登出
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
   * 注册
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
   * 验证邮箱
   */
  const verifyEmail = async (token: string) => {
    await authApi.verifyEmail(token);
  };

  /**
   * 请求重置密码
   */
  const requestPasswordReset = async (
    email: string,
    locale: 'en' | 'zh' = 'zh'
  ) => {
    await authApi.requestPasswordReset(email, locale);
  };

  /**
   * 重置密码
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
