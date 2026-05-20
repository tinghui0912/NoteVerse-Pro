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

/**
 * Query Key 命名规范
 * 统一使用数组格式，便于 invalidateQueries 批量失效
 */
export const queryKeys = {
    tasks: {
        all: ['tasks'] as const,
        list: (filters: {
            page: number;
            pageSize: number;
            state?: string;
            sortBy: string;
            sortOrder: string;
            search?: string;
        }) => ['tasks', 'list', filters] as const,
        detail: (id: string) => ['tasks', 'detail', id] as const,
    },
    shares: {
        all: ['shares'] as const,
        list: (taskId: string) => ['shares', 'list', taskId] as const,
        saved: (filters: {
            page: number;
            pageSize: number;
            sortBy: string;
            sortOrder: string;
            search?: string;
        }) => ['shares', 'saved', filters] as const,
        access: (shareId: string) => ['shares', 'access', shareId] as const,
    },
    xml: {
        content: (taskId: string, source: string, shareToken?: string) =>
            ['xml', taskId, source, shareToken] as const,
    },
    images: {
        task: (taskId: string, type: string) => ['images', taskId, type] as const,
    },
} as const;
