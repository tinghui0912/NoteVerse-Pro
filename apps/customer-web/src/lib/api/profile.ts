import { accountAvatarDelete, accountAvatarUpload, accountEmailChangeRequest, accountOtherSessionsRevoke, accountPasswordChange, accountProfileGet, accountProfileUpdate, accountSecurityGet, accountSessionRevoke, accountSessionsList } from '@/generated/api';
import { customerTransport, responseBody, responseComplete } from '@/lib/http/customer-browser-transport';
/**
 * Profile API wrapper.
 */
import type { AccountSessionsListData, RequestEmailChangeRequest, UpdateProfileRequest } from '@/generated/api';

// API functions.

/**
 * Get the current user profile.
 */
async function getProfile(options?: { suppressAuthRedirect?: boolean }) {
  return responseBody(accountProfileGet({ ...(options?.suppressAuthRedirect ? customerTransport.silent : customerTransport.authenticated) }));
}

/**
 * Update the current user profile.
 * @param data Profile update payload.
 */
async function updateProfile(data: UpdateProfileRequest) {
  return responseComplete(accountProfileUpdate({ ...customerTransport.authenticated, body: data }));
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
  return responseComplete(accountPasswordChange({
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
  return responseBody(accountAvatarUpload({ ...customerTransport.authenticated, body: { file: file } }));
}

/**
 * Delete the current avatar.
 */
async function deleteAvatar() {
  return responseComplete(accountAvatarDelete({ ...customerTransport.authenticated }));
}

async function getSessions(params?: AccountSessionsListData['query']) {
  return responseBody(accountSessionsList({ ...customerTransport.authenticated, query: params }));
}

async function getSecurityOverview() {
  return responseBody(accountSecurityGet({ ...customerTransport.authenticated }));
}

async function requestEmailChange(data: RequestEmailChangeRequest) {
  return responseComplete(accountEmailChangeRequest({ ...customerTransport.authenticated, body: data }));
}

async function revokeSession(sessionId: number) {
  return responseComplete(accountSessionRevoke({ ...customerTransport.authenticated, path: { session_id: sessionId } }));
}

async function revokeOtherSessions() {
  return responseComplete(accountOtherSessionsRevoke({ ...customerTransport.authenticated }));
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
