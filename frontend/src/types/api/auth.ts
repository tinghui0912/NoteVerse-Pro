export interface RegisterRequest {
  email: string;
  password: string;
  display_name?: string;
  locale?: 'en' | 'zh';
}

export interface User {
  id: number;
  email: string;
  display_name?: string;
  avatar_url?: string;
  is_active: boolean;
  role?: string;
  created_at?: string;
  email_verified_at?: string;
}

export interface UserProfile {
  user: {
    id: number;
    username?: string;
    email: string;
    created_at?: string;
    is_active: boolean;
    is_superuser?: boolean;
    avatar_url?: string;
  };
}

export interface UpdateProfileRequest {
  display_name?: string;
}

export interface AvatarResponse {
  avatar_url: string;
  filename: string;
}

export interface AccountSession {
  id: number;
  device_id?: string | null;
  user_agent?: string | null;
  ip_address?: string | null;
  created_at: string;
  last_used_at?: string | null;
  expires_at: string;
  is_current: boolean;
}

export interface AccountSessionsResponse {
  sessions: AccountSession[];
}

export interface AccountSecurityOverview {
  email: string;
  email_verified_at?: string | null;
  password_changed_at?: string | null;
  mfa_enabled: boolean;
  mfa_available: boolean;
}

export interface AccountSecurityResponse {
  security: AccountSecurityOverview;
}

export interface RequestEmailChangeRequest {
  new_email: string;
  current_password: string;
  locale?: 'en' | 'zh';
}
