import type { QueryClient } from '@tanstack/react-query';
import { collaborationQueryKeys } from './query-keys';

export function scoreInvitesChanged(client: QueryClient, scoreId: string) {
  return client.invalidateQueries({ queryKey: collaborationQueryKeys.invites(scoreId) });
}

export function scoreMembersChanged(client: QueryClient, scoreId: string) {
  return client.invalidateQueries({ queryKey: collaborationQueryKeys.members(scoreId) });
}

export function pendingInvitesChanged(client: QueryClient) {
  return client.invalidateQueries({ queryKey: collaborationQueryKeys.myInvites() });
}

export async function inviteAcceptanceChanged(client: QueryClient, scoreId: string) {
  await Promise.all([
    pendingInvitesChanged(client),
    scoreInvitesChanged(client, scoreId),
    scoreMembersChanged(client, scoreId),
    client.invalidateQueries({ queryKey: collaborationQueryKeys.inspections() }),
  ]);
}

export function removeScoreCollaborationCaches(client: QueryClient, scoreIds: readonly string[]) {
  for (const scoreId of scoreIds) {
    client.removeQueries({ queryKey: collaborationQueryKeys.invites(scoreId) });
    client.removeQueries({ queryKey: collaborationQueryKeys.members(scoreId) });
  }
}
