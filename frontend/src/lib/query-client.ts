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
export interface TaskListQueryFilters {
    page: number;
    pageSize: number;
    state?: string;
    sortBy: string;
    sortOrder: string;
    search?: string;
}

export interface SavedShareQueryFilters {
    page: number;
    pageSize: number;
    sortBy: string;
    sortOrder: string;
    search?: string;
}

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
    jobs: {
        all: ['jobs'] as const,
        lists: () => ['jobs', 'list'] as const,
        list: (page: number, pageSize: number) => ['jobs', 'list', { page, pageSize }] as const,
        detail: (id: string) => ['jobs', 'detail', { id }] as const,
    },
    tasks: {
        all: ['tasks'] as const,
        lists: () => ['tasks', 'list'] as const,
        list: (filters: TaskListQueryFilters) => ['tasks', 'list', filters] as const,
        details: () => ['tasks', 'detail'] as const,
        task: (id: string) => ['tasks', 'detail', { id }] as const,
        detail: (id: string, shareToken?: string) =>
            ['tasks', 'detail', { id, shareToken: shareToken ?? null }] as const,
    },
    shares: {
        all: ['shares'] as const,
        lists: () => ['shares', 'list'] as const,
        list: (taskId: string) => ['shares', 'list', taskId] as const,
        savedLists: () => ['shares', 'saved'] as const,
        saved: (filters: SavedShareQueryFilters) => ['shares', 'saved', filters] as const,
        accessRoot: () => ['shares', 'access'] as const,
        access: (shareId: string) => ['shares', 'access', shareId] as const,
    },
    xml: {
        all: ['xml'] as const,
        contents: () => ['xml', 'content'] as const,
        task: (taskId: string) => ['xml', 'content', { taskId }] as const,
        content: (taskId: string, source: string, shareToken?: string) =>
            ['xml', 'content', { taskId, source, shareToken: shareToken ?? null }] as const,
        shares: () => ['xml', 'share'] as const,
        share: (shareId: string) => ['xml', 'share', { shareId }] as const,
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
} as const;

