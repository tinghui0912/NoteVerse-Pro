/**
 * 分享相关 TanStack Query hooks
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-client';
import { sharesApi } from '@/lib/api';
import type { CreateShareRequest } from '@/types/api';

// ============ Query Hooks ============

/**
 * 分享列表查询（results 页面 - 某个任务的分享列表）
 */
export function useShareList(taskId: string) {
    return useQuery({
        queryKey: queryKeys.shares.list(taskId),
        queryFn: ({ signal }) => sharesApi.listShares(taskId, 1, 20, signal),
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
        queryFn: ({ signal }) => sharesApi.listSavedShares(
            filters.page,
            filters.pageSize,
            filters.sortBy,
            filters.sortOrder,
            filters.search,
            signal
        ),
    });
}

/**
 * 分享详情查询（share 页面 - 通过分享链接访问）
 */
export function useShareAccess(shareId: string, options?: { enabled?: boolean }) {
    return useQuery({
        queryKey: queryKeys.shares.access(shareId),
        queryFn: ({ signal }) => sharesApi.accessShare(shareId, signal),
        enabled: options?.enabled ?? !!shareId,
    });
}

export function useSharedXmlContent(shareId: string, options?: { enabled?: boolean }) {
    return useQuery({
        queryKey: queryKeys.xml.share(shareId),
        queryFn: async ({ signal }) => {
            try {
                const blob = await sharesApi.downloadSharedFile(shareId, 'final_xml', signal);
                return (await blob.text()) || null;
            } catch (error) {
                if (signal.aborted) throw error;
                return null;
            }
        },
        enabled: options?.enabled ?? !!shareId,
        staleTime: Infinity,
        retry: false,
    });
}

// ============ Mutation Hooks ============

/**
 * 创建分享链接
 */
export function useCreateShare(taskId: string) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (request: CreateShareRequest) => sharesApi.createShare(taskId, request),
        onSuccess: () => queryClient.invalidateQueries({
            queryKey: queryKeys.shares.list(taskId),
        }),
    });
}

/**
 * 撤销/恢复分享
 */
export function useToggleShare(taskId: string) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (shareToken: string) => sharesApi.revokeShare(shareToken),
        onSuccess: (_, shareToken) => Promise.all([
            queryClient.invalidateQueries({ queryKey: queryKeys.shares.list(taskId) }),
            queryClient.invalidateQueries({ queryKey: queryKeys.shares.access(shareToken) }),
        ]),
    });
}

/**
 * 删除分享
 */
export function useDeleteShare(taskId: string) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (shareToken: string) => sharesApi.deleteShare(shareToken),
        onSuccess: (_, shareToken) => {
            queryClient.removeQueries({ queryKey: queryKeys.shares.access(shareToken) });
            queryClient.removeQueries({ queryKey: queryKeys.xml.share(shareToken) });
            return queryClient.invalidateQueries({ queryKey: queryKeys.shares.list(taskId) });
        },
    });
}

/**
 * 收藏分享
 */
export function useSaveToCollection() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (shareToken: string) => sharesApi.saveShareToCollection(shareToken),
        onSuccess: () => queryClient.invalidateQueries({
            queryKey: queryKeys.shares.savedLists(),
        }),
    });
}

/**
 * 批量删除收藏
 */
export function useDeleteSavedShares() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (ids: number[]) => sharesApi.batchDeleteSavedShares(ids),
        onSuccess: () => queryClient.invalidateQueries({
            queryKey: queryKeys.shares.savedLists(),
        }),
    });
}
