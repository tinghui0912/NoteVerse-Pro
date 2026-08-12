/**
 * Authentication API wrapper.
 */
import { apiClient, ApiResponse } from '../api-client';
import type { EmailChangeConfirmedRead, RegisterRequest, User } from '@/generated/api';

// API functions.

/**
 * Log in a user.
 * @param email User email address.
 * @param password User password.
 * @returns Login success response. Session cookies are managed by the backend.
 */
export async function login(email: string, password: string): Promise<ApiResponse> {
    const response = await apiClient.postForm<ApiResponse>('/auth/login', {
        username: email,
        password: password,
    });

    return response;
}

export async function logout(): Promise<ApiResponse> {
    return apiClient.post<ApiResponse>('/auth/logout');
}

/**
 * Register a user.
 * @param data Registration payload.
 */
export async function register(data: RegisterRequest): Promise<ApiResponse> {
    return apiClient.post<ApiResponse>('/auth/register', {
        email: data.email,
        password: data.password,
        display_name: data.display_name,
        locale: data.locale,
    });
}

export async function verifyEmail(token: string): Promise<ApiResponse<User>> {
    return apiClient.post<ApiResponse<User>>('/auth/email/verify', { token });
}

export async function confirmEmailChange(token: string): Promise<ApiResponse<EmailChangeConfirmedRead>> {
    return apiClient.post<ApiResponse<EmailChangeConfirmedRead>>('/auth/email/change/confirm', { token });
}

export async function requestPasswordReset(
    email: string,
    locale: 'en' | 'zh' = 'zh'
): Promise<ApiResponse> {
    return apiClient.post<ApiResponse>('/auth/password/forgot', {
        email,
        locale,
    });
}

/**
 * Reset a password.
 * @param newPassword New password.
 * @param token Password reset token.
 * @param locale Locale used for localized response messaging.
 */
export async function resetPassword(
    newPassword: string,
    token: string,
    locale: 'en' | 'zh' = 'zh'
): Promise<ApiResponse> {
    return apiClient.post<ApiResponse>('/auth/password/reset', {
        new_password: newPassword,
        token,
        locale,
    });
}

export const authApi = {
    login,
    register,
    verifyEmail,
    confirmEmailChange,
    requestPasswordReset,
    resetPassword,
    logout,
};

export default authApi;
