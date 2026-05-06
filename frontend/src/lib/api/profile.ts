/**
 * 个人资料相关 API
 */
import { apiClient, ApiResponse } from '../api-client';
import type { UserProfile, UpdateProfileRequest, AvatarResponse } from '@/types/api';

// ============ API 函数 ============

/**
 * 获取当前用户资料
 */
export async function getProfile(): Promise<ApiResponse<UserProfile>> {
    return apiClient.get<ApiResponse<UserProfile>>('/profile');
}

/**
 * 更新用户资料
 * @param data 更新数据
 */
export async function updateProfile(data: UpdateProfileRequest): Promise<ApiResponse<{ updated_fields: string[] }>> {
    return apiClient.put<ApiResponse<{ updated_fields: string[] }>>('/profile', data);
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
    return apiClient.post<ApiResponse>('/profile/password', {
        current_password: currentPassword,
        new_password: newPassword,
    });
}

/**
 * 上传头像
 * @param file 头像文件
 */
export async function uploadAvatar(file: File): Promise<ApiResponse<AvatarResponse>> {
    return apiClient.upload<ApiResponse<AvatarResponse>>('/profile/avatar', file);
}

/**
 * 删除头像
 */
export async function deleteAvatar(): Promise<ApiResponse> {
    return apiClient.delete<ApiResponse>('/profile/avatar');
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
    const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || '/api/v1';
    return `${baseUrl}${avatarUrl}`;
}

export const profileApi = {
    getProfile,
    updateProfile,
    changePassword,
    uploadAvatar,
    deleteAvatar,
    getAvatarUrl,
};

export default profileApi;
