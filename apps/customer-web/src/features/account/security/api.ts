import { accountEmailChangeRequest, accountPasswordChange, accountSecurityGet, authEmailChangeConfirm } from '@/generated/api';
import type { RequestEmailChangeRequest } from '@/generated/api';
import { customerTransport, responseBody, responseComplete } from '@/lib/http/customer-browser-transport';

export const accountSecurityApi = {
  getSecurityOverview: (signal?: AbortSignal) =>
    responseBody(accountSecurityGet({ ...customerTransport.authenticated, signal })),
  changePassword: (currentPassword: string, newPassword: string) =>
    responseComplete(accountPasswordChange({ ...customerTransport.authenticated, body: {
      current_password: currentPassword, new_password: newPassword,
    } })),
  requestEmailChange: (data: RequestEmailChangeRequest) =>
    responseComplete(accountEmailChangeRequest({ ...customerTransport.authenticated, body: data })),
  confirmEmailChange: (token: string) =>
    responseBody(authEmailChangeConfirm({ ...customerTransport.public, body: { token } })),
};
