import { authEmailChangeConfirm, authEmailVerify, authLogin, authLogout, authPasswordReset, authPasswordResetRequest, authRegister } from '@/generated/api';
import { customerTransport, responseBody, responseComplete } from '@/lib/http/customer-browser-transport';
/**
 * Authentication API wrapper.
 */
import type { RegisterRequest } from '@/generated/api';

// API functions.

/**
 * Log in a user.
 * @param email User email address.
 * @param password User password.
 * @returns No response body. Session cookies are managed by the backend.
 */
async function login(email: string, password: string) {
  return responseComplete(authLogin({
    ...customerTransport.public, body: {
      username: email,
      password: password,
    }
  }));
}

async function logout() {
  return responseComplete(authLogout({ ...customerTransport.authenticated }));
}

/**
 * Register a user.
 * @param data Registration payload.
 */
async function register(data: RegisterRequest) {
  return responseComplete(authRegister({
    ...customerTransport.public, body: {
      email: data.email,
      password: data.password,
      display_name: data.display_name,
      locale: data.locale,
    }
  }));
}

async function verifyEmail(token: string) {
  return responseBody(authEmailVerify({ ...customerTransport.public, body: { token } }));
}

async function confirmEmailChange(token: string) {
  return responseBody(authEmailChangeConfirm({ ...customerTransport.public, body: { token } }));
}

async function requestPasswordReset(
  email: string,
  locale: 'en' | 'zh' = 'zh'
) {
  return responseComplete(authPasswordResetRequest({
    ...customerTransport.public, body: {
      email,
      locale,
    }
  }));
}

/**
 * Reset a password.
 * @param newPassword New password.
 * @param token Password reset token.
 * @param locale Locale used for localized response messaging.
 */
async function resetPassword(
  newPassword: string,
  token: string,
  locale: 'en' | 'zh' = 'zh'
) {
  return responseComplete(authPasswordReset({
    ...customerTransport.public, body: {
      new_password: newPassword,
      token,
      locale,
    }
  }));
}

export const authApi = {
  login,
  register,
  verifyEmail,
  confirmEmailChange,
  requestPasswordReset,
  resetPassword,
  logout,
};
