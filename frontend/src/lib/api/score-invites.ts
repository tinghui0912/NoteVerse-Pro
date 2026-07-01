import { apiClient } from '@/lib/api-client';
import type {
  ApiResponse,
  CreatedScoreInvite,
  MembershipRole,
  PendingScoreInvite,
  ScoreInvite,
  ScoreInviteAcceptResult,
  ScoreInviteAccess,
  ScoreMember,
} from '@/types/api';

export const scoreInvitesApi = {
  listInvites: (scoreId: string, signal?: AbortSignal) =>
    apiClient.get<ApiResponse<ScoreInvite[]>>(`/scores/${scoreId}/invites`, undefined, { signal }),
  createInvite: (
    scoreId: string,
    input: { email: string; role: MembershipRole; expires_at?: string | null; locale: 'en' | 'zh' }
  ) => apiClient.post<ApiResponse<CreatedScoreInvite>>(`/scores/${scoreId}/invites`, input),
  revokeInvite: (scoreId: string, inviteId: string) =>
    apiClient.post<ApiResponse<ScoreInvite>>(`/scores/${scoreId}/invites/${inviteId}/revoke`),
  deleteInvite: (scoreId: string, inviteId: string) =>
    apiClient.delete<ApiResponse<{ deleted: boolean }>>(`/scores/${scoreId}/invites/${inviteId}`),
  listMembers: (scoreId: string, signal?: AbortSignal) =>
    apiClient.get<ApiResponse<ScoreMember[]>>(`/scores/${scoreId}/members`, undefined, { signal }),
  updateMember: (scoreId: string, membershipId: number, input: { role: MembershipRole }) =>
    apiClient.patch<ApiResponse<ScoreMember>>(`/scores/${scoreId}/members/${membershipId}`, input),
  removeMember: (scoreId: string, membershipId: number) =>
    apiClient.delete<ApiResponse<ScoreMember>>(`/scores/${scoreId}/members/${membershipId}`),
  inspectInvite: (token: string, signal?: AbortSignal) =>
    apiClient.get<ApiResponse<ScoreInviteAccess>>(`/invites/${token}`, undefined, {
      signal,
      suppressAuthRedirect: true,
    }),
  acceptInvite: (token: string) =>
    apiClient.post<ApiResponse<ScoreInviteAcceptResult>>(`/invites/${token}/accept`),
  listMyPendingInvites: (signal?: AbortSignal) =>
    apiClient.get<ApiResponse<PendingScoreInvite[]>>('/me/invites', undefined, { signal }),
  acceptMyPendingInvite: (inviteId: string) =>
    apiClient.post<ApiResponse<ScoreInviteAcceptResult>>(`/me/invites/${inviteId}/accept`),
  declineMyPendingInvite: (inviteId: string) =>
    apiClient.post<ApiResponse<PendingScoreInvite>>(`/me/invites/${inviteId}/decline`),
};
