/**
 * 个人资料相关 API
 */
import { API_BASE_URL, apiClient, ApiResponse } from '../api-client';
import type {
    AccountSecurityResponse,
    AccountSessionsResponse,
    RequestEmailChangeRequest,
    UserProfile,
    UpdateProfileRequest,
    AvatarResponse,
} from '@/types/api';

// ============ API 函数 ============

/**
 * 获取当前用户资料
 */
export async function getProfile(options?: { suppressAuthRedirect?: boolean }): Promise<ApiResponse<UserProfile>> {
    return apiClient.get<ApiResponse<UserProfile>>('/me/profile', undefined, options);
}

/**
 * 更新用户资料
 * @param data 更新数据
 */
export async function updateProfile(data: UpdateProfileRequest): Promise<ApiResponse<{ updated_fields: string[] }>> {
    return apiClient.put<ApiResponse<{ updated_fields: string[] }>>('/me/profile', data);
}

/**
 * 修改密码
 * @param currentPassword 当前密码
 * @param newPassword 新密码
 */
export async function changePassword(
    currentPassword: string,
    newPassword: string
): Promise<ApiResponse> {
    return apiClient.put<ApiResponse>('/me/password', {
        current_password: currentPassword,
        new_password: newPassword,
    });
}

/**
 * 上传头像
 * @param file 头像文件
 */
export async function uploadAvatar(file: File): Promise<ApiResponse<AvatarResponse>> {
    return apiClient.upload<ApiResponse<AvatarResponse>>('/me/avatar', file);
}

/**
 * 删除头像
 */
export async function deleteAvatar(): Promise<ApiResponse> {
    return apiClient.delete<ApiResponse>('/me/avatar');
}

export async function getSessions(): Promise<ApiResponse<AccountSessionsResponse>> {
    return apiClient.get<ApiResponse<AccountSessionsResponse>>('/me/sessions');
}

export async function getSecurityOverview(): Promise<ApiResponse<AccountSecurityResponse>> {
    return apiClient.get<ApiResponse<AccountSecurityResponse>>('/me/security');
}

export async function requestEmailChange(data: RequestEmailChangeRequest): Promise<ApiResponse> {
    return apiClient.post<ApiResponse>('/me/email/change', data);
}

export async function revokeSession(sessionId: number): Promise<ApiResponse> {
    return apiClient.delete<ApiResponse>(`/me/sessions/${sessionId}`);
}

export async function revokeOtherSessions(): Promise<ApiResponse> {
    return apiClient.delete<ApiResponse>('/me/sessions');
}

/**
 * 获取头像 URL
 * @param avatarUrl 头像路径
 */
export function getAvatarUrl(avatarUrl?: string): string {
    if (!avatarUrl) {
        return '/default-avatar.png'; // 默认头像
    }

    // 如果已经是完整 URL，直接返回
    if (avatarUrl.startsWith('http')) {
        return avatarUrl;
    }

    // 否则拼接 API 基础 URL
    return `${API_BASE_URL}${avatarUrl}`;
}

export const profileApi = {
    getProfile,
    updateProfile,
    changePassword,
    uploadAvatar,
    deleteAvatar,
    getSessions,
    getSecurityOverview,
    requestEmailChange,
    revokeSession,
    revokeOtherSessions,
    getAvatarUrl,
};

export default profileApi;
