import { importQueryKeys } from '@/features/imports/query-keys';
import type { QueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-client';
import { libraryScoresChanged } from '@/lib/cache-effects/library';
import { storageUsageChanged } from '@/lib/cache-effects/storage';

export function importSubmitted(client: QueryClient) {
  return client.invalidateQueries({ queryKey: importQueryKeys.jobs.lists() });
}

export async function importJobChanged(client: QueryClient, jobId: string) {
  await Promise.all([
    client.invalidateQueries({ queryKey: importQueryKeys.jobs.lists() }),
    client.invalidateQueries({ queryKey: importQueryKeys.jobs.detail(jobId), exact: true }),
    client.invalidateQueries({ queryKey: importQueryKeys.review(jobId), exact: true }),
  ]);
}

export async function importDeleted(client: QueryClient, jobId: string) {
  client.removeQueries({ queryKey: importQueryKeys.jobs.detail(jobId), exact: true });
  client.removeQueries({ queryKey: importQueryKeys.review(jobId), exact: true });
  await Promise.all([importSubmitted(client), storageUsageChanged(client)]);
}

export async function reviewUpdated(client: QueryClient, jobId: string) {
  await Promise.all([importJobChanged(client, jobId), storageUsageChanged(client)]);
}

export async function reviewConfirmed(client: QueryClient, jobId: string, scoreId: string) {
  await Promise.all([
    importJobChanged(client, jobId),
    libraryScoresChanged(client),
    client.invalidateQueries({ queryKey: queryKeys.scores.detail(scoreId), exact: true }),
    storageUsageChanged(client),
  ]);
}


export function importScoreLinksChanged(client: QueryClient) {
  return client.invalidateQueries({ queryKey: importQueryKeys.jobs.all });
}
