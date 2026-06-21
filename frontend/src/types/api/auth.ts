export interface RegisterRequest {
  email: string;
  password: string;
  display_name?: string;
  verified_token: string;
}

export interface User {
  id: number;
  email: string;
  display_name?: string;
  avatar_url?: string;
  is_active: boolean;
  role?: string;
  created_at?: string;
}

export interface SendCodeResponse {
  challenge_id: string;
  message?: string;
  cooldown?: number;
}

export interface VerifyCodeResponse {
  verified_token?: string;
  reset_token?: string;
  message?: string;
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
  email?: string;
  current_password?: string;
  new_password?: string;
}

export interface AvatarResponse {
  avatar_url: string;
  filename: string;
}
