import type { QueryClient } from '@tanstack/react-query';

// A principal boundary invalidates the ownership of all cached server state.
export function clearPrincipalServerState(client: QueryClient) {
  client.clear();
}
