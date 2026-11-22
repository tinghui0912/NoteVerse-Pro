'use client';

import { QueryClient } from '@tanstack/react-query';

/**
 * Global TanStack Query configuration.
 */
export const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 30 * 1000,
            gcTime: 5 * 60 * 1000,
            retry: 1,
            refetchOnWindowFocus: false,
        },
        mutations: {
            retry: 0,
        },
    },
});
export interface LibraryScoreQueryFilters {
    view?: string;
    folderId?: string;
    search?: string;
    sort?: string;
    page: number;
    pageSize: number;
}

/**
 * Query keys follow [domain, scope, identity/filter]. Prefix factories are
 * used for broad invalidation; leaf factories own complete cache identity.
 */
export const queryKeys = {
    account: {
        sessions: () => ['account', 'sessions'] as const,
    },
    scores: {
        all: ['scores'] as const,
        details: () => ['scores', 'detail'] as const,
        detail: (scoreId: string) => ['scores', 'detail', { scoreId }] as const,
        revisions: (scoreId: string) => ['scores', 'revision', { scoreId }] as const,
        revision: (scoreId: string, revisionId: string) =>
            ['scores', 'revision', { scoreId, revisionId }] as const,
        revisionAssets: (scoreId: string, revisionId?: string) =>
            ['scores', 'revision-assets', { scoreId, revisionId: revisionId ?? null }] as const,
        guestPreviewSettings: (scoreId: string) =>
            ['scores', 'guest-preview-settings', { scoreId }] as const,
        guestPreview: (token: string) => ['guest-preview', { token }] as const,
        myInvites: () => ['scores', 'my-invites'] as const,
        invites: (scoreId: string) => ['scores', 'invite', { scoreId }] as const,
        inviteAccess: (token: string) => ['scores', 'invite-access', { token }] as const,
        members: (scoreId: string) => ['scores', 'member', { scoreId }] as const,
    },
    library: {
        all: ['library'] as const,
        folders: () => ['library', 'folders'] as const,
        scores: () => ['library', 'scores'] as const,
        scoreList: (filters: LibraryScoreQueryFilters) => ['library', 'scores', filters] as const,
    },
    notifications: {
        all: ['notifications'] as const,
        list: () => ['notifications', 'list'] as const,
        unreadCount: () => ['notifications', 'unread-count'] as const,
    },
    storageUsage: {
        all: ['storage-usage'] as const,
        current: () => ['storage-usage', 'current'] as const,
    },
    performanceTakeExport: {
        bundle: (bundleId: string) => ['performance-take-export-bundle', { bundleId }] as const,
    },
    performanceTakes: {
        all: ['performance-takes'] as const,
        lists: () => ['performance-takes', 'list'] as const,
        list: (params?: { score_id?: string | null; limit?: number }) =>
            ['performance-takes', 'list', params ?? {}] as const,
        detail: (takeId: string) => ['performance-takes', 'detail', { takeId }] as const,
        playbackUrl: (takeId: string) => ['performance-takes', 'playback-url', { takeId }] as const,
    },
} as const;
