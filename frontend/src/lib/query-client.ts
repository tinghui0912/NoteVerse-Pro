'use client';

import { QueryClient } from '@tanstack/react-query';

/**
 * TanStack Query 全局配置
 */
export const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 30 * 1000,       // 30s 内认为数据新鲜
            gcTime: 5 * 60 * 1000,      // 5 分钟后垃圾回收
            retry: 1,                    // 失败重试 1 次
            refetchOnWindowFocus: false, // 不在窗口聚焦时自动刷新
        },
        mutations: {
            retry: 0,                    // mutation 不自动重试
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

/**
 * Query keys follow [domain, scope, identity/filter]. Prefix factories are
 * used for broad invalidation; leaf factories own complete cache identity.
 */
export const queryKeys = {
    jobs: {
        all: ['jobs'] as const,
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
} as const;
