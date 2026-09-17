'use client';

/**
 * Entity editing hook for adding, updating, and deleting score events.
 */

import { useCallback } from 'react';
import { useScoreData } from '@/contexts/score-data-context';
import { useEditorState } from '@/contexts/editor-state-context';
import { useHistory } from '@/contexts/editor-history-context';
import { useTranslations } from 'next-intl';
import type { DomainSelectionCompanion } from '@/lib/editor/domain-selection-companion';
import {
    findVoiceEventByMusicXmlElementIds,
    importMusicXmlToEditorDomain,
    type DomainAnchor,
    type EventId,
    type InsertionAnchor,
} from '@/lib/editor-domain';
import { MusicXMLParser } from '@/lib/musicxml/parser';
import { applyEditorDomainEditToXml } from './use-editor-domain-edit';
import {
    applyAddModeDomainInsert,
    createDefaultAddModeInsertCommand,
    type AddModeInsertCommand,
} from './entity-editor';

function findInsertedSourceIds(data: ReturnType<MusicXMLParser['parse']>, insertedEntityId: string): string[] {
    const entity = data.measures
        .flatMap((measure) => measure.staves)
        .flatMap((stave) => stave.voices)
        .flatMap((voice) => voice.events)
        .find((candidate) => (
            candidate.meta?.sourceIds?.includes(insertedEntityId)
            || candidate.meta?.id === insertedEntityId
        ));
    if (!entity?.meta) return [];
    return entity.meta.sourceIds ?? [entity.meta.id];
}

export function useEntityEditor() {
    const t = useTranslations('editor.actions');
    const {
        scoreData,
        currentXml,
        currentXmlRef,
        setScoreData,
        setCurrentXml,
        reparseXml,
        getExpectedVoices
    } = useScoreData();

    const {
        openEditingSelection,
        clearEditingSelection,
        setInspectorOpen,
    } = useEditorState();

    const history = useHistory();

    const handleDomainSelectionCompanion = useCallback((companion: DomainSelectionCompanion) => {
        openEditingSelection({
            domainAnchor: companion.domainAnchor,
            domainCompanion: companion,
        });
        setInspectorOpen(true);
    }, [openEditingSelection, setInspectorOpen]);

    /**
     * Add mode applies an explicit insert command, then keeps the inserted event selected.
     * The default command inserts an explicit rest; future add tools can pass a pitched command
     * without changing the timeline placement path.
     */
    const handleAddEntity = useCallback((insertionAnchor: InsertionAnchor, command: AddModeInsertCommand = createDefaultAddModeInsertCommand()) => {
        if (!currentXml || !scoreData) return;

        const result = applyAddModeDomainInsert({
            command,
            insertionAnchor,
            currentXml,
            scoreData,
            getExpectedVoices,
        });

        if (result.success && result.newXml && result.newScoreData) {
            history.push(result.newXml, t(result.historyLabel as never));
            currentXmlRef.current = result.newXml;
            setCurrentXml(result.newXml);
            setScoreData(result.newScoreData);

            const insertedSourceIds = findInsertedSourceIds(result.newScoreData, result.insertedEntityId);
            if (insertedSourceIds.length === 0) return;
            const domainAnchor = findInsertedDomainAnchor(
                result.newXml,
                insertedSourceIds,
            );
            openEditingSelection({
                domainAnchor,
                domainCompanion: null,
            });
            setInspectorOpen(true);
        }

    }, [
        currentXml,
        currentXmlRef,
        getExpectedVoices,
        history,
        openEditingSelection,
        scoreData,
        setCurrentXml,
        setInspectorOpen,
        setScoreData,
        t,
    ]);

    /**
     * Close the Inspector.
     */
    const handleCloseModal = useCallback(() => {
        clearEditingSelection();
        setInspectorOpen(false);
    }, [
        clearEditingSelection,
        setInspectorOpen,
    ]);

    const handleDeleteEntity = useCallback((domainAnchor: DomainAnchor | null) => {
        if (!currentXml) return;
        const domainDeleteEventId = getDeleteEventId(domainAnchor);
        if (!domainDeleteEventId) return;

        const result = applyEditorDomainEditToXml({
            xml: currentXml,
            draft: {
                kind: 'deleteEvent',
                eventId: domainDeleteEventId,
            },
        });
        if (!result.success) return;

        history.push(result.xml, t('deleteNote'));
        currentXmlRef.current = result.xml;
        setCurrentXml(result.xml);
        reparseXml(result.xml);
        clearEditingSelection();
        setInspectorOpen(false);
    }, [
        currentXml,
        history,
        currentXmlRef,
        setCurrentXml,
        reparseXml,
        clearEditingSelection,
        setInspectorOpen,
        t,
    ]);

    return {
        // Actions
        handleDomainSelectionCompanion,
        handleDeleteEntity,
        handleAddEntity,
        handleCloseModal,
    };
}

function getDeleteEventId(domainAnchor: DomainAnchor | null): EventId | null {
    if (!domainAnchor) return null;
    if (domainAnchor.kind === 'event' || domainAnchor.kind === 'noteAtom') {
        return domainAnchor.eventId;
    }
    return null;
}

function findInsertedDomainAnchor(xml: string, sourceIds: string[]): DomainAnchor | null {
    const imported = importMusicXmlToEditorDomain(xml);
    const event = findVoiceEventByMusicXmlElementIds(imported.document, sourceIds);
    return event ? { kind: 'event', eventId: event.id } : null;
}
