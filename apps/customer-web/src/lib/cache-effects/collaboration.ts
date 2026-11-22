import type { QueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-client';
import { libraryOrganizationChanged } from '@/features/library/cache';

export function scoreInvitesChanged(client: QueryClient, scoreId: string) {
  return client.invalidateQueries({ queryKey: queryKeys.scores.invites(scoreId) });
}

export function scoreMembersChanged(client: QueryClient, scoreId: string) {
  return client.invalidateQueries({ queryKey: queryKeys.scores.members(scoreId) });
}

export function pendingInviteDeclined(client: QueryClient) {
  return client.invalidateQueries({ queryKey: queryKeys.scores.myInvites() });
}

export async function inviteAccepted(client: QueryClient, scoreId: string) {
  await Promise.all([
    libraryOrganizationChanged(client),
    client.invalidateQueries({ queryKey: queryKeys.scores.myInvites() }),
    client.invalidateQueries({ queryKey: queryKeys.scores.detail(scoreId), exact: true }),
  ]);
}
