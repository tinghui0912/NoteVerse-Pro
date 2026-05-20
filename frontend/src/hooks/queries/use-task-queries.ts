/**
 * 任务相关 TanStack Query hooks
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-client';
import { tasksApi } from '@/lib/api';
import type { TaskState } from '@/types/api';

// ============ Query Hooks ============

export interface TaskListFilters {
    page: number;
    pageSize: number;
    state?: TaskState;
    sortBy: string;
    sortOrder: string;
    search?: string;
}

/**
 * 任务列表查询
 * @param filters 筛选参数
 * @param options 额外选项
 */
export function useTaskList(
    filters: TaskListFilters,
    options?: { refetchInterval?: number | false }
) {
    return useQuery({
        queryKey: queryKeys.tasks.list({
            page: filters.page,
            pageSize: filters.pageSize,
            state: filters.state,
            sortBy: filters.sortBy,
            sortOrder: filters.sortOrder,
            search: filters.search,
        }),
        queryFn: () => tasksApi.listTasks(
            filters.page,
            filters.pageSize,
            filters.state,
            filters.sortBy,
            filters.sortOrder,
            filters.search
        ),
        refetchInterval: options?.refetchInterval,
    });
}

/**
 * 任务详情查询
 * @param taskId 任务 ID
 * @param options 可选参数
 */
export function useTaskDetail(
    taskId: string,
    options?: {
        shareToken?: string;
        enabled?: boolean;
        refetchInterval?: number | false;
    }
) {
    return useQuery({
        queryKey: queryKeys.tasks.detail(taskId),
        queryFn: () => tasksApi.getTaskDetails(taskId, options?.shareToken),
        enabled: options?.enabled ?? !!taskId,
        refetchInterval: options?.refetchInterval,
    });
}

// ============ Mutation Hooks ============

/**
 * 更新任务信息
 */
export function useUpdateTask() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ id, data }: { id: string; data: { title?: string; difficulty?: string } }) =>
            tasksApi.updateTask(id, data),
        onSuccess: (_, { id }) => {
            queryClient.invalidateQueries({ queryKey: queryKeys.tasks.detail(id) });
        },
    });
}

/**
 * 批量删除任务
 */
export function useDeleteTasks() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (taskIds: string[]) => tasksApi.batchDeleteTasks(taskIds),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all });
        },
    });
}

/**
 * 提交批量处理任务
 */
export function useSubmitBatch() {
    return useMutation({
        mutationFn: ({ fileIds, options }: {
            fileIds: string[];
            options?: Record<string, unknown>;
        }) => tasksApi.submitBatch(fileIds, options),
    });
}

/**
 * 批量打包下载
 */
export function useArchiveTasks() {
    return useMutation({
        mutationFn: ({ taskIds, includeTypes }: {
            taskIds: string[];
            includeTypes?: string[];
        }) => tasksApi.archiveTasks(taskIds, includeTypes),
    });
}
