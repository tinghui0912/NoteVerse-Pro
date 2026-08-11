'use client';

import { useTranslations } from 'next-intl';

import { useState, useCallback } from 'react';
import type { ScoreData, ScoreEntity, EntityLocation, EntityMeta } from '@/types/score-types';
import {
    removeTieElementsFromXML,
    removeSlurElementsFromXML,
    removeTieConnectionFromXML,
    removeSlurConnectionFromXML,
    setTieConnectionDirectionInXML,
    setSlurConnectionDirectionInXML,
    addTieElementsToXML,
    addSlurElementsToXML,
    type ConnectionDirection,
} from '@/lib/musicxml/connections';
import { findEntityMetaById } from '@/lib/editor/score-lookup';

// Operation result type.
type OperationResult = {
    success: boolean;
    message: string;
    count?: number;
};

// Selected note target.
type SelectedNote = {
    entity: ScoreEntity;
    location: EntityLocation;
    sourceId?: string;
};

// Hook parameter type.
type UseConnectionOperationsParams = {
    scoreData: ScoreData | null;
    currentXml: string | null;
    updateMusicXML: (updater: (doc: XMLDocument) => void, actionName?: string) => void;
};

/**
 * Connection operation hook for adding, deleting, and updating tie/slur links.
 */
export function useConnectionOperations({
    scoreData,
    currentXml,
    updateMusicXML
}: UseConnectionOperationsParams) {
    const t = useTranslations('editor');
  const tCommon = useTranslations('common');

    // Selection state.
    const [selectedNotesForTie, setSelectedNotesForTie] = useState<SelectedNote[]>([]);
    const [selectedNotesForSlur, setSelectedNotesForSlur] = useState<SelectedNote[]>([]);

    // Selection clearers used when the active editor tool changes.
    const clearTieSelection = useCallback(() => setSelectedNotesForTie([]), []);
    const clearSlurSelection = useCallback(() => setSelectedNotesForSlur([]), []);

    // Delete all tie connections for an entity.
    const handleDeleteTie = (entity: ScoreEntity): OperationResult => {
        if (!scoreData?.connections?.noteConnections || !entity.meta?.id || !currentXml) {
            return { success: false, message: t('noConnectionData') };
        }

        const entityId = entity.meta.id;
        const entityConns = scoreData.connections.noteConnections.get(entityId);

        // Check whether the entity has tie connections.
        if (!entityConns || entityConns.ties.length === 0) {
            return { success: false, message: t('noteHasNoTie') };
        }

        const allNoteIds = new Set<string>([entityId]);
        const entityMetas: EntityMeta[] = [];

        if (entity.meta) {
            entityMetas.push(entity.meta);
        }

        entityConns.ties.forEach(tie => {
            if (!allNoteIds.has(tie.partnerId)) {
                allNoteIds.add(tie.partnerId);
                const meta = findEntityMetaById(scoreData, tie.partnerId);
                if (meta) entityMetas.push(meta);
            }
        });

        const count = allNoteIds.size;

        updateMusicXML((xmlDoc) => {
            removeTieElementsFromXML(xmlDoc, entityMetas);
        }, t('deleteTie'));

        return { success: true, message: t('tieDeleted', { count }), count };
    };

    // Delete all slur connections for an entity.
    const handleDeleteSlur = (entity: ScoreEntity): OperationResult => {
        if (!scoreData?.connections?.noteConnections || !entity.meta?.id || !currentXml) {
            return { success: false, message: t('noConnectionData') };
        }

        const entityId = entity.meta.id;
        const entityConns = scoreData.connections.noteConnections.get(entityId);

        if (!entityConns || entityConns.slurs.length === 0) {
            return { success: false, message: t('noteHasNoSlur') };
        }

        const allNoteIds = new Set<string>();
        const entityMetas: EntityMeta[] = [];

        entityConns.slurs.forEach(slur => {
            slur.partnerIds.forEach(id => {
                if (!allNoteIds.has(id)) {
                    allNoteIds.add(id);
                    const meta = findEntityMetaById(scoreData, id);
                    if (meta) entityMetas.push(meta);
                }
            });
        });

        const count = allNoteIds.size;

        updateMusicXML((xmlDoc) => {
            removeSlurElementsFromXML(xmlDoc, entityMetas);
        }, t('deleteSlur'));

        return { success: true, message: t('slurDeleted', { count }), count };
    };

    const handleDeleteTieConnection = (
        entity: ScoreEntity,
        partnerId: string,
        sourceId?: string,
        partnerSourceId?: string
    ): OperationResult => {
        if (!scoreData?.connections?.noteConnections || !entity.meta?.id || !currentXml) {
            return { success: false, message: t('noConnectionData') };
        }

        const partnerMeta = findEntityMetaById(scoreData, partnerId);
        if (!partnerMeta) {
            return { success: false, message: t('noNoteData') };
        }

        updateMusicXML((xmlDoc) => {
            removeTieConnectionFromXML(xmlDoc, entity.meta!, partnerMeta, {
                startSourceId: sourceId,
                endSourceId: partnerSourceId,
            });
        }, t('deleteTie'));

        return { success: true, message: t('tieDeleted', { count: 2 }), count: 2 };
    };

    const handleDeleteSlurConnection = (
        entity: ScoreEntity,
        partnerId: string,
        sourceId?: string,
        partnerSourceId?: string
    ): OperationResult => {
        if (!scoreData?.connections?.noteConnections || !entity.meta?.id || !currentXml) {
            return { success: false, message: t('noConnectionData') };
        }

        const partnerMeta = findEntityMetaById(scoreData, partnerId);
        if (!partnerMeta) {
            return { success: false, message: t('noNoteData') };
        }

        updateMusicXML((xmlDoc) => {
            removeSlurConnectionFromXML(xmlDoc, entity.meta!, partnerMeta, {
                startSourceId: sourceId,
                endSourceId: partnerSourceId,
            });
        }, t('deleteSlur'));

        return { success: true, message: t('slurDeleted', { count: 2 }), count: 2 };
    };

    const handleUpdateTieConnectionDirection = (
        entity: ScoreEntity,
        partnerId: string,
        direction: ConnectionDirection,
        sourceId?: string,
        partnerSourceId?: string
    ): OperationResult => {
        if (!scoreData?.connections?.noteConnections || !entity.meta?.id || !currentXml) {
            return { success: false, message: t('noConnectionData') };
        }

        const partnerMeta = findEntityMetaById(scoreData, partnerId);
        if (!partnerMeta) {
            return { success: false, message: t('noNoteData') };
        }

        updateMusicXML((xmlDoc) => {
            setTieConnectionDirectionInXML(xmlDoc, entity.meta!, partnerMeta, direction, {
                startSourceId: sourceId,
                endSourceId: partnerSourceId,
            });
        }, t('actions.updateConnectionDirection'));

        return { success: true, message: t('connectionDirectionUpdated') };
    };

    const handleUpdateSlurConnectionDirection = (
        entity: ScoreEntity,
        partnerId: string,
        direction: ConnectionDirection,
        sourceId?: string,
        partnerSourceId?: string
    ): OperationResult => {
        if (!scoreData?.connections?.noteConnections || !entity.meta?.id || !currentXml) {
            return { success: false, message: t('noConnectionData') };
        }

        const partnerMeta = findEntityMetaById(scoreData, partnerId);
        if (!partnerMeta) {
            return { success: false, message: t('noNoteData') };
        }

        updateMusicXML((xmlDoc) => {
            setSlurConnectionDirectionInXML(xmlDoc, entity.meta!, partnerMeta, direction, {
                startSourceId: sourceId,
                endSourceId: partnerSourceId,
            });
        }, t('actions.updateConnectionDirection'));

        return { success: true, message: t('connectionDirectionUpdated') };
    };

    // Add a tie by selecting two note/chord targets.
    const handleAddTieSelection = (location: EntityLocation, entity: ScoreEntity, sourceId?: string): OperationResult => {
        if (!currentXml || !entity.meta) {
            return { success: false, message: t('noNoteData') };
        }

        if (entity.type !== 'note' && entity.type !== 'chord') {
            return { success: false, message: t('onlyNoteOrChord', { type: tCommon('tie') }) };
        }

        if (selectedNotesForTie.some(n => n.entity.meta?.id === entity.meta?.id && n.sourceId === sourceId)) {
            return { success: false, message: t('noteAlreadySelected') };
        }

        if (selectedNotesForTie.length === 0) {
            setSelectedNotesForTie([{ entity, location, sourceId }]);
            return { success: true, message: t('firstNoteSelected') };
        }

        const firstNote = selectedNotesForTie[0];

        // Ties must stay within the same staff, but may cross voices for piano or complex scores.
        if (firstNote.location.staveIndex !== location.staveIndex) {
            return { success: false, message: t('mustSameStave', { type: tCommon('tie') }) };
        }

        const getEntityPitches = (e: ScoreEntity, selectedSourceId?: string): string[] => {
            if (e.type === 'note') return [e.pitch];
            if (e.type === 'chord') {
                const sourceIndex = selectedSourceId && e.meta?.sourceIds
                    ? e.meta.sourceIds.indexOf(selectedSourceId)
                    : -1;
                if (sourceIndex >= 0 && e.pitches[sourceIndex]) {
                    return [e.pitches[sourceIndex]];
                }
                return [...e.pitches].sort();
            }
            return [];
        };

        const firstPitches = getEntityPitches(firstNote.entity, firstNote.sourceId);
        const secondPitches = getEntityPitches(entity, sourceId);

        if (JSON.stringify(firstPitches) !== JSON.stringify(secondPitches)) {
            return { success: false, message: t('mustSamePitch') };
        }

        // Check adjacency by startTick.
        // Ties normally connect adjacent notes; reject if another note sits between them.
        const firstMeta = firstNote.entity.meta!;
        const secondMeta = entity.meta!;
        const getGlobalTick = (meta: { measureIndex: number; startTick?: number }) =>
            meta.measureIndex * 1000000 + (meta.startTick ?? 0);

        const firstTick = getGlobalTick(firstMeta);
        const secondTick = getGlobalTick(secondMeta);
        const [earlierTick, laterTick] = firstTick < secondTick
            ? [firstTick, secondTick]
            : [secondTick, firstTick];

        // Check for intermediate notes on the same staff.
        if (scoreData) {
            let hasIntermediateNotes = false;
            for (const measure of scoreData.measures) {
                for (const stave of measure.staves) {
                    // Only inspect the same staff.
                    if (stave.name !== scoreData.measures[firstMeta.measureIndex]?.staves[firstMeta.staveIndex]?.name) {
                        continue;
                    }
                    for (const voice of stave.voices) {
                        for (const note of voice.notes) {
                            if (note.meta && note.type !== 'rest' && note.type !== 'blank') {
                                const noteTick = getGlobalTick(note.meta);
                                if (noteTick > earlierTick && noteTick < laterTick) {
                                    hasIntermediateNotes = true;
                                    break;
                                }
                            }
                        }
                        if (hasIntermediateNotes) break;
                    }
                    if (hasIntermediateNotes) break;
                }
                if (hasIntermediateNotes) break;
            }

            if (hasIntermediateNotes) {
                // Reject creation because ties must connect adjacent notes.
                setSelectedNotesForTie([]);
                return { success: false, message: t('mustAdjacentNotes') };
            }
        }

        // addTieElementsToXML orders start/stop from startTick, so no manual swap is needed.

        updateMusicXML((xmlDoc) => {
            addTieElementsToXML(xmlDoc, firstNote.entity.meta!, entity.meta!, {
                startSourceId: firstNote.sourceId,
                endSourceId: sourceId,
            });
        }, t('addTie'));

        setSelectedNotesForTie([]);
        return { success: true, message: t('tieCreated') };
    };

    // Add a slur by selecting two note/chord targets.
    const handleAddSlurSelection = (location: EntityLocation, entity: ScoreEntity, sourceId?: string): OperationResult => {
        if (!currentXml || !entity.meta) {
            return { success: false, message: t('noNoteData') };
        }

        if (entity.type !== 'note' && entity.type !== 'chord') {
            return { success: false, message: t('onlyNoteOrChord', { type: tCommon('slur') }) };
        }

        if (selectedNotesForSlur.some(n => n.entity.meta?.id === entity.meta?.id && n.sourceId === sourceId)) {
            return { success: false, message: t('noteAlreadySelected') };
        }

        if (selectedNotesForSlur.length === 0) {
            setSelectedNotesForSlur([{ entity, location, sourceId }]);
            return { success: true, message: t('firstNoteSelected') };
        }

        const firstNote = selectedNotesForSlur[0];

        // Slurs may cross staves and voices in piano-score scenarios.
        // addSlurElementsToXML orders start/stop from startTick.

        updateMusicXML((xmlDoc) => {
            // addSlurElementsToXML derives start/stop order from XML document position.
            // No manual comparison or swap is needed here.
            addSlurElementsToXML(xmlDoc, firstNote.entity.meta!, entity.meta!, {
                startSourceId: firstNote.sourceId,
                endSourceId: sourceId,
            });
        }, t('addSlur'));

        setSelectedNotesForSlur([]);
        return { success: true, message: t('slurCreated') };
    };

    return {
        // Selection state.
        selectedNotesForTie,
        selectedNotesForSlur,
        // Clear functions.
        clearTieSelection,
        clearSlurSelection,
        // Delete operations.
        handleDeleteTie,
        handleDeleteSlur,
        handleDeleteTieConnection,
        handleDeleteSlurConnection,
        handleUpdateTieConnectionDirection,
        handleUpdateSlurConnectionDirection,
        // Add operations.
        handleAddTieSelection,
        handleAddSlurSelection,
    };
}
