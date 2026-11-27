import type { QueryClient } from '@tanstack/react-query';
import type { GuestPreviewSettingsRead } from '@/generated/api';
import { guestPreviewQueryKeys } from './query-keys';

export async function guestPreviewSettingsUpdated(client: QueryClient, scoreId: string, settings: GuestPreviewSettingsRead) {
  client.setQueryData(guestPreviewQueryKeys.settings(scoreId), { enabled: settings.enabled, issued_at: settings.issued_at });
  await client.invalidateQueries({ queryKey: guestPreviewQueryKeys.publics() });
}

export function removeGuestPreviewSettings(client: QueryClient, scoreIds: readonly string[]) {
  for (const scoreId of scoreIds) client.removeQueries({ queryKey: guestPreviewQueryKeys.settings(scoreId), exact: true });
}

export function guestPreviewAuthorityChanged(client: QueryClient) {
  return client.invalidateQueries({ queryKey: guestPreviewQueryKeys.all });
}
