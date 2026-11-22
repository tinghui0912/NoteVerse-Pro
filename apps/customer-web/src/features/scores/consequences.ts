import type { QueryClient } from '@tanstack/react-query';
import { removeScoreCoreCaches, scoreDetailChanged } from './core/cache';
import { inviteAcceptanceChanged, removeScoreCollaborationCaches, collaborationParentRemoved } from './collaboration/cache';
import { removeGuestPreviewSettings, guestPreviewAuthorityChanged } from './guest-preview/cache';
import { libraryOrganizationChanged } from '@/features/library/cache';
import { importScoreLinksChanged } from '@/features/imports/cache';
import { storageUsageChanged } from '@/lib/cache-effects/storage';

export async function scoresDeleted(client: QueryClient, scoreIds: readonly string[]) {
  removeScoreCoreCaches(client, scoreIds);
  removeGuestPreviewSettings(client, scoreIds);
  await Promise.all([
    collaborationParentRemoved(client, scoreIds),
    guestPreviewAuthorityChanged(client), libraryOrganizationChanged(client),
    importScoreLinksChanged(client), storageUsageChanged(client),
  ]);
}

export async function scoreLeft(client: QueryClient, scoreId: string) {
  removeScoreCoreCaches(client, [scoreId]);
  removeScoreCollaborationCaches(client, [scoreId]);
  await libraryOrganizationChanged(client);
}

export async function inviteAccepted(client: QueryClient, scoreId: string) {
  await Promise.all([
    inviteAcceptanceChanged(client, scoreId), scoreDetailChanged(client, scoreId),
    libraryOrganizationChanged(client),
  ]);
}
