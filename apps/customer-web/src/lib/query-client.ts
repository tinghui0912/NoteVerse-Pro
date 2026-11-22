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
/**
 * Query keys follow [domain, scope, identity/filter]. Prefix factories are
 * used for broad invalidation; leaf factories own complete cache identity.
 */
export const queryKeys = {
    account: {
        sessions: () => ['account', 'sessions'] as const,
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
