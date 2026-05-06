/**
 * 草稿存储模块 - 使用 IndexedDB 存储编辑器草稿
 */
import Dexie, { type Table } from 'dexie';

/**
 * 草稿条目接口
 */
export interface DraftEntry {
    taskId: string;
    xml: string;
    source: 'current' | 'final' | 'enhanced';
    returnUrl?: string;
    savedAt: number;
}

/**
 * 草稿数据库类
 */
class DraftDatabase extends Dexie {
    drafts!: Table<DraftEntry, string>;

    constructor() {
        super('NoteVerseDrafts');
        this.version(1).stores({
            drafts: 'taskId, savedAt'
        });
    }
}

// 数据库实例（延迟初始化，避免 SSR 问题）
let db: DraftDatabase | null = null;

function getDB(): DraftDatabase {
    if (!db && typeof window !== 'undefined') {
        db = new DraftDatabase();
    }
    if (!db) {
        throw new Error('IndexedDB is not available');
    }
    return db;
}

/**
 * 保存草稿
 */
export async function saveDraft(
    taskId: string,
    xml: string,
    options: { source: DraftEntry['source']; returnUrl?: string }
): Promise<void> {
    try {
        const db = getDB();
        await db.drafts.put({
            taskId,
            xml,
            source: options.source,
            returnUrl: options.returnUrl,
            savedAt: Date.now()
        });
    } catch (error) {
        console.error('[DraftStorage] Failed to save draft:', error);
    }
}

/**
 * 加载草稿
 */
export async function loadDraft(taskId: string): Promise<DraftEntry | undefined> {
    try {
        const db = getDB();
        return await db.drafts.get(taskId);
    } catch (error) {
        console.error('[DraftStorage] Failed to load draft:', error);
        return undefined;
    }
}

/**
 * 删除草稿
 */
export async function deleteDraft(taskId: string): Promise<void> {
    try {
        const db = getDB();
        await db.drafts.delete(taskId);
    } catch (error) {
        console.error('[DraftStorage] Failed to delete draft:', error);
    }
}

/**
 * 清理过期草稿
 * @param maxAgeDays 最大保留天数，默认 7 天
 */
export async function cleanOldDrafts(maxAgeDays: number = 7): Promise<number> {
    try {
        const db = getDB();
        const threshold = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
        const count = await db.drafts.where('savedAt').below(threshold).count();
        await db.drafts.where('savedAt').below(threshold).delete();
        if (count > 0) {
            console.log(`[DraftStorage] Cleaned ${count} old drafts`);
        }
        return count;
    } catch (error) {
        console.error('[DraftStorage] Failed to clean old drafts:', error);
        return 0;
    }
}

