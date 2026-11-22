'use client';

import { useMutation } from '@tanstack/react-query';
import type { UpdateProfileRequest } from '@/generated/api';
import { profileApi } from './api';

// AuthContext holds the current profile; feature UI refreshes/updates it after success.
export function useUploadAvatar() {
  return useMutation({ mutationFn: (file: File) => profileApi.uploadAvatar(file) });
}

export function useUpdateProfile() {
  return useMutation({ mutationFn: (data: UpdateProfileRequest) => profileApi.updateProfile(data) });
}
