import type { QueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-client';

export function libraryScoresChanged(client: QueryClient) {
  return client.invalidateQueries({ queryKey: queryKeys.library.scores() });
}

export function libraryOrganizationChanged(client: QueryClient) {
  return client.invalidateQueries({ queryKey: queryKeys.library.all });
}
