'use client';

/**
 * Entity editing hook for adding, updating, and deleting score events.
 */

import { useCallback } from 'react';
import { useScoreData } from '@/contexts/score-data-context';
import { useEditorState } from '@/contexts/editor-state-context';
import { useHistory } from '@/contexts/editor-history-context';
import { useTranslations } from 'next-intl';
import type { ScoreEntity, AddLocation, EntityLocation } from '@/types/score-types';
import { MusicXMLParser } from '@/lib/musicxml/parser';
import {
    parseXml,
    serializeXml,
    getEntityGroupsFromMeasure,
} from '@/lib/musicxml/core';
import { recalculateBackups } from '@/lib/musicxml/backup';
import { repairAutomaticBeamsForVoice } from '@/lib/musicxml/automatic-beams';
import { createDefaultEditableEvent, toScoreEntity } from '@/lib/editor/editable-event';
import { reportUnexpectedClientError } from '@/lib/observability';
import { insertEntity } from './entity-editor/insert-entity';
import { updateExistingEntity } from './entity-editor/update-existing-entity';

type UpdateEntityOptions = {
    keepInspectorOpen?: boolean;
};

function findEntityAtLocation(data: ReturnType<MusicXMLParser['parse']>, location: EntityLocation) {
    const stave = data.measures[location.measureIndex]?.staves[location.staveIndex];
    const voice = stave?.voices.find((candidate) => (
        candidate.notes.some((entity) => entity.meta?.xmlVoice === location.xmlVoice)
    ));
    const entity = voice?.notes[location.entityIndex];
    if (!entity?.meta) return null;
    return { entity, location: entity.meta };
}

function findInsertedEntity(data: ReturnType<MusicXMLParser['parse']>, location: AddLocation, insertedEntityId?: string) {
    const stave = data.measures[location.measureIndex]?.staves[location.staveIndex];
    const candidates = stave?.voices
        .flatMap((voice) => voice.notes)
        .filter((entity) => (
            entity.meta?.xmlVoice === location.xmlVoice
            && entity.meta.measureIndex === location.measureIndex
            && entity.meta.staveIndex === location.staveIndex
        )) ?? [];

    const byId = insertedEntityId
        ? candidates.find((entity) => entity.meta?.sourceIds?.includes(insertedEntityId) || entity.meta?.id === insertedEntityId)
        : undefined;
    const exact = candidates.find((entity) => entity.meta?.startTick === location.tick);
    const entity = byId ?? exact ?? candidates[0];
    if (!entity?.meta) return null;
    return { entity, location: entity.meta };
}

export function useEntityEditor() {
    const t = useTranslations('editor.actions');
    const {
        scoreData,
        currentXml,
        currentXmlRef,
        setScoreData,
        setCurrentXml,
        getExpectedVoices
    } = useScoreData();

    const {
        editingEntity,
        setEditingEntity,
        editingEntityLocation,
        setEditingEntityLocation,
        setInspectorOpen,
    } = useEditorState();

    const history = useHistory();

    /**
     * Open the Inspector for an existing event.
     */
    const handleEditEntity = useCallback((entity: ScoreEntity, location: EntityLocation) => {
        setEditingEntity(entity);
        setEditingEntityLocation(location);
        setInspectorOpen(true);
    }, [setEditingEntity, setEditingEntityLocation, setInspectorOpen]);

    /**
     * Add mode writes an empty-pitch rest immediately, then keeps it selected.
     * The Inspector can then turn it into a note/chord by adding pitches.
     */
    const handleAddEntity = useCallback((location: AddLocation) => {
        const newEntity = toScoreEntity(createDefaultEditableEvent());

        if (!currentXml || !scoreData) return;

        const result = insertEntity({
            updatedEntity: newEntity,
            location,
            currentXml,
            scoreData,
            getExpectedVoices,
        });

        if (result.success && result.newXml && result.newScoreData) {
            history.push(result.newXml, t(result.historyLabel as never));
            currentXmlRef.current = result.newXml;
            setCurrentXml(result.newXml);
            setScoreData(result.newScoreData);

            const inserted = findInsertedEntity(result.newScoreData, location, result.insertedEntityId);
            setEditingEntity(inserted?.entity ?? newEntity);
            setEditingEntityLocation(inserted?.location ?? {
                measureIndex: location.measureIndex,
                staveIndex: location.staveIndex,
                xmlVoice: location.xmlVoice,
                entityIndex: 0,
            });
            setInspectorOpen(true);
        }

    }, [
        currentXml,
        currentXmlRef,
        getExpectedVoices,
        history,
        scoreData,
        setCurrentXml,
        setEditingEntity,
        setEditingEntityLocation,
        setInspectorOpen,
        setScoreData,
        t,
    ]);

    /**
     * Close the Inspector.
     */
    const handleCloseModal = useCallback(() => {
        setEditingEntity(null);
        setEditingEntityLocation(null);
        setInspectorOpen(false);
    }, [
        setEditingEntity,
        setEditingEntityLocation,
        setInspectorOpen,
    ]);

    /**
     * Update an existing event.
     */
    const updateEntity = useCallback((updatedEntity: ScoreEntity, options: UpdateEntityOptions = {}) => {
        const shouldKeepInspectorOpen = options.keepInspectorOpen === true;

        if (!editingEntityLocation || !currentXml || !scoreData) return;

        const result = updateExistingEntity({
            updatedEntity,
            editingEntityLocation,
            currentXml,
            scoreData,
            getExpectedVoices,
        });

        if (result.success && result.newXml && result.newScoreData) {
            history.push(result.newXml, t('editNote'));
            currentXmlRef.current = result.newXml;
            setCurrentXml(result.newXml);
            setScoreData(result.newScoreData);
        }

        if (shouldKeepInspectorOpen && result.success && result.newScoreData) {
            const updated = findEntityAtLocation(result.newScoreData, editingEntityLocation);
            setEditingEntity(updated?.entity ?? updatedEntity);
            setEditingEntityLocation(updated?.location ?? editingEntityLocation);
            setInspectorOpen(true);
        } else {
            setEditingEntity(null);
            setEditingEntityLocation(null);
            setInspectorOpen(false);
        }
    }, [currentXml, scoreData, editingEntityLocation, currentXmlRef, setCurrentXml, history, getExpectedVoices, setScoreData, setEditingEntity, setEditingEntityLocation, setInspectorOpen, t]);

    /**
     * Delete an existing event from the MusicXML measure.
     */
    const handleDeleteEntity = useCallback((location: EntityLocation) => {
        const { measureIndex, staveIndex, xmlVoice, entityIndex } = location;

        if (!currentXml || !scoreData) return;

        const measureNumber = measureIndex + 1;
        const staffNumber = staveIndex + 1;
        const voiceNum = xmlVoice;

        try {
            const xmlDoc = parseXml(currentXml);
            const measureEl = xmlDoc.querySelector(`measure[number="${measureNumber}"]`);
            if (!measureEl) return;

            const entityGroups = getEntityGroupsFromMeasure(measureEl, staffNumber, voiceNum);
            const targetGroup = entityGroups[entityIndex];
            if (!targetGroup) return;

            targetGroup.elements.forEach(el => el.parentNode?.removeChild(el));

            recalculateBackups(measureEl);
            repairAutomaticBeamsForVoice(xmlDoc, measureEl, staffNumber, voiceNum);

            const newXml = serializeXml(xmlDoc);

            history.push(newXml, t('deleteNote'));

            currentXmlRef.current = newXml;
            setCurrentXml(newXml);

            const newParser = new MusicXMLParser(newXml, {
                expectedVoices: getExpectedVoices(scoreData)
            });
            const parsedData = newParser.parse();
            setScoreData(parsedData);

        } catch (error) {
            reportUnexpectedClientError(error, {
                area: 'editor',
                action: 'delete_entity',
            });
        }
    }, [currentXml, scoreData, currentXmlRef, setCurrentXml, history, getExpectedVoices, setScoreData, t]);

    return {
        // State
        editingEntity,
        editingEntityLocation,

        // Actions
        handleEditEntity,
        handleDeleteEntity,
        handleAddEntity,
        handleCloseModal,
        updateEntity,
    };
}
