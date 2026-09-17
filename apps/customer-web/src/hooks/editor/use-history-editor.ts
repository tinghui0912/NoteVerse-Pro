'use client';

/**
 * Undo/redo control hook for editor history.
 */

import { useCallback } from 'react';
import { useScoreData } from '@/contexts/score-data-context';
import { useHistory } from '@/contexts/editor-history-context';
import { useEditorState } from '@/contexts/editor-state-context';
import {
    importMusicXmlToEditorDomain,
    type DomainAnchor,
    type ScoreDocument,
} from '@/lib/editor-domain';

export function useHistoryEditor() {
    const history = useHistory();
    const { setCurrentXml, currentXmlRef, reparseXml } = useScoreData();
    const {
        editingSelection,
        openEditingSelection,
        clearEditingSelection,
        setInspectorOpen,
    } = useEditorState();

    const applyHistoryXml = useCallback((xml: string) => {
        currentXmlRef.current = xml;
        setCurrentXml(xml);
        reparseXml(xml);
        const imported = importMusicXmlToEditorDomain(xml);
        const domainAnchor = findExistingDomainAnchor(imported.document, editingSelection?.domainAnchor ?? null);
        if (domainAnchor) {
            openEditingSelection({
                domainAnchor,
                domainCompanion: null,
            });
        } else {
            clearEditingSelection();
            setInspectorOpen(false);
        }
    }, [
        currentXmlRef,
        editingSelection?.domainAnchor,
        reparseXml,
        setCurrentXml,
        openEditingSelection,
        clearEditingSelection,
        setInspectorOpen,
    ]);

    const handleUndo = useCallback(() => {
        const xml = history.undo();
        if (xml) applyHistoryXml(xml);
    }, [applyHistoryXml, history]);

    const handleRedo = useCallback(() => {
        const xml = history.redo();
        if (xml) applyHistoryXml(xml);
    }, [applyHistoryXml, history]);

    return {
        canUndo: history.canUndo,
        canRedo: history.canRedo,
        handleUndo,
        handleRedo,
    };
}

function findExistingDomainAnchor(document: ScoreDocument, anchor: DomainAnchor | null): DomainAnchor | null {
    if (!anchor) return null;
    if (anchor.kind === 'event') {
        return document.events.some((event) => event.id === anchor.eventId) ? anchor : null;
    }
    if (anchor.kind === 'noteAtom') {
        const event = document.events.find((candidate) => candidate.id === anchor.eventId);
        if (event?.kind !== 'pitched') return null;
        return event.notes.some((note) => note.id === anchor.noteAtomId) ? anchor : null;
    }
    return anchor;
}
