import { apiClient } from '@/lib/api-client';
import type { ApiResponse } from '@/lib/api-client';
import type {
  InviteListRead,
  MemberListRead,
  PendingInviteListRead,
  InviteAcceptRead,
  InviteAccessRead,
  InviteCreatedRead,
  InviteCreateRequest,
  InviteRead,
  MemberRead,
  MemberUpdateRequest,
  PendingInviteRead,
} from '@/generated/api';

export const scoreInvitesApi = {
  listInvites: (scoreId: string, options?: { limit?: number; cursor?: string; signal?: AbortSignal }) =>
    apiClient.get<ApiResponse<InviteListRead>>(
      `/scores/${scoreId}/invites`,
      { limit: options?.limit, cursor: options?.cursor },
      { signal: options?.signal }
    ),
  createInvite: (
    scoreId: string,
    input: InviteCreateRequest
  ) => apiClient.post<ApiResponse<InviteCreatedRead>>(`/scores/${scoreId}/invites`, input),
  revokeInvite: (scoreId: string, inviteId: string) =>
    apiClient.post<ApiResponse<InviteRead>>(`/scores/${scoreId}/invites/${inviteId}/revoke`),
  deleteInvite: (scoreId: string, inviteId: string) =>
    apiClient.delete<ApiResponse<{ deleted: boolean }>>(`/scores/${scoreId}/invites/${inviteId}`),
  listMembers: (scoreId: string, options?: { limit?: number; cursor?: string; signal?: AbortSignal }) =>
    apiClient.get<ApiResponse<MemberListRead>>(
      `/scores/${scoreId}/members`,
      { limit: options?.limit, cursor: options?.cursor },
      { signal: options?.signal }
    ),
  updateMember: (scoreId: string, membershipId: number, input: MemberUpdateRequest) =>
    apiClient.patch<ApiResponse<MemberRead>>(`/scores/${scoreId}/members/${membershipId}`, input),
  removeMember: (scoreId: string, membershipId: number) =>
    apiClient.delete<ApiResponse<MemberRead>>(`/scores/${scoreId}/members/${membershipId}`),
  inspectInvite: (token: string, signal?: AbortSignal) =>
    apiClient.get<ApiResponse<InviteAccessRead>>(`/invites/${token}`, undefined, {
      signal,
      suppressAuthRedirect: true,
    }),
  acceptInvite: (token: string) =>
    apiClient.post<ApiResponse<InviteAcceptRead>>(`/invites/${token}/accept`),
  listMyPendingInvites: (options?: { limit?: number; cursor?: string; signal?: AbortSignal }) =>
    apiClient.get<ApiResponse<PendingInviteListRead>>(
      '/me/invites',
      { limit: options?.limit, cursor: options?.cursor },
      { signal: options?.signal }
    ),
  acceptMyPendingInvite: (inviteId: string) =>
    apiClient.post<ApiResponse<InviteAcceptRead>>(`/me/invites/${inviteId}/accept`),
  declineMyPendingInvite: (inviteId: string) =>
    apiClient.post<ApiResponse<PendingInviteRead>>(`/me/invites/${inviteId}/decline`),
};
