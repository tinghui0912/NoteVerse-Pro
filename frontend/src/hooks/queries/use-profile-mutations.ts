/**
 * 个人资料相关 TanStack Query mutation hooks
 */
import { useMutation } from '@tanstack/react-query';
import { profileApi } from '@/lib/api';
import type { UpdateProfileRequest } from '@/types/api';

/**
 * 上传头像
 */
export function useUploadAvatar() {
    return useMutation({
        mutationFn: (file: File) => profileApi.uploadAvatar(file),
    });
}

/**
 * 更新个人资料
 */
export function useUpdateProfile() {
    return useMutation({
        mutationFn: (data: UpdateProfileRequest) => profileApi.updateProfile(data),
    });
}

/**
 * 修改密码
 */
export function useChangePassword() {
    return useMutation({
        mutationFn: ({ currentPassword, newPassword }: {
            currentPassword: string;
            newPassword: string;
        }) => profileApi.changePassword(currentPassword, newPassword),
    });
}
