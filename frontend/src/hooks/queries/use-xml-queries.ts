/**
 * XML 相关 TanStack Query hooks
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-client';
import { xmlApi } from '@/lib/api';

// ============ Query Hooks ============

/**
 * XML 内容查询（editor/results/practice 页面共用）
 */
export function useXmlContent(
    taskId: string,
    source: 'enhanced' | 'final' | 'current' = 'current',
    options?: { shareToken?: string; enabled?: boolean }
) {
    return useQuery({
        queryKey: queryKeys.xml.content(taskId, source, options?.shareToken),
        queryFn: () => xmlApi.loadXml(taskId, source, options?.shareToken),
        enabled: options?.enabled ?? !!taskId,
        staleTime: Infinity, // XML 内容不自动过期（手动 invalidate）
    });
}

// ============ Mutation Hooks ============

/**
 * 保存 XML 内容
 */
export function useSaveXml() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ taskId, content, fileType, imageType }: {
            taskId: string;
            content: string;
            fileType?: 'current_xml' | 'final_xml';
            imageType?: 'preview_image' | 'final_image';
        }) => xmlApi.saveXmlContent(taskId, content, fileType, imageType),
        onSuccess: (_, { taskId }) => {
            // 保存后让所有相关 XML 缓存失效
            queryClient.invalidateQueries({
                queryKey: ['xml', taskId],
            });
            queryClient.invalidateQueries({
                queryKey: queryKeys.tasks.detail(taskId),
            });
        },
    });
}

/**
 * 生成钢琴指法
 */
export function useGenerateFingering() {
    return useMutation({
        mutationFn: ({ taskId, hand, depth }: {
            taskId: string;
            hand?: 'right' | 'left' | 'both';
            depth?: number;
        }) => xmlApi.generateFingering(taskId, hand, depth),
    });
}

/**
 * 确认识别结果
 */
export function useConfirmRecognition() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ taskId }: { taskId: string }) =>
            xmlApi.confirmRecognition(taskId),
        onSuccess: (_, { taskId }) => {
            queryClient.invalidateQueries({ queryKey: queryKeys.tasks.detail(taskId) });
        },
    });
}
