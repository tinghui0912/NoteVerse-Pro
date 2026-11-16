import type { QueryClient } from '@tanstack/react-query';
import type { RealtimeChange } from '@/lib/realtime/generated/events';
import { importJobChanged } from './imports';
import { notificationsChanged } from './notifications';
import { scoreDerivedAssetsChanged, scoreMetadataProjectionChanged, scoreRevisionChanged } from './scores';

export function serverStateResyncRequired(client: QueryClient) {
  return client.invalidateQueries();
}

export function applyRealtimeCacheChange(client: QueryClient, change: RealtimeChange) {
  switch (change.kind) {
    case 'notifications.changed': return notificationsChanged(client);
    case 'score.revisions.changed': return scoreRevisionChanged(client, change.scoreId);
    case 'score.derived_assets.changed': return scoreDerivedAssetsChanged(client, change.scoreId, change.revisionId);
    case 'score.metadata.changed': return scoreMetadataProjectionChanged(client, change.scoreId);
    case 'import_jobs.changed': return importJobChanged(client, change.importJobId);
    default: {
      const exhaustive: never = change;
      return exhaustive;
    }
  }
}
