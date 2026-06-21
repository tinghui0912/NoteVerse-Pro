/**
 * Score 工具函数
 * 提供在 scoreData 中查找实体的通用方法
 */

import type { ScoreData, ScoreEntity, EntityMeta } from '@/types/score-types';

/**
 * 查找结果类型
 */
export type FindEntityResult = {
    entity: ScoreEntity;
    meta: EntityMeta;
} | null;

/**
 * 根据 entityId 在 scoreData 中查找对应的 ScoreEntity 和 EntityMeta
 * 
 * @param scoreData 乐谱数据
 * @param entityId 实体 ID
 * @returns 包含 entity 和 meta 的对象，未找到则返回 null
 */
export function findEntityById(scoreData: ScoreData | null, entityId: string): FindEntityResult {
    if (!scoreData) return null;

    for (const measure of scoreData.measures) {
        for (const stave of measure.staves) {
            for (const voice of stave.voices) {
                for (const note of voice.notes) {
                    if (note.meta?.id === entityId) {
                        return {
                            entity: note,
                            meta: note.meta
                        };
                    }
                }
            }
        }
    }
    return null;
}

/**
 * 根据 entityId 在 scoreData 中查找对应的 EntityMeta
 * 
 * @param scoreData 乐谱数据
 * @param entityId 实体 ID
 * @returns EntityMeta 对象，未找到则返回 null
 */
export function findEntityMetaById(scoreData: ScoreData | null, entityId: string): EntityMeta | null {
    const result = findEntityById(scoreData, entityId);
    return result?.meta ?? null;
}
