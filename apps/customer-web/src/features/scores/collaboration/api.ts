import type { AccountPendingInvitesListData, InviteCreateRequest, MemberUpdateRequest, ScoreInvitesListData, ScoreMembersListData } from '@/generated/api';
import { accountPendingInviteAccept, accountPendingInviteDecline, accountPendingInvitesList, scoreInviteAccept, scoreInviteInspect, scoreInviteRevoke, scoreInvitesCreate, scoreInvitesList, scoreMemberRemove, scoreMemberUpdate, scoreMembersList, scoreMembershipLeave } from '@/generated/api';
import { customerTransport, responseBody, responseComplete } from '@/lib/http/customer-browser-transport';

export const collaborationApi = {
  leaveScore: (scoreId: string) =>
    responseComplete(scoreMembershipLeave({ ...customerTransport.authenticated, path: { score_id: scoreId } })),
  listInvites: (scoreId: string, options?: NonNullable<ScoreInvitesListData['query']> & { signal?: AbortSignal }) =>
    responseBody(scoreInvitesList({ ...customerTransport.authenticated, path: { score_id: scoreId }, query: { limit: options?.limit, cursor: options?.cursor }, signal: options?.signal })),
  createInvite: (
    scoreId: string,
    input: InviteCreateRequest
  ) => responseBody(scoreInvitesCreate({ ...customerTransport.authenticated, path: { score_id: scoreId }, body: input })),
  revokeInvite: (scoreId: string, inviteId: string) =>
    responseBody(scoreInviteRevoke({ ...customerTransport.authenticated, path: { score_id: scoreId, invite_id: inviteId } })),
  listMembers: (scoreId: string, options?: NonNullable<ScoreMembersListData['query']> & { signal?: AbortSignal }) =>
    responseBody(scoreMembersList({ ...customerTransport.authenticated, path: { score_id: scoreId }, query: { limit: options?.limit, cursor: options?.cursor }, signal: options?.signal })),
  updateMember: (scoreId: string, membershipId: number, input: MemberUpdateRequest) =>
    responseBody(scoreMemberUpdate({ ...customerTransport.authenticated, path: { score_id: scoreId, membership_id: membershipId }, body: input })),
  removeMember: (scoreId: string, membershipId: number) =>
    responseComplete(scoreMemberRemove({ ...customerTransport.authenticated, path: { score_id: scoreId, membership_id: membershipId } })),
  inspectInvite: (token: string, signal?: AbortSignal) =>
    responseBody(scoreInviteInspect({ ...customerTransport.public, path: { token: token }, signal })),
  acceptInvite: (token: string) =>
    responseBody(scoreInviteAccept({ ...customerTransport.authenticated, path: { token: token } })),
  listMyPendingInvites: (options?: NonNullable<AccountPendingInvitesListData['query']> & { signal?: AbortSignal }) =>
    responseBody(accountPendingInvitesList({ ...customerTransport.authenticated, query: { limit: options?.limit, cursor: options?.cursor }, signal: options?.signal })),
  acceptMyPendingInvite: (inviteId: string) =>
    responseBody(accountPendingInviteAccept({ ...customerTransport.authenticated, path: { invite_id: inviteId } })),
  declineMyPendingInvite: (inviteId: string) =>
    responseBody(accountPendingInviteDecline({ ...customerTransport.authenticated, path: { invite_id: inviteId } })),
};
