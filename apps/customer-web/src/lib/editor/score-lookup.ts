/**
 * Score lookup helpers.
 *
 * Provides shared entity lookup utilities for editor and connection flows.
 */

import type { ScoreData, ScoreEntity, EntityMeta } from '@/types/score-types';

/**
 * Entity lookup result.
 */
export type FindEntityResult = {
    entity: ScoreEntity;
    meta: EntityMeta;
} | null;

/**
 * Finds the score entity and metadata for an entity id.
 *
 * @param scoreData Parsed score data.
 * @param entityId Entity id to find.
 * @returns Entity plus metadata, or null when not found.
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
 * Finds the metadata for an entity id.
 *
 * @param scoreData Parsed score data.
 * @param entityId Entity id to find.
 * @returns Entity metadata, or null when not found.
 */
export function findEntityMetaById(scoreData: ScoreData | null, entityId: string): EntityMeta | null {
    const result = findEntityById(scoreData, entityId);
    return result?.meta ?? null;
}
