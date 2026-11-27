import { accountDelete, accountEmailChangeRequest, accountPasswordChange, accountSecurityGet, authEmailChangeConfirm } from '@/generated/api';
import type { ChangePasswordRequest, RequestEmailChangeRequest } from '@/generated/api';
import { customerTransport, responseBody, responseComplete } from '@/lib/http/customer-browser-transport';

export const accountSecurityApi = {
  deleteAccount: (currentPassword: string) => responseBody(accountDelete({ ...customerTransport.authenticated, body: { current_password: currentPassword } })),
  getSecurityOverview: (signal?: AbortSignal) =>
    responseBody(accountSecurityGet({ ...customerTransport.authenticated, signal })),
  changePassword: (currentPassword: string, newPassword: string, locale: NonNullable<ChangePasswordRequest['locale']>) =>
    responseComplete(accountPasswordChange({ ...customerTransport.authenticated, body: {
      current_password: currentPassword, new_password: newPassword, locale,
    } })),
  requestEmailChange: (data: RequestEmailChangeRequest) =>
    responseComplete(accountEmailChangeRequest({ ...customerTransport.authenticated, body: data })),
  confirmEmailChange: (token: string) =>
    responseBody(authEmailChangeConfirm({ ...customerTransport.public, body: { token } })),
};
