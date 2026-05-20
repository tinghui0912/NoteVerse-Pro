/**
 * 分享相关 TanStack Query hooks
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-client';
import { sharesApi } from '@/lib/api';

// ============ Query Hooks ============

/**
 * 分享列表查询（results 页面 - 某个任务的分享列表）
 */
export function useShareList(taskId: string) {
    return useQuery({
        queryKey: queryKeys.shares.list(taskId),
        queryFn: () => sharesApi.listShares(taskId),
        enabled: !!taskId,
    });
}

export interface SavedShareFilters {
    page: number;
    pageSize: number;
    sortBy: string;
    sortOrder: string;
    search?: string;
}

/**
 * 收藏列表查询（history 页面）
 */
export function useSavedShares(filters: SavedShareFilters) {
    return useQuery({
        queryKey: queryKeys.shares.saved({
            page: filters.page,
            pageSize: filters.pageSize,
            sortBy: filters.sortBy,
            sortOrder: filters.sortOrder,
            search: filters.search,
        }),
        queryFn: () => sharesApi.listSavedShares(
            filters.page,
            filters.pageSize,
            filters.sortBy,
            filters.sortOrder,
            filters.search
        ),
    });
}

/**
 * 分享详情查询（share 页面 - 通过分享链接访问）
 */
export function useShareAccess(shareId: string, options?: { enabled?: boolean }) {
    return useQuery({
        queryKey: queryKeys.shares.access(shareId),
        queryFn: () => sharesApi.accessShare(shareId),
        enabled: options?.enabled ?? !!shareId,
    });
}

// ============ Mutation Hooks ============

/**
 * 创建分享链接
 */
export function useCreateShare(taskId: string) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ expiresInDays, password }: {
            expiresInDays?: number;
            password?: string;
        }) => sharesApi.createShare(taskId, expiresInDays, password),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: queryKeys.shares.list(taskId) });
        },
    });
}

/**
 * 撤销/恢复分享
 */
export function useToggleShare(taskId: string) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (shareToken: string) => sharesApi.revokeShare(shareToken),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: queryKeys.shares.list(taskId) });
        },
    });
}

/**
 * 删除分享
 */
export function useDeleteShare(taskId: string) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (shareToken: string) => sharesApi.deleteShare(shareToken),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: queryKeys.shares.list(taskId) });
        },
    });
}

/**
 * 收藏分享
 */
export function useSaveToCollection() {
    return useMutation({
        mutationFn: (shareToken: string) => sharesApi.saveShareToCollection(shareToken),
    });
}

/**
 * 批量删除收藏
 */
export function useDeleteSavedShares() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (ids: number[]) => sharesApi.batchDeleteSavedShares(ids),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: queryKeys.shares.all });
        },
    });
}
