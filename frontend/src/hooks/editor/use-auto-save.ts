/**
 * 自动保存草稿 Hook
 */
import { useEffect, useRef, useCallback, useState } from 'react';
import { saveDraft, deleteDraft, loadDraft, cleanOldDrafts, type DraftEntry } from '@/lib/editor/draft-storage';

interface UseAutoSaveOptions {
    source: 'current' | 'final';
    returnUrl?: string;
    debounceMs?: number;
    enabled?: boolean;
}

interface UseAutoSaveReturn {
    clearDraft: () => Promise<void>;
    loadExistingDraft: () => Promise<DraftEntry | undefined>;
    isSaving: boolean;
}

/**
 * 自动保存草稿 Hook
 * 
 * @param taskId 任务 ID
 * @param xml 当前 XML 内容
 * @param options 配置选项
 */
export function useAutoSave(
    taskId: string,
    xml: string | null,
    options: UseAutoSaveOptions
): UseAutoSaveReturn {
    const { source, returnUrl, debounceMs = 3000, enabled = true } = options;

    const [isSaving, setIsSaving] = useState(false);
    const timeoutRef = useRef<NodeJS.Timeout | null>(null);
    const lastSavedXmlRef = useRef<string | null>(null);

    // 保存草稿（去抖）
    useEffect(() => {
        if (!enabled || !xml || !taskId) return;

        // 如果内容没有变化，不保存
        if (xml === lastSavedXmlRef.current) return;

        // 清除之前的定时器
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
        }

        // 设置新的定时器
        timeoutRef.current = setTimeout(async () => {
            setIsSaving(true);
            try {
                await saveDraft(taskId, xml, { source, returnUrl });
                lastSavedXmlRef.current = xml;
                console.log('[AutoSave] Draft saved');
            } finally {
                setIsSaving(false);
            }
        }, debounceMs);

        return () => {
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }
        };
    }, [taskId, xml, source, returnUrl, debounceMs, enabled]);

    // 页面加载时清理过期草稿
    useEffect(() => {
        cleanOldDrafts(7);
    }, []);

    // 清除草稿
    const clearDraft = useCallback(async () => {
        await deleteDraft(taskId);
        lastSavedXmlRef.current = null;
        console.log('[AutoSave] Draft cleared');
    }, [taskId]);

    // 加载现有草稿
    const loadExistingDraft = useCallback(async () => {
        return loadDraft(taskId);
    }, [taskId]);

    return {
        clearDraft,
        loadExistingDraft,
        isSaving
    };
}
