/**
 * Profile API wrapper.
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

// API functions.

/**
 * Get the current user profile.
 */
export async function getProfile(options?: { suppressAuthRedirect?: boolean }): Promise<ApiResponse<ProfileRead>> {
    return apiClient.get<ApiResponse<ProfileRead>>('/me/profile', undefined, options);
}

/**
 * Update the current user profile.
 * @param data Profile update payload.
 */
export async function updateProfile(data: UpdateProfileRequest): Promise<ApiResponse<ProfileUpdateRead>> {
    return apiClient.put<ApiResponse<ProfileUpdateRead>>('/me/profile', data);
}

/**
 * Change the current user password.
 * @param currentPassword Current password.
 * @param newPassword New password.
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
 * Upload an avatar image.
 * @param file Avatar image file.
 */
export async function uploadAvatar(file: File): Promise<ApiResponse<AvatarRead>> {
    return apiClient.upload<ApiResponse<AvatarRead>>('/me/avatar', file);
}

/**
 * Delete the current avatar.
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
 * Build the avatar image URL.
 * @param avatarUrl Avatar path or absolute URL.
 */
export function getAvatarUrl(avatarUrl?: string): string {
    if (!avatarUrl) {
        return '/default-avatar.png'; // Default avatar.
    }

    // Return absolute URLs unchanged.
    if (avatarUrl.startsWith('http')) {
        return avatarUrl;
    }

    // Resolve relative avatar paths against the API base URL.
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
