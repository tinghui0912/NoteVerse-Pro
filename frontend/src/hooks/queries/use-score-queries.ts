'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { publicationsApi, scoreInvitesApi, scoreSharingApi, scoresApi } from '@/lib/api';
import { queryKeys } from '@/lib/query-client';
import type { FingeringHandSize } from '@/types/api';

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
    getNextPageParam: (lastPage) => lastPage.data?.next_cursor ?? undefined,
    enabled: enabled && Boolean(scoreId),
  });
}

export function useScoreArtifacts(
  scoreId: string,
  options?: { revisionId?: string; kind?: string; enabled?: boolean }
) {
  return useQuery({
    queryKey: queryKeys.scores.artifacts(scoreId, options?.revisionId, options?.kind),
    queryFn: ({ signal }) =>
      scoresApi.artifacts(
        scoreId,
        { revision_id: options?.revisionId, kind: options?.kind },
        signal
      ),
    enabled: (options?.enabled ?? true) && Boolean(scoreId),
  });
}

export function useUpdateScore() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ scoreId, ...input }: {
      scoreId: string;
      title?: string;
      taxonomy_tags?: Array<{ category: string; code: string }>;
      expected_version: number;
    }) =>
      scoresApi.update(scoreId, input),
    onSuccess: (response) => {
      const score = response.data;
      if (score) queryClient.setQueryData(queryKeys.scores.detail(score.score_id), response);
    },
  });
}

export function useCreateRevision() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ scoreId, ...input }: { scoreId: string; content: string; base_revision_id: string; idempotency_key?: string }) =>
      scoresApi.createRevision(scoreId, input),
    onSuccess: (_response, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.scores.detail(variables.scoreId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.scores.revisions(variables.scoreId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.scores.artifacts(variables.scoreId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.myScores.lists() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.library.entries() });
    },
  });
}

export function useRollbackRevision() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ scoreId, revisionId, note }: { scoreId: string; revisionId: string; note?: string | null }) =>
      scoresApi.rollbackRevision(scoreId, revisionId, { note }),
    onSuccess: (_response, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.scores.detail(variables.scoreId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.scores.revisions(variables.scoreId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.scores.artifacts(variables.scoreId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.myScores.lists() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.library.entries() });
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
      void queryClient.invalidateQueries({ queryKey: queryKeys.scores.revisions(variables.scoreId) });
    },
  });
}

export function useGenerateScoreFingering() {
  return useMutation({
    mutationFn: ({ scoreId, ...input }: {
      scoreId: string;
      content: string;
      hand_size?: FingeringHandSize;
    }) => scoresApi.generateFingering(scoreId, input),
  });
}

export function useScoreGrants(scoreId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.scores.grants(scoreId),
    queryFn: ({ signal }) => scoreSharingApi.listGrants(scoreId, signal),
    enabled: enabled && Boolean(scoreId),
  });
}

export function useCreateScoreGrant(scoreId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof scoreSharingApi.createGrant>[1]) =>
      scoreSharingApi.createGrant(scoreId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.scores.grants(scoreId) });
    },
  });
}

export function useRevokeScoreGrant(scoreId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (grantId: string) => scoreSharingApi.revokeGrant(grantId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.scores.grants(scoreId) });
    },
  });
}

export function useRestoreScoreGrant(scoreId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (grantId: string) => scoreSharingApi.restoreGrant(grantId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.scores.grants(scoreId) });
    },
  });
}

export function useDeleteScoreGrant(scoreId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (grantId: string) => scoreSharingApi.deleteGrant(grantId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.scores.grants(scoreId) });
    },
  });
}

export function useGrantAccess(token: string) {
  return useQuery({
    queryKey: queryKeys.scores.grantAccess(token),
    queryFn: ({ signal }) => scoreSharingApi.access(token, signal),
    enabled: Boolean(token),
  });
}

export function useScoreInvites(scoreId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.scores.invites(scoreId),
    queryFn: ({ signal }) => scoreInvitesApi.listInvites(scoreId, signal),
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
  return useQuery({
    queryKey: queryKeys.scores.members(scoreId),
    queryFn: ({ signal }) => scoreInvitesApi.listMembers(scoreId, signal),
    enabled: enabled && Boolean(scoreId),
  });
}

export function useUpdateScoreMember(scoreId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ membershipId, role }: { membershipId: number; role: 'EDITOR' | 'VIEWER' }) =>
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
  return useQuery({
    queryKey: queryKeys.scores.myInvites(),
    queryFn: ({ signal }) => scoreInvitesApi.listMyPendingInvites(signal),
    enabled,
  });
}

export function useAcceptMyPendingScoreInvite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (inviteId: string) => scoreInvitesApi.acceptMyPendingInvite(inviteId),
    onSuccess: (response) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.scores.myInvites() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.myScores.lists() });
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


export function usePublicScore(slug: string) {
  return useQuery({
    queryKey: queryKeys.scores.publication(slug),
    queryFn: ({ signal }) => publicationsApi.detail(slug, signal),
    enabled: Boolean(slug),
  });
}

export function useScorePublication(scoreId: string) {
  return useQuery({
    queryKey: queryKeys.scores.scorePublication(scoreId),
    queryFn: ({ signal }) => publicationsApi.forScore(scoreId, signal),
    enabled: Boolean(scoreId),
  });
}

export function usePublishScore(scoreId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (revisionId: string) => publicationsApi.publish(scoreId, {
      revision_id: revisionId,
      allow_download: false,
      allow_practice: true,
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.scores.scorePublication(scoreId) }),
  });
}

export function useUnpublishScore(scoreId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => publicationsApi.unpublish(scoreId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.scores.scorePublication(scoreId) }),
  });
}
