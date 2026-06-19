/**
 * 任务相关 API
 */
import { apiClient, ApiResponse, PaginatedResponse } from '../api-client';
import type {
    Task,
    TaskState,
    TaskDetails,
    BatchStatusResponse,
    BatchDeleteResponse,
    ArchiveResult,
} from '@/types/api';

// ============ API 函数 ============

/**
 * 获取任务列表
 * @param page 页码
 * @param pageSize 每页数量
 * @param state 状态筛选
 * @param sortBy 排序字段 (created_at, title)
 * @param sortOrder 排序顺序 (asc, desc)
 * @param search 搜索关键词
 */
export async function listTasks(
    page: number = 1,
    pageSize: number = 20,
    state?: TaskState,
    sortBy?: string,
    sortOrder?: string,
    search?: string,
    signal?: AbortSignal
): Promise<PaginatedResponse<Task>> {
    return apiClient.get<PaginatedResponse<Task>>('/tasks', {
        page,
        page_size: pageSize,
        state,
        sort_by: sortBy,
        sort_order: sortOrder,
        search,
    }, { signal });
}

/**
 * 获取任务详情
 * @param taskId 任务 ID
 * @param shareToken 可选的分享 token（用于非任务所有者访问）
 */
export async function getTaskDetails(
    taskId: string,
    shareToken?: string,
    signal?: AbortSignal
): Promise<ApiResponse<TaskDetails>> {
    const params: Record<string, string> = {};
    if (shareToken) {
        params.share_token = shareToken;
    }
    return apiClient.get<ApiResponse<TaskDetails>>(`/tasks/${taskId}/details`, params, { signal });
}

/**
 * 提交批量处理任务
 * @param fileIds 文件 ID 列表
 * @param options 处理选项
 */
export async function submitBatch(
    fileIds: string[],
    options?: Record<string, unknown>,
    idempotencyKey?: string
): Promise<ApiResponse<{ task_id: string }>> {
    return apiClient.post<ApiResponse<{ task_id: string }>>('/tasks/submit-batch', {
        file_ids: fileIds,
        idempotency_key: idempotencyKey,
        options,
    });
}

/**
 * 更新任务信息
 * @param taskId 任务 ID
 * @param data 更新数据 (title, difficulty)
 */
export async function updateTask(
    taskId: string,
    data: { title?: string; difficulty?: string }
): Promise<ApiResponse<{ title: string; difficulty: string }>> {
    return apiClient.patch<ApiResponse<{ title: string; difficulty: string }>>(`/tasks/${taskId}`, data);
}

/**
 * 删除单个任务
 * @param taskId 任务 ID
 */
export async function deleteTask(taskId: string): Promise<ApiResponse> {
    return apiClient.delete<ApiResponse>(`/tasks/${taskId}`);
}

/**
 * 批量删除任务
 * @param taskIds 任务 ID 列表
 */
export async function batchDeleteTasks(taskIds: string[]): Promise<ApiResponse<BatchDeleteResponse>> {
    return apiClient.post<ApiResponse<BatchDeleteResponse>>('/tasks/batch-delete', {
        task_ids: taskIds,
    });
}

/**
 * 批量查询任务状态
 * @param taskIds 任务 ID 列表
 */
export async function getBatchStatus(taskIds: string[]): Promise<ApiResponse<BatchStatusResponse>> {
    return apiClient.post<ApiResponse<BatchStatusResponse>>('/tasks/status/batch', {
        task_ids: taskIds,
    });
}



/**
 * 批量打包下载
 * @param taskIds 任务 ID 列表
 * @param includeTypes 包含的文件类型
 */
export async function archiveTasks(
    taskIds: string[],
    includeTypes: string[] = ['image', 'xml']
): Promise<ArchiveResult> {
    const response = await apiClient.postDownload('/tasks/archive', {
        task_ids: taskIds,
        include_types: includeTypes,
    });

    const downloadedCount = parseInt(response.headers.get('X-Downloaded-Count') || '0', 10);
    const skippedCount = parseInt(response.headers.get('X-Skipped-Count') || '0', 10);

    return {
        blob: await response.blob(),
        downloadedCount,
        skippedCount,
    };
}

export const tasksApi = {
    listTasks,
    getTaskDetails,
    submitBatch,
    updateTask,
    deleteTask,
    batchDeleteTasks,
    getBatchStatus,
    archiveTasks,
};

export default tasksApi;
