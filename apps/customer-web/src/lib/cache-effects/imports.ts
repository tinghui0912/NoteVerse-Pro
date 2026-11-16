import type { QueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-client';
import { libraryScoresChanged } from './library';
import { storageUsageChanged } from './storage';

export function importSubmitted(client: QueryClient) {
  return client.invalidateQueries({ queryKey: queryKeys.importJobs.lists() });
}

export async function importJobChanged(client: QueryClient, jobId: string) {
  await Promise.all([
    client.invalidateQueries({ queryKey: queryKeys.importJobs.lists() }),
    client.invalidateQueries({ queryKey: queryKeys.importJobs.detail(jobId), exact: true }),
    client.invalidateQueries({ queryKey: queryKeys.review.detail(jobId), exact: true }),
  ]);
}

export async function importDeleted(client: QueryClient, jobId: string) {
  client.removeQueries({ queryKey: queryKeys.importJobs.detail(jobId), exact: true });
  client.removeQueries({ queryKey: queryKeys.review.detail(jobId), exact: true });
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
