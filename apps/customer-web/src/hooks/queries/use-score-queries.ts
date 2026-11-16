'use client';

import type { FingeringRequest, MembershipRole, ScoreGenre } from '@/generated/api';
import { scoreInvitesApi, scoresApi } from '@/lib/api';
import { queryKeys } from '@/lib/query-client';
import { scoreLeft, scoreUpdated, scoreRevisionWritten, revisionNoteChanged, scoresDeleted } from '@/lib/cache-effects/scores';
import { scoreInvitesChanged, scoreMembersChanged, inviteAccepted, pendingInviteDeclined } from '@/lib/cache-effects/collaboration';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export function useLeaveScore() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (scoreId: string) => scoreInvitesApi.leaveScore(scoreId),
    onSuccess: (_response, scoreId) => scoreLeft(queryClient, scoreId),
  });
}

export function useScoreDetail(scoreId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.scores.detail(scoreId),
    queryFn: ({ signal }) => scoresApi.detail(scoreId, signal),
    enabled: enabled && Boolean(scoreId),
  });
}

export function useRevisionContent(scoreId: string, revisionId?: string | null) {
  return useQuery({
    queryKey: queryKeys.scores.revision(scoreId, revisionId ?? ''),
    queryFn: ({ signal }) => scoresApi.revisionContent(scoreId, revisionId ?? '', signal),
    enabled: Boolean(scoreId && revisionId),
  });
}

export function useScoreRevisions(scoreId: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: queryKeys.scores.revisions(scoreId),
    queryFn: ({ pageParam, signal }) =>
      scoresApi.revisions(scoreId, { limit: 20, cursor: pageParam }, signal),
    initialPageParam: null as number | null,
    getNextPageParam: (lastPage) => lastPage?.next_cursor == null
      ? undefined : Number(lastPage.next_cursor),
    enabled: enabled && Boolean(scoreId),
  });
}

export function useScoreRevisionAssets(
  scoreId: string,
  options?: { revisionId?: string; enabled?: boolean }
) {
  return useQuery({
    queryKey: queryKeys.scores.revisionAssets(scoreId, options?.revisionId),
    queryFn: ({ signal }) =>
      scoresApi.revisionAssets(scoreId, { revision_id: options?.revisionId }, signal),
    enabled: (options?.enabled ?? true) && Boolean(scoreId),
  });
}

export function useUpdateScore() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      scoreId,
      ...input
    }: {
      scoreId: string;
      display_title?: string;
      genres?: ScoreGenre[];
      expected_metadata_version: number;
    }) => scoresApi.update(scoreId, input),
    onSuccess: (response) => scoreUpdated(queryClient, response),
  });
}

export function useCreateRevision() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      scoreId,
      ...input
    }: {
      scoreId: string;
      content: string;
      expected_head_revision_id: string;
      idempotency_key?: string;
    }) => scoresApi.createRevision(scoreId, input),
    onSuccess: (_response, variables) => scoreRevisionWritten(queryClient, variables.scoreId),
  });
}

export function useRestoreRevision() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      scoreId,
      revisionId,
      expected_head_revision_id,
      note,
    }: {
      scoreId: string;
      revisionId: string;
      expected_head_revision_id: string;
      note?: string | null;
    }) => scoresApi.restoreRevision(scoreId, revisionId, { expected_head_revision_id, note }),
    onSuccess: (_response, variables) => scoreRevisionWritten(queryClient, variables.scoreId),
  });
}

export function useUpdateRevisionNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      scoreId,
      revisionId,
      note,
    }: {
      scoreId: string;
      revisionId: string;
      note?: string | null;
    }) => scoresApi.updateRevisionNote(scoreId, revisionId, { note }),
    onSuccess: (_response, variables) => revisionNoteChanged(queryClient, variables.scoreId),
  });
}

export function useGenerateScoreFingering() {
  return useMutation({
    mutationFn: ({
      scoreId,
      ...input
    }: {
      scoreId: string;
      content: string;
      hand_size?: FingeringRequest['hand_size'];
    }) => scoresApi.generateFingering(scoreId, input),
  });
}

export function useScoreInvites(scoreId: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: queryKeys.scores.invites(scoreId),
    queryFn: ({ signal, pageParam }) =>
      scoreInvitesApi.listInvites(scoreId, { signal, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage?.next_cursor ?? undefined,
    enabled: enabled && Boolean(scoreId),
  });
}

export function useCreateScoreInvite(scoreId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof scoreInvitesApi.createInvite>[1]) =>
      scoreInvitesApi.createInvite(scoreId, input),
    onSuccess: () => scoreInvitesChanged(queryClient, scoreId),
  });
}

export function useRevokeScoreInvite(scoreId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (inviteId: string) => scoreInvitesApi.revokeInvite(scoreId, inviteId),
    onSuccess: () => scoreInvitesChanged(queryClient, scoreId),
  });
}

export function useScoreMembers(scoreId: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: queryKeys.scores.members(scoreId),
    queryFn: ({ signal, pageParam }) =>
      scoreInvitesApi.listMembers(scoreId, { signal, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage?.next_cursor ?? undefined,
    enabled: enabled && Boolean(scoreId),
  });
}

export function useUpdateScoreMember(scoreId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ membershipId, role }: { membershipId: number; role: MembershipRole }) =>
      scoreInvitesApi.updateMember(scoreId, membershipId, { role }),
    onSuccess: () => scoreMembersChanged(queryClient, scoreId),
  });
}

export function useRemoveScoreMember(scoreId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (membershipId: number) => scoreInvitesApi.removeMember(scoreId, membershipId),
    onSuccess: () => scoreMembersChanged(queryClient, scoreId),
  });
}

export function useScoreInviteAccess(token: string) {
  return useQuery({
    queryKey: queryKeys.scores.inviteAccess(token),
    queryFn: ({ signal }) => scoreInvitesApi.inspectInvite(token, signal),
    enabled: Boolean(token),
    staleTime: 0,
  });
}

export function useAcceptScoreInvite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (token: string) => scoreInvitesApi.acceptInvite(token),
    onSuccess: (response) => inviteAccepted(queryClient, response.score_id),
  });
}

export function useMyPendingScoreInvites(enabled = true) {
  return useInfiniteQuery({
    queryKey: queryKeys.scores.myInvites(),
    queryFn: ({ signal, pageParam }) =>
      scoreInvitesApi.listMyPendingInvites({ signal, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage?.next_cursor ?? undefined,
    enabled,
  });
}

export function useAcceptMyPendingScoreInvite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (inviteId: string) => scoreInvitesApi.acceptMyPendingInvite(inviteId),
    onSuccess: (response) => inviteAccepted(queryClient, response.score_id),
  });
}

export function useDeclineMyPendingScoreInvite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (inviteId: string) => scoreInvitesApi.declineMyPendingInvite(inviteId),
    onSuccess: () => pendingInviteDeclined(queryClient),
  });
}

export function useDeleteScores() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (scoreIds: string[]) => scoresApi.batchDelete(scoreIds),
    onSuccess: (_response, scoreIds) => scoresDeleted(queryClient, scoreIds),
  });
}
