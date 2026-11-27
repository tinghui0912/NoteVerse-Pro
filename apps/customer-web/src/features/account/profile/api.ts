import { accountAvatarUpload, accountProfileGet, accountProfileUpdate } from '@/generated/api';
import type { UpdateProfileRequest } from '@/generated/api';
import { customerTransport, responseBody, responseComplete } from '@/lib/http/customer-browser-transport';

export const profileApi = {
  getProfile: (options?: { suppressAuthRedirect?: boolean }) =>
    responseBody(accountProfileGet({ ...(options?.suppressAuthRedirect ? customerTransport.silent : customerTransport.authenticated) })),
  updateProfile: (data: UpdateProfileRequest) =>
    responseComplete(accountProfileUpdate({ ...customerTransport.authenticated, body: data })),
  uploadAvatar: (file: File) =>
    responseBody(accountAvatarUpload({ ...customerTransport.authenticated, body: { file } })),
};
