/**
 * TanStack Query mutation hooks for profile actions.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { accountSessionsChanged } from '@/lib/cache-effects/account';
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
    const client = useQueryClient();
    return useMutation({
        mutationFn: (sessionId: number) => profileApi.revokeSession(sessionId),
        onSuccess: () => accountSessionsChanged(client),
    });
}

export function useRevokeOtherSessions() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: () => profileApi.revokeOtherSessions(),
        onSuccess: () => accountSessionsChanged(client),
    });
}

export function useRequestEmailChange() {
    return useMutation({
        mutationFn: (data: RequestEmailChangeRequest) => profileApi.requestEmailChange(data),
    });
}
