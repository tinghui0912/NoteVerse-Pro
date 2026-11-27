'use client';

import type { FingeringRequest, ScoreGenre } from '@/generated/api';
import { scoresApi } from './api';
import { scoreQueryKeys } from './query-keys';
import { scoreUpdated, scoreRevisionWritten, revisionNoteChanged } from './cache';
import { scoresDeleted } from '../consequences';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export function useScoreDetail(scoreId: string, enabled = true) {
  return useQuery({
    queryKey: scoreQueryKeys.detail(scoreId),
    queryFn: ({ signal }) => scoresApi.detail(scoreId, signal),
    enabled: enabled && Boolean(scoreId),
  });
}

export function useRevisionContent(scoreId: string, revisionId?: string | null) {
  return useQuery({
    queryKey: scoreQueryKeys.revision(scoreId, revisionId ?? ''),
    queryFn: ({ signal }) => scoresApi.revisionContent(scoreId, revisionId ?? '', signal),
    enabled: Boolean(scoreId && revisionId),
  });
}

export function useScoreRevisions(scoreId: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: scoreQueryKeys.revisions(scoreId),
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
    queryKey: scoreQueryKeys.revisionAssets(scoreId, options?.revisionId),
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

export function useDeleteScores() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (scoreIds: string[]) => scoresApi.batchDelete(scoreIds),
    onSuccess: (_response, scoreIds) => scoresDeleted(queryClient, scoreIds),
  });
}
