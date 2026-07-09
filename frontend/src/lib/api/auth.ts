/**
 * 认证相关 API
 */
import { apiClient, ApiResponse } from '../api-client';
import type {
    RegisterRequest,
    User,
} from '@/types/api';

// ============ API 函数 ============

/**
 * 用户登录
 * @param email 邮箱
 * @param password 密码
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
 * 用户注册
 * @param data 注册信息
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
 * 重置密码
 * @param email 邮箱
 * @param newPassword 新密码
 * @param resetToken 重置令牌
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
    requestPasswordReset,
    resetPassword,
    logout,
};

export default authApi;
