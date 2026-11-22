import { libraryQueryKeys } from '@/features/library/query-keys';
import type { QueryClient } from '@tanstack/react-query';

export function libraryScoresChanged(client: QueryClient) {
  return client.invalidateQueries({ queryKey: libraryQueryKeys.scores() });
}

export function libraryOrganizationChanged(client: QueryClient) {
  return client.invalidateQueries({ queryKey: libraryQueryKeys.all });
}
