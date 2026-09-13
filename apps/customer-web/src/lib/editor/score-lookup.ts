/**
 * Score lookup helpers.
 *
 * Provides shared entity lookup utilities for editor and connection flows.
 */

import type { ScoreData, ParsedScoreEvent, EntityMeta } from '@/types/score-types';

/**
 * Entity lookup result.
 */
export type FindEntityResult = {
    entity: ParsedScoreEvent;
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

    return findEntityByPredicate(scoreData, (meta) => meta.id === entityId);
}

/**
 * Finds the parsed score entity represented by one of the source MusicXML ids.
 *
 * This is safer than reopening an edited entity by stale voice/entity indexes
 * after domain export and legacy MusicXML reparse. Chords may represent
 * multiple MusicXML note ids, so every `meta.sourceIds` entry is considered.
 */
export function findEntityBySourceIds(scoreData: ScoreData | null, sourceIds: string[]): FindEntityResult {
    if (!scoreData || sourceIds.length === 0) return null;

    const requestedIds = new Set(sourceIds.filter(Boolean));
    if (requestedIds.size === 0) return null;

    for (const sourceId of requestedIds) {
        const bySourceId = findEntityByPredicate(scoreData, (meta) => (
            meta.sourceIds?.includes(sourceId) ?? false
        ));
        if (bySourceId) return bySourceId;
    }

    for (const sourceId of requestedIds) {
        const byEntityId = findEntityByPredicate(scoreData, (meta) => meta.id === sourceId);
        if (byEntityId) return byEntityId;
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

function findEntityByPredicate(
    scoreData: ScoreData,
    predicate: (meta: EntityMeta) => boolean
): FindEntityResult {
    for (const measure of scoreData.measures) {
        for (const stave of measure.staves) {
            for (const voice of stave.voices) {
                for (const note of voice.events) {
                    if (note.meta && predicate(note.meta)) {
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
