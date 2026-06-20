/**
 * XML 编辑相关 API
 */
import { apiClient, ApiResponse } from '../api-client';
import type { SaveAndRenderResponse, SaveResponse, FingeringResponse } from '@/types/api';

// ============ API 函数 ============

/**
 * 加载 XML 文件内容
 * @param taskId 任务 ID
 * @param source 产品 XML 来源: 'final' | 'current'
 * @param shareToken 可选的分享 token（用于非任务所有者访问）
 */
export async function loadXml(
    taskId: string,
    source: 'final' | 'current',
    shareToken?: string,
    signal?: AbortSignal
): Promise<string> {
    const params: Record<string, string> = { source };
    if (shareToken) {
        params.share_token = shareToken;
    }

    const response = await apiClient.getRaw(`/xml/${taskId}/xml`, params, { signal });
    const json = await response.json();
    return json.data?.content || '';
}

/**
 * 保存 XML 内容（统一接口）
 * @param taskId 任务 ID
 * @param content XML 内容
 * @param fileType 文件类型 ('current_xml' | 'final_xml')
 * @param imageType 图片类型（可选，传入则触发渲染）
 */
export async function saveXmlContent(
    taskId: string,
    content: string,
    fileType: 'current_xml' | 'final_xml' = 'current_xml',
    imageType?: 'preview_image' | 'final_image'
): Promise<ApiResponse<SaveResponse>> {
    return apiClient.post<ApiResponse<SaveResponse>>(`/xml/${taskId}/xml`, {
        content,
        file_type: fileType,
        image_type: imageType,
    });
}


/**
 * 生成钢琴指法
 * @param taskId 任务 ID
 * @param hand 手: 'right' | 'left' | 'both'
 * @param depth 搜索深度 1-10
 */
export async function generateFingering(
    taskId: string,
    hand: 'right' | 'left' | 'both' = 'both',
    depth: number = 6
): Promise<ApiResponse<FingeringResponse>> {
    return apiClient.post<ApiResponse<FingeringResponse>>(`/xml/${taskId}/fingering`, {
        hand,
        depth,
    });
}

/**
 * 确认识别结果（发布为最终版本）
 * 服务端直接读取 current_xml 复制到 final.xml 并渲染
 * @param taskId 任务 ID
 */
export async function confirmRecognition(
    taskId: string
): Promise<ApiResponse<SaveAndRenderResponse>> {
    return apiClient.post(`/xml/${taskId}/confirm`, {});
}

export const xmlApi = {
    loadXml,
    saveXmlContent,
    generateFingering,
    confirmRecognition,
};

export default xmlApi;
