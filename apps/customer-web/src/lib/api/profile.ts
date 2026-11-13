import { accountAvatarDelete, accountAvatarUpload, accountEmailChangeRequest, accountOtherSessionsRevoke, accountPasswordChange, accountProfileGet, accountProfileUpdate, accountSecurityGet, accountSessionRevoke, accountSessionsList } from '@/generated/api';
import { customerTransport, responseData } from '@/lib/http/customer-browser-transport';
/**
 * Profile API wrapper.
 */
import type { AccountSessionsListData, RequestEmailChangeRequest, UpdateProfileRequest } from '@/generated/api';

// API functions.

/**
 * Get the current user profile.
 */
async function getProfile(options?: { suppressAuthRedirect?: boolean }) {
  return responseData(accountProfileGet({ ...(options?.suppressAuthRedirect ? customerTransport.silent : customerTransport.authenticated) }));
}

/**
 * Update the current user profile.
 * @param data Profile update payload.
 */
async function updateProfile(data: UpdateProfileRequest) {
  return responseData(accountProfileUpdate({ ...customerTransport.authenticated, body: data }));
}

/**
 * Change the current user password.
 * @param currentPassword Current password.
 * @param newPassword New password.
 */
async function changePassword(
  currentPassword: string,
  newPassword: string
) {
  return responseData(accountPasswordChange({
    ...customerTransport.authenticated, body: {
      current_password: currentPassword,
      new_password: newPassword,
    }
  }));
}

/**
 * Upload an avatar image.
 * @param file Avatar image file.
 */
async function uploadAvatar(file: File) {
  return responseData(accountAvatarUpload({ ...customerTransport.authenticated, body: { file: file } }));
}

/**
 * Delete the current avatar.
 */
async function deleteAvatar() {
  return responseData(accountAvatarDelete({ ...customerTransport.authenticated }));
}

async function getSessions(params?: AccountSessionsListData['query']) {
  return responseData(accountSessionsList({ ...customerTransport.authenticated, query: params }));
}

async function getSecurityOverview() {
  return responseData(accountSecurityGet({ ...customerTransport.authenticated }));
}

async function requestEmailChange(data: RequestEmailChangeRequest) {
  return responseData(accountEmailChangeRequest({ ...customerTransport.authenticated, body: data }));
}

async function revokeSession(sessionId: number) {
  return responseData(accountSessionRevoke({ ...customerTransport.authenticated, path: { session_id: sessionId } }));
}

async function revokeOtherSessions() {
  return responseData(accountOtherSessionsRevoke({ ...customerTransport.authenticated }));
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
};
