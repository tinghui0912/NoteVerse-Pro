'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { publicationsApi, scoreSharingApi, scoresApi } from '@/lib/api';
import { queryKeys } from '@/lib/query-client';

export function useScoreDetail(scoreId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.scores.detail(scoreId),
    queryFn: ({ signal }) => scoresApi.detail(scoreId, signal),
    enabled: enabled && Boolean(scoreId),
  });
}

export function useScoreList(page: number, pageSize: number, search?: string) {
  return useQuery({
    queryKey: queryKeys.scores.list(page, pageSize, search),
    queryFn: ({ signal }) => scoresApi.list({ page, page_size: pageSize, search }, signal),
  });
}

export function useDeleteScores() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (scoreIds: string[]) => scoresApi.batchDelete(scoreIds),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.scores.lists() }),
  });
}

export function useScoreRevisions(scoreId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.scores.revisions(scoreId),
    queryFn: ({ signal }) => scoresApi.revisions(scoreId, signal),
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
    },
  });
}

export function useGenerateScoreFingering() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ scoreId, ...input }: { scoreId: string; base_revision_id: string }) =>
      scoresApi.generateFingering(scoreId, {
        ...input,
        idempotency_key: crypto.randomUUID(),
      }),
    onSuccess: (_response, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.scores.detail(variables.scoreId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.scores.revisions(variables.scoreId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.scores.artifacts(variables.scoreId) });
    },
  });
}

export function useApproveScore() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (scoreId: string) => scoresApi.approve(scoreId),
    onSuccess: (response, scoreId) => {
      queryClient.setQueryData(queryKeys.scores.detail(scoreId), response);
    },
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

export function useGrantContent(token: string) {
  return useQuery({
    queryKey: [...queryKeys.scores.grantAccess(token), 'content'] as const,
    queryFn: ({ signal }) => scoreSharingApi.content(token, signal),
    enabled: Boolean(token),
  });
}

export function useScoreBookmarks() {
  return useQuery({
    queryKey: queryKeys.scores.bookmarks(),
    queryFn: ({ signal }) => scoreSharingApi.bookmarks(signal),
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

export function usePublicScoreContent(slug: string) {
  return useQuery({
    queryKey: [...queryKeys.scores.publication(slug), 'content'] as const,
    queryFn: ({ signal }) => publicationsApi.content(slug, signal),
    enabled: Boolean(slug),
  });
}
