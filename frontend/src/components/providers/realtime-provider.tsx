'use client';

import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { useQueryClient, type Query } from '@tanstack/react-query';

import { useAuth } from '@/contexts/auth-context';
import { createRealtimeEventSource } from '@/lib/realtime/event-source';
import { parseRealtimeEvent, type RealtimeEventEnvelope } from '@/lib/realtime/events';
import { queryKeys } from '@/lib/query-client';

function isScoreArtifactQuery(query: Query, scoreId: string, revisionId?: string | null) {
  const key = query.queryKey;
  if (key[0] !== 'scores' || key[1] !== 'artifact') {
    return false;
  }
  const identity = key[2];
  if (!identity || typeof identity !== 'object') {
    return false;
  }
  const candidate = identity as { scoreId?: unknown; revisionId?: unknown };
  return (
    candidate.scoreId === scoreId &&
    (!revisionId || candidate.revisionId === revisionId || candidate.revisionId === null)
  );
}

function invalidateScoreArtifacts(
  queryClient: ReturnType<typeof useQueryClient>,
  scoreId: string,
  revisionId?: string | null
) {
  void queryClient.invalidateQueries({
    predicate: (query) => isScoreArtifactQuery(query, scoreId, revisionId),
  });
}

function handleRealtimeEvent(
  event: RealtimeEventEnvelope,
  queryClient: ReturnType<typeof useQueryClient>
) {
  if (event.type === 'notification.created') {
    void queryClient.invalidateQueries({ queryKey: queryKeys.notifications.list() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.notifications.unreadCount() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.scores.myInvites() });
    return;
  }

  if (event.type === 'score.revision.created') {
    if (!event.score_id) return;
    void queryClient.invalidateQueries({ queryKey: queryKeys.scores.detail(event.score_id) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.scores.revisions(event.score_id) });
    invalidateScoreArtifacts(queryClient, event.score_id);
    void queryClient.invalidateQueries({ queryKey: queryKeys.myScores.lists() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.library.entries() });
    return;
  }

  if (event.type === 'score.derived_asset.updated') {
    if (!event.score_id) return;
    void queryClient.invalidateQueries({ queryKey: queryKeys.scores.detail(event.score_id) });
    invalidateScoreArtifacts(queryClient, event.score_id, event.revision_id);
    void queryClient.invalidateQueries({ queryKey: queryKeys.myScores.lists() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.library.entries() });
    return;
  }

  if (event.type === 'score.metadata.updated') {
    if (!event.score_id) return;
    void queryClient.invalidateQueries({ queryKey: queryKeys.scores.detail(event.score_id) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.myScores.lists() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.library.entries() });
    return;
  }

  if (event.type === 'import_job.completed' || event.type === 'import_job.failed') {
    void queryClient.invalidateQueries({ queryKey: queryKeys.importJobs.lists() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.notifications.list() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.notifications.unreadCount() });
  }
}

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (isLoading || !isAuthenticated) {
      return undefined;
    }

    const source = createRealtimeEventSource();

    const listener = (message: MessageEvent<string>) => {
      const event = parseRealtimeEvent(message.data);
      if (event) {
        handleRealtimeEvent(event, queryClient);
      }
    };

    source.addEventListener('notification.created', listener);
    source.addEventListener('score.revision.created', listener);
    source.addEventListener('score.derived_asset.updated', listener);
    source.addEventListener('score.metadata.updated', listener);
    source.addEventListener('import_job.completed', listener);
    source.addEventListener('import_job.failed', listener);

    return () => {
      source.close();
    };
  }, [isAuthenticated, isLoading, queryClient]);

  return children;
}
