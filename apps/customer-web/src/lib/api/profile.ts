/**
 * 个人资料相关 API
 */
import { API_BASE_URL } from '@/lib/app-protocol';
import { apiClient, ApiResponse } from '../api-client';
import type {
    AvatarRead,
    ProfileRead,
    ProfileUpdateRead,
    RequestEmailChangeRequest,
    SecurityRead,
    SessionsRead,
    UpdateProfileRequest,
} from '@/generated/api';

// ============ API 函数 ============

/**
 * 获取当前用户资料
 */
export async function getProfile(options?: { suppressAuthRedirect?: boolean }): Promise<ApiResponse<ProfileRead>> {
    return apiClient.get<ApiResponse<ProfileRead>>('/me/profile', undefined, options);
}

/**
 * 更新用户资料
 * @param data 更新数据
 */
export async function updateProfile(data: UpdateProfileRequest): Promise<ApiResponse<ProfileUpdateRead>> {
    return apiClient.put<ApiResponse<ProfileUpdateRead>>('/me/profile', data);
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
export async function uploadAvatar(file: File): Promise<ApiResponse<AvatarRead>> {
    return apiClient.upload<ApiResponse<AvatarRead>>('/me/avatar', file);
}

/**
 * 删除头像
 */
export async function deleteAvatar(): Promise<ApiResponse> {
    return apiClient.delete<ApiResponse>('/me/avatar');
}

export async function getSessions(params?: { limit?: number }): Promise<ApiResponse<SessionsRead>> {
    return apiClient.get<ApiResponse<SessionsRead>>('/me/sessions', params);
}

export async function getSecurityOverview(): Promise<ApiResponse<SecurityRead>> {
    return apiClient.get<ApiResponse<SecurityRead>>('/me/security');
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
