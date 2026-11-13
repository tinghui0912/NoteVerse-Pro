'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { scoreInvitesApi, scoresApi } from '@/lib/api';
import { queryKeys } from '@/lib/query-client';
import type { FingeringRequest, MembershipRole, ScoreGenre } from '@/generated/api';

export function useLeaveScore() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (scoreId: string) => scoreInvitesApi.leaveScore(scoreId),
    onSuccess: async (_response, scoreId) => {
      // Discard the authorized detail before a back navigation can reuse it.
      queryClient.removeQueries({ queryKey: queryKeys.scores.detail(scoreId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.library.all });
    },
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
    initialPageParam: null as number | string | null,
    getNextPageParam: (lastPage) => lastPage.data?.next_cursor ?? undefined,
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
      title?: string;
      genres?: ScoreGenre[];
      expected_version: number;
    }) => scoresApi.update(scoreId, input),
    onSuccess: (response) => {
      const score = response.data;
      if (score) queryClient.setQueryData(queryKeys.scores.detail(score.score_id), response);
    },
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
    onSuccess: (_response, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.scores.detail(variables.scoreId) });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.scores.revisions(variables.scoreId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.scores.revisionAssets(variables.scoreId),
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.library.scores() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.storageUsage.current() });
    },
  });
}

export function useRestoreRevision() {
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
    }) => scoresApi.restoreRevision(scoreId, revisionId, { note }),
    onSuccess: (_response, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.scores.detail(variables.scoreId) });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.scores.revisions(variables.scoreId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.scores.revisionAssets(variables.scoreId),
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.library.scores() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.storageUsage.current() });
    },
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
    onSuccess: (_response, variables) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.scores.revisions(variables.scoreId),
      });
    },
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
    getNextPageParam: (lastPage) => lastPage.data?.next_cursor ?? undefined,
    enabled: enabled && Boolean(scoreId),
  });
}

export function useCreateScoreInvite(scoreId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof scoreInvitesApi.createInvite>[1]) =>
      scoreInvitesApi.createInvite(scoreId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.scores.invites(scoreId) });
    },
  });
}

export function useRevokeScoreInvite(scoreId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (inviteId: string) => scoreInvitesApi.revokeInvite(scoreId, inviteId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.scores.invites(scoreId) });
    },
  });
}

export function useDeleteScoreInvite(scoreId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (inviteId: string) => scoreInvitesApi.deleteInvite(scoreId, inviteId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.scores.invites(scoreId) });
    },
  });
}

export function useScoreMembers(scoreId: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: queryKeys.scores.members(scoreId),
    queryFn: ({ signal, pageParam }) =>
      scoreInvitesApi.listMembers(scoreId, { signal, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.data?.next_cursor ?? undefined,
    enabled: enabled && Boolean(scoreId),
  });
}

export function useUpdateScoreMember(scoreId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ membershipId, role }: { membershipId: number; role: MembershipRole }) =>
      scoreInvitesApi.updateMember(scoreId, membershipId, { role }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.scores.members(scoreId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.scores.detail(scoreId) });
    },
  });
}

export function useRemoveScoreMember(scoreId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (membershipId: number) => scoreInvitesApi.removeMember(scoreId, membershipId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.scores.members(scoreId) });
    },
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
    onSuccess: (response) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.library.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.scores.myInvites() });
      if (response.data?.score_id) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.scores.detail(response.data.score_id),
        });
      }
    },
  });
}

export function useMyPendingScoreInvites(enabled = true) {
  return useInfiniteQuery({
    queryKey: queryKeys.scores.myInvites(),
    queryFn: ({ signal, pageParam }) =>
      scoreInvitesApi.listMyPendingInvites({ signal, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.data?.next_cursor ?? undefined,
    enabled,
  });
}

export function useAcceptMyPendingScoreInvite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (inviteId: string) => scoreInvitesApi.acceptMyPendingInvite(inviteId),
    onSuccess: (response) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.library.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.scores.myInvites() });
      if (response.data?.score_id) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.scores.detail(response.data.score_id),
        });
      }
    },
  });
}

export function useDeclineMyPendingScoreInvite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (inviteId: string) => scoreInvitesApi.declineMyPendingInvite(inviteId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.scores.myInvites() });
    },
  });
}

export function useDeleteScores() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (scoreIds: string[]) => scoresApi.batchDelete(scoreIds),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.scores.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.library.all });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.importJobs.all,
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.storageUsage.current(),
      });
    },
  });
}
