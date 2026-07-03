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
export interface LibraryEntryQueryFilters {
    view?: string;
    folderId?: string;
    search?: string;
    sort?: string;
    page: number;
    pageSize: number;
}

export interface MyScoresQueryFilters {
    view?: string;
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
    importJobs: {
        all: ['import-jobs'] as const,
        lists: () => ['import-jobs', 'list'] as const,
        list: (page: number, pageSize: number) => ['import-jobs', 'list', { page, pageSize }] as const,
        detail: (id: string) => ['import-jobs', 'detail', { id }] as const,
    },
    scores: {
        all: ['scores'] as const,
        lists: () => ['scores', 'list'] as const,
        list: (page: number, pageSize: number, search?: string) =>
            ['scores', 'list', { page, pageSize, search: search ?? null }] as const,
        details: () => ['scores', 'detail'] as const,
        detail: (scoreId: string) => ['scores', 'detail', { scoreId }] as const,
        revisions: (scoreId: string) => ['scores', 'revision', { scoreId }] as const,
        revision: (scoreId: string, revisionId: string) =>
            ['scores', 'revision', { scoreId, revisionId }] as const,
        artifacts: (scoreId: string, revisionId?: string, kind?: string) =>
            ['scores', 'artifact', { scoreId, revisionId: revisionId ?? null, kind: kind ?? null }] as const,
        grants: (scoreId: string) => ['scores', 'grant', { scoreId }] as const,
        grantAccess: (token: string) => ['scores', 'grant-access', { token }] as const,
        myInvites: () => ['scores', 'my-invites'] as const,
        invites: (scoreId: string) => ['scores', 'invite', { scoreId }] as const,
        inviteAccess: (token: string) => ['scores', 'invite-access', { token }] as const,
        members: (scoreId: string) => ['scores', 'member', { scoreId }] as const,
        publication: (slug: string) => ['scores', 'publication', { slug }] as const,
        scorePublication: (scoreId: string) => ['scores', 'score-publication', { scoreId }] as const,
    },
    library: {
        all: ['library'] as const,
        folders: () => ['library', 'folders'] as const,
        entries: () => ['library', 'entries'] as const,
        entryList: (filters: LibraryEntryQueryFilters) => ['library', 'entries', filters] as const,
    },
    myScores: {
        all: ['my-scores'] as const,
        lists: () => ['my-scores', 'list'] as const,
        list: (filters: MyScoresQueryFilters) => ['my-scores', 'list', filters] as const,
    },
    notifications: {
        all: ['notifications'] as const,
        list: () => ['notifications', 'list'] as const,
        unreadCount: () => ['notifications', 'unread-count'] as const,
    },
    review: {
        all: ['review'] as const,
        detail: (jobId: string) => ['review', 'detail', { jobId }] as const,
    },
} as const;

