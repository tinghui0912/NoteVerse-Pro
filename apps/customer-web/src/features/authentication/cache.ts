import type { QueryClient } from '@tanstack/react-query';
import { isPrincipalSensitiveQuery } from '@/lib/query-auth-scope';

export function clearPrincipalServerState(client: QueryClient) {
  // Cancellation starts synchronously; remove private queries before publishing
  // the next principal. Independent bearer requests retain their own lifecycle.
  void client.cancelQueries({ predicate: isPrincipalSensitiveQuery }, { silent: true });
  client.removeQueries({ predicate: isPrincipalSensitiveQuery });
  // Mutation results/state belong to the principal, separately from query scope.
  client.getMutationCache().clear();
}
