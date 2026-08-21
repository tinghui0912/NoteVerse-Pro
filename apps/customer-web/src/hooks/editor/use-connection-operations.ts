'use client';

import { useTranslations } from 'next-intl';

import { useState, useCallback } from 'react';
import type { ConnectionTarget } from '@/lib/editor/connection-target';
import {
    findNoteAtomByMusicXmlElementId,
    type NoteAtom,
    type NoteAtomId,
    type PitchedEvent,
    type Rational,
    type ScoreDocument,
} from '@/lib/editor-domain';
import { useEditorDomainDocument } from './use-editor-domain-document';
import { useEditorDomainEdit } from './use-editor-domain-edit';

// Operation result type.
type OperationResult = {
    success: boolean;
    message: string;
    count?: number;
};

type SelectedConnectionTarget = ConnectionTarget & {
    key: string;
};

// Hook parameter type.
type UseConnectionOperationsParams = {
    currentXml: string | null;
};

/**
 * Connection operation hook for adding, deleting, and updating tie/slur links.
 */
export function useConnectionOperations({
    currentXml,
}: UseConnectionOperationsParams) {
    const t = useTranslations('editor');
    const tCommon = useTranslations('common');
    const domainDocument = useEditorDomainDocument();
    const {
        addDomainSlurRelationshipsBySourceIds,
        addDomainTieRelationshipsBySourceIds,
        deleteDomainSlurRelationshipsForSourceIds,
        deleteDomainTieRelationshipsForSourceIds,
    } = useEditorDomainEdit();

    // Selection state.
    const [selectedTieTargets, setSelectedTieTargets] = useState<SelectedConnectionTarget[]>([]);
    const [selectedSlurTargets, setSelectedSlurTargets] = useState<SelectedConnectionTarget[]>([]);

    // Selection clearers used when the active editor tool changes.
    const clearTieSelection = useCallback(() => setSelectedTieTargets([]), []);
    const clearSlurSelection = useCallback(() => setSelectedSlurTargets([]), []);

    // Delete all tie connections for a selected source-id target.
    const handleDeleteTie = (selectedTarget: ConnectionTarget): OperationResult => {
        if (!currentXml || !domainDocument.document) {
            return { success: false, message: t('noConnectionData') };
        }

        const target = createConnectionSelectionTarget(selectedTarget);
        if (!target) {
            return { success: false, message: t('noConnectionData') };
        }

        const summary = getDomainConnectionDeletionSummary(domainDocument.document, target.sourceIds, 'tie');
        if (summary.relationshipCount === 0) {
            return { success: false, message: t('noteHasNoTie') };
        }

        const deleteResult = deleteDomainTieRelationshipsForSourceIds({
            sourceIds: target.sourceIds,
            actionName: t('deleteTie'),
        });
        if (!deleteResult.success) {
            return { success: false, message: deleteResult.error };
        }

        const count = summary.endpointSourceIds.length;
        return { success: true, message: t('tieDeleted', { count }), count };
    };

    // Delete all slur connections for a selected source-id target.
    const handleDeleteSlur = (selectedTarget: ConnectionTarget): OperationResult => {
        if (!currentXml || !domainDocument.document) {
            return { success: false, message: t('noConnectionData') };
        }

        const target = createConnectionSelectionTarget(selectedTarget);
        if (!target) {
            return { success: false, message: t('noConnectionData') };
        }

        const summary = getDomainConnectionDeletionSummary(domainDocument.document, target.sourceIds, 'slur');
        if (summary.relationshipCount === 0) {
            return { success: false, message: t('noteHasNoSlur') };
        }

        const deleteResult = deleteDomainSlurRelationshipsForSourceIds({
            sourceIds: target.sourceIds,
            actionName: t('deleteSlur'),
        });
        if (!deleteResult.success) {
            return { success: false, message: deleteResult.error };
        }

        const count = summary.endpointSourceIds.length;
        return { success: true, message: t('slurDeleted', { count }), count };
    };

    // Add a tie by selecting two note/chord targets.
    const handleAddTieSelection = (selectedTarget: ConnectionTarget): OperationResult => {
        if (!currentXml || !domainDocument.document) {
            return { success: false, message: t('noNoteData') };
        }

        const target = createConnectionSelectionTarget(selectedTarget);
        if (!target) {
            return { success: false, message: t('noNoteData') };
        }

        if (selectedTieTargets.some((candidate) => candidate.key === target.key)) {
            return { success: false, message: t('noteAlreadySelected') };
        }

        if (selectedTieTargets.length === 0) {
            setSelectedTieTargets([target]);
            return { success: true, message: t('firstNoteSelected') };
        }

        const firstTarget = selectedTieTargets[0];

        const validation = validateDomainTieCreation({
            document: domainDocument.document,
            startSourceIds: firstTarget.sourceIds,
            endSourceIds: target.sourceIds,
        });
        if (validation !== 'valid') {
            if (validation === 'different-staff') {
                return { success: false, message: t('mustSameStave', { type: tCommon('tie') }) };
            }
            if (validation === 'different-pitch') {
                return { success: false, message: t('mustSamePitch') };
            }
            if (validation === 'not-adjacent') {
                setSelectedTieTargets([]);
                return { success: false, message: t('mustAdjacentNotes') };
            }
            setSelectedTieTargets([]);
            return { success: false, message: t('noNoteData') };
        }

        const addResult = addDomainTieRelationshipsBySourceIds({
            startSourceIds: firstTarget.sourceIds,
            endSourceIds: target.sourceIds,
            actionName: t('addTie'),
        });
        if (!addResult.success) {
            setSelectedTieTargets([]);
            return { success: false, message: addResult.error };
        }

        setSelectedTieTargets([]);
        return { success: true, message: t('tieCreated') };
    };

    // Add a slur by selecting two note/chord targets.
    const handleAddSlurSelection = (selectedTarget: ConnectionTarget): OperationResult => {
        if (!currentXml || !domainDocument.document) {
            return { success: false, message: t('noNoteData') };
        }

        const target = createConnectionSelectionTarget(selectedTarget);
        if (!target) {
            return { success: false, message: t('noNoteData') };
        }

        if (selectedSlurTargets.some((candidate) => candidate.key === target.key)) {
            return { success: false, message: t('noteAlreadySelected') };
        }

        if (selectedSlurTargets.length === 0) {
            setSelectedSlurTargets([target]);
            return { success: true, message: t('firstNoteSelected') };
        }

        const firstTarget = selectedSlurTargets[0];

        // Slurs may cross staves and voices in piano-score scenarios. The domain
        // hook orders start/stop by score position before exporting MusicXML.
        const addResult = addDomainSlurRelationshipsBySourceIds({
            startSourceIds: firstTarget.sourceIds,
            endSourceIds: target.sourceIds,
            actionName: t('addSlur'),
        });
        if (!addResult.success) {
            setSelectedSlurTargets([]);
            return { success: false, message: addResult.error };
        }

        setSelectedSlurTargets([]);
        return { success: true, message: t('slurCreated') };
    };

    return {
        // Clear functions.
        clearTieSelection,
        clearSlurSelection,
        // Delete operations.
        handleDeleteTie,
        handleDeleteSlur,
        // Add operations.
        handleAddTieSelection,
        handleAddSlurSelection,
    };
}

function createConnectionSelectionTarget(
    target: ConnectionTarget
): SelectedConnectionTarget | null {
    const sourceIds = [...new Set(target.sourceIds.filter(Boolean))];
    if (sourceIds.length === 0) return null;
    return {
        key: sourceIds.join('|'),
        sourceIds,
    };
}

export type DomainTieCreationValidationResult =
    | 'valid'
    | 'missing-note'
    | 'different-staff'
    | 'different-pitch'
    | 'not-adjacent';

export function validateDomainTieCreation(params: {
    document: ScoreDocument;
    startSourceIds: string[];
    endSourceIds: string[];
}): DomainTieCreationValidationResult {
    const startTargets = findTieCreationTargets(params.document, params.startSourceIds);
    const endTargets = findTieCreationTargets(params.document, params.endSourceIds);
    if (startTargets.length === 0 || endTargets.length === 0) return 'missing-note';

    const startEvent = startTargets[0]?.event;
    const endEvent = endTargets[0]?.event;
    if (!startEvent || !endEvent) return 'missing-note';
    if (startEvent.staffId !== endEvent.staffId) return 'different-staff';

    const startPitchKeys = startTargets.map(({ note }) => getPitchKey(note)).sort();
    const endPitchKeys = endTargets.map(({ note }) => getPitchKey(note)).sort();
    if (!areStringArraysEqual(startPitchKeys, endPitchKeys)) return 'different-pitch';

    const earlier = compareEventPosition(params.document, startEvent, endEvent) <= 0
        ? startEvent
        : endEvent;
    const later = earlier === startEvent ? endEvent : startEvent;
    if (hasIntermediatePitchedEventOnStaff(params.document, earlier, later)) {
        return 'not-adjacent';
    }

    return 'valid';
}

export function getDomainConnectionDeletionSummary(
    document: ScoreDocument,
    sourceIds: string[],
    type: 'tie' | 'slur'
): {
    relationshipCount: number;
    endpointSourceIds: string[];
} {
    const selectedNoteAtomIds = new Set(sourceIds
        .map((sourceId) => findNoteAtomByMusicXmlElementId(document, sourceId)?.note.id)
        .filter((noteAtomId): noteAtomId is NoteAtomId => Boolean(noteAtomId)));
    if (selectedNoteAtomIds.size === 0) {
        return { relationshipCount: 0, endpointSourceIds: [] };
    }

    const endpointNoteAtomIds = new Set<NoteAtomId>();
    const relationships = type === 'tie'
        ? document.tieRelationships
        : document.slurRelationships;

    relationships.forEach((relationship) => {
        if (
            !selectedNoteAtomIds.has(relationship.startNoteAtomId)
            && !selectedNoteAtomIds.has(relationship.stopNoteAtomId)
        ) {
            return;
        }
        endpointNoteAtomIds.add(relationship.startNoteAtomId);
        endpointNoteAtomIds.add(relationship.stopNoteAtomId);
    });

    return {
        relationshipCount: endpointNoteAtomIds.size === 0 ? 0 : relationships.filter((relationship) => (
            selectedNoteAtomIds.has(relationship.startNoteAtomId)
            || selectedNoteAtomIds.has(relationship.stopNoteAtomId)
        )).length,
        endpointSourceIds: getSourceIdsForNoteAtomIds(document, endpointNoteAtomIds),
    };
}

function getSourceIdsForNoteAtomIds(document: ScoreDocument, noteAtomIds: Set<NoteAtomId>): string[] {
    const sourceIds: string[] = [];
    document.events.forEach((event) => {
        if (event.kind !== 'pitched') return;
        event.notes.forEach((note) => {
            if (!noteAtomIds.has(note.id)) return;
            sourceIds.push(note.source?.musicXmlElementId ?? String(note.id));
        });
    });
    return [...new Set(sourceIds)];
}

function findTieCreationTargets(
    document: ScoreDocument,
    sourceIds: string[]
): Array<{ event: PitchedEvent; note: NoteAtom }> {
    const targets: Array<{ event: PitchedEvent; note: NoteAtom }> = [];
    const seen = new Set<NoteAtomId>();
    sourceIds.forEach((sourceId) => {
        const found = findNoteAtomByMusicXmlElementId(document, sourceId);
        if (!found || seen.has(found.note.id)) return;
        targets.push({ event: found.event, note: found.note });
        seen.add(found.note.id);
    });
    return targets;
}

function getPitchKey(note: NoteAtom): string {
    return `${note.pitch.step}:${note.pitch.octave}:${note.pitch.alter ?? 0}`;
}

function areStringArraysEqual(left: string[], right: string[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

function hasIntermediatePitchedEventOnStaff(
    document: ScoreDocument,
    earlier: PitchedEvent,
    later: PitchedEvent
): boolean {
    return document.events.some((event) => (
        event.kind === 'pitched'
        && event.staffId === earlier.staffId
        && event.id !== earlier.id
        && event.id !== later.id
        && compareEventPosition(document, event, earlier) > 0
        && compareEventPosition(document, event, later) < 0
    ));
}

function compareEventPosition(document: ScoreDocument, left: PitchedEvent, right: PitchedEvent): number {
    const measureOrder = getMeasureOrder(document, left.position.measureId) - getMeasureOrder(document, right.position.measureId);
    if (measureOrder !== 0) return measureOrder;
    return compareRational(left.position.offset, right.position.offset);
}

function getMeasureOrder(document: ScoreDocument, measureId: string): number {
    const index = document.measures.findIndex((measure) => measure.id === measureId);
    return index >= 0 ? index : Number.MAX_SAFE_INTEGER;
}

function compareRational(left: Rational, right: Rational): number {
    return left.numerator * right.denominator - right.numerator * left.denominator;
}
