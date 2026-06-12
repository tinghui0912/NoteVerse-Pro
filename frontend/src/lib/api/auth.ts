/**
 * 认证相关 API
 */
import { apiClient, ApiResponse } from '../api-client';
import type {
    RegisterRequest,
    User,
    SendCodeResponse,
    VerifyCodeResponse,
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
 * 发送邮箱验证码
 * @param email 邮箱地址
 * @param purpose 用途: 'register' | 'password_reset'
 */
export async function sendEmailCode(
    email: string,
    purpose: 'register' | 'password_reset' = 'register'
): Promise<ApiResponse<SendCodeResponse>> {
    return apiClient.post<ApiResponse<SendCodeResponse>>('/auth/email/send-code', {
        email,
        purpose,
    });
}

/**
 * 验证邮箱验证码
 * @param email 邮箱
 * @param code 验证码
 * @param challengeId 挑战 ID
 */
export async function verifyEmailCode(
    email: string,
    code: string,
    challengeId: string
): Promise<ApiResponse<VerifyCodeResponse>> {
    return apiClient.post<ApiResponse<VerifyCodeResponse>>('/auth/email/verify-code', {
        email,
        code,
        challenge_id: challengeId,
    });
}

/**
 * 用户注册
 * @param data 注册信息
 */
export async function register(data: RegisterRequest): Promise<ApiResponse<User>> {
    return apiClient.post<ApiResponse<User>>('/auth/register', {
        email: data.email,
        password: data.password,
        display_name: data.display_name,
        verified_token: data.verified_token,
    });
}

/**
 * 验证密码重置验证码
 */
export async function verifyPasswordResetCode(
    email: string,
    code: string,
    challengeId: string
): Promise<ApiResponse<{ reset_token: string }>> {
    return apiClient.post<ApiResponse<{ reset_token: string }>>('/auth/password/verify-code', {
        email,
        code,
        challenge_id: challengeId,
    });
}

/**
 * 重置密码
 * @param email 邮箱
 * @param newPassword 新密码
 * @param resetToken 重置令牌
 */
export async function resetPassword(
    email: string,
    newPassword: string,
    resetToken: string
): Promise<ApiResponse> {
    return apiClient.post<ApiResponse>('/auth/password/reset', {
        email,
        new_password: newPassword,
        reset_token: resetToken,
    });
}

export const authApi = {
    login,
    sendEmailCode,
    verifyEmailCode,
    register,
    verifyPasswordResetCode,
    resetPassword,
    logout,
};

export default authApi;
