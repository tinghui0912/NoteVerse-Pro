'use client';

import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { useQueryClient, type Query } from '@tanstack/react-query';

import { useAuth } from '@/contexts/auth-context';
import { createRealtimeEventSource } from '@/lib/realtime/event-source';
import { parseRealtimeChange, type RealtimeChange } from '@/lib/realtime/changes';
import { queryKeys } from '@/lib/query-client';

function isScoreRevisionAssetsQuery(query: Query, scoreId: string, revisionId?: string | null) {
  const key = query.queryKey;
  if (key[0] !== 'scores' || key[1] !== 'revision-assets') {
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

function invalidateScoreRevisionAssets(
  queryClient: ReturnType<typeof useQueryClient>,
  scoreId: string,
  revisionId?: string | null
) {
  void queryClient.invalidateQueries({
    predicate: (query) => isScoreRevisionAssetsQuery(query, scoreId, revisionId),
  });
}

function handleRealtimeChange(
  event: RealtimeChange,
  queryClient: ReturnType<typeof useQueryClient>
) {
  if (event.kind === 'notifications.changed') {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.notifications.list(),
    });
    void queryClient.invalidateQueries({
      queryKey: queryKeys.notifications.unreadCount(),
    });
    return;
  }

  if (event.kind === 'score.revisions.changed') {
    if (!event.scoreId) return;
    void queryClient.invalidateQueries({
      queryKey: queryKeys.scores.detail(event.scoreId),
    });
    void queryClient.invalidateQueries({
      queryKey: queryKeys.scores.revisions(event.scoreId),
    });
    invalidateScoreRevisionAssets(queryClient, event.scoreId);
    void queryClient.invalidateQueries({
      queryKey: queryKeys.library.scores(),
    });
    return;
  }

  if (event.kind === 'score.derived_assets.changed') {
    if (!event.scoreId) return;
    void queryClient.invalidateQueries({
      queryKey: queryKeys.scores.detail(event.scoreId),
    });
    invalidateScoreRevisionAssets(queryClient, event.scoreId, event.revisionId);
    void queryClient.invalidateQueries({
      queryKey: queryKeys.library.scores(),
    });
    return;
  }

  if (event.kind === 'score.metadata.changed') {
    if (!event.scoreId) return;
    void queryClient.invalidateQueries({
      queryKey: queryKeys.scores.detail(event.scoreId),
    });
    void queryClient.invalidateQueries({
      queryKey: queryKeys.library.scores(),
    });
    return;
  }

  if (event.kind === 'import_jobs.changed') {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.importJobs.lists(),
    });
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
      const change = parseRealtimeChange(message.data);
      if (change) handleRealtimeChange(change, queryClient);
      else void queryClient.invalidateQueries();
    };
    source.addEventListener('change', listener);
    source.addEventListener('resync-required', () => {
      void queryClient.invalidateQueries();
    });

    return () => {
      source.close();
    };
  }, [isAuthenticated, isLoading, queryClient]);

  return children;
}
