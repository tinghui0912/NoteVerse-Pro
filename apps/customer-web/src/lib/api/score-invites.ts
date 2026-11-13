import type { AccountPendingInvitesListData, InviteCreateRequest, MemberUpdateRequest, ScoreInvitesListData, ScoreMembersListData } from '@/generated/api';
import { accountPendingInviteAccept, accountPendingInviteDecline, accountPendingInvitesList, scoreInviteAccept, scoreInviteInspect, scoreInviteRevoke, scoreInvitesCreate, scoreInvitesList, scoreMemberRemove, scoreMemberUpdate, scoreMembersList, scoreMembershipLeave } from '@/generated/api';
import { customerTransport, responseData } from '@/lib/http/customer-browser-transport';

export const scoreInvitesApi = {
  leaveScore: (scoreId: string) =>
    responseData(scoreMembershipLeave({ ...customerTransport.authenticated, path: { score_id: scoreId } })),
  listInvites: (scoreId: string, options?: NonNullable<ScoreInvitesListData['query']> & { signal?: AbortSignal }) =>
    responseData(scoreInvitesList({ ...customerTransport.authenticated, path: { score_id: scoreId }, query: { limit: options?.limit, cursor: options?.cursor }, signal: options?.signal })),
  createInvite: (
    scoreId: string,
    input: InviteCreateRequest
  ) => responseData(scoreInvitesCreate({ ...customerTransport.authenticated, path: { score_id: scoreId }, body: input })),
  revokeInvite: (scoreId: string, inviteId: string) =>
    responseData(scoreInviteRevoke({ ...customerTransport.authenticated, path: { score_id: scoreId, invite_id: inviteId } })),
  listMembers: (scoreId: string, options?: NonNullable<ScoreMembersListData['query']> & { signal?: AbortSignal }) =>
    responseData(scoreMembersList({ ...customerTransport.authenticated, path: { score_id: scoreId }, query: { limit: options?.limit, cursor: options?.cursor }, signal: options?.signal })),
  updateMember: (scoreId: string, membershipId: number, input: MemberUpdateRequest) =>
    responseData(scoreMemberUpdate({ ...customerTransport.authenticated, path: { score_id: scoreId, membership_id: membershipId }, body: input })),
  removeMember: (scoreId: string, membershipId: number) =>
    responseData(scoreMemberRemove({ ...customerTransport.authenticated, path: { score_id: scoreId, membership_id: membershipId } })),
  inspectInvite: (token: string, signal?: AbortSignal) =>
    responseData(scoreInviteInspect({ ...customerTransport.public, path: { token: token }, signal })),
  acceptInvite: (token: string) =>
    responseData(scoreInviteAccept({ ...customerTransport.authenticated, path: { token: token } })),
  listMyPendingInvites: (options?: NonNullable<AccountPendingInvitesListData['query']> & { signal?: AbortSignal }) =>
    responseData(accountPendingInvitesList({ ...customerTransport.authenticated, query: { limit: options?.limit, cursor: options?.cursor }, signal: options?.signal })),
  acceptMyPendingInvite: (inviteId: string) =>
    responseData(accountPendingInviteAccept({ ...customerTransport.authenticated, path: { invite_id: inviteId } })),
  declineMyPendingInvite: (inviteId: string) =>
    responseData(accountPendingInviteDecline({ ...customerTransport.authenticated, path: { invite_id: inviteId } })),
};
