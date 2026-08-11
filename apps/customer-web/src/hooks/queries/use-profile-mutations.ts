/**
 * TanStack Query mutation hooks for profile actions.
 */
import { useMutation } from '@tanstack/react-query';
import { profileApi } from '@/lib/api';
import type { RequestEmailChangeRequest, UpdateProfileRequest } from '@/generated/api';

/**
 * Upload an avatar image.
 */
export function useUploadAvatar() {
    // AuthContext owns the current user; the page updates it after success.
    return useMutation({
        mutationFn: (file: File) => profileApi.uploadAvatar(file),
    });
}

/**
 * Update the current user profile.
 */
export function useUpdateProfile() {
    // AuthContext refresh is page-owned because it also drives page form state.
    return useMutation({
        mutationFn: (data: UpdateProfileRequest) => profileApi.updateProfile(data),
    });
}

/**
 * Change the current user password.
 */
export function useChangePassword() {
    // Password changes do not alter any cached query domain.
    return useMutation({
        mutationFn: ({ currentPassword, newPassword }: {
            currentPassword: string;
            newPassword: string;
        }) => profileApi.changePassword(currentPassword, newPassword),
    });
}

export function useRevokeSession() {
    return useMutation({
        mutationFn: (sessionId: number) => profileApi.revokeSession(sessionId),
    });
}

export function useRevokeOtherSessions() {
    return useMutation({
        mutationFn: () => profileApi.revokeOtherSessions(),
    });
}

export function useRequestEmailChange() {
    return useMutation({
        mutationFn: (data: RequestEmailChangeRequest) => profileApi.requestEmailChange(data),
    });
}
