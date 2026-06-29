'use client';

/**
 * 实体编辑 Hook - 管理事件的新增、修改和删除
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
import { rebuildAutomaticBeamsForMeasure } from '@/lib/musicxml/automatic-beams';
import { createDefaultEditableEvent, toScoreEntity } from '@/lib/editor/editable-event';
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

function findInsertedEntity(data: ReturnType<MusicXMLParser['parse']>, location: AddLocation) {
    const stave = data.measures[location.measureIndex]?.staves[location.staveIndex];
    const candidates = stave?.voices
        .flatMap((voice) => voice.notes)
        .filter((entity) => (
            entity.meta?.xmlVoice === location.xmlVoice
            && entity.meta.measureIndex === location.measureIndex
            && entity.meta.staveIndex === location.staveIndex
        )) ?? [];

    const exact = candidates.find((entity) => entity.meta?.startTick === location.tick);
    const entity = exact ?? candidates[0];
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
        pendingInsert,
        setPendingInsert,
        pendingInsertRef,
        setInspectorOpen,
        selectTool,
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
     * Add mode creates an empty-pitch event first.
     * The Inspector then lets the user turn it into a note or chord by adding pitches.
     */
    const handleAddEntity = useCallback((location: AddLocation) => {
        const newEntity = toScoreEntity(createDefaultEditableEvent());
        const insertData = { entity: newEntity, location };

        setPendingInsert(insertData);
        pendingInsertRef.current = insertData;
        setEditingEntity(newEntity);
        setEditingEntityLocation({
            measureIndex: location.measureIndex,
            staveIndex: location.staveIndex,
            xmlVoice: location.xmlVoice,
            entityIndex: 0,
        });
        setInspectorOpen(true);
    }, [
        pendingInsertRef,
        setEditingEntity,
        setEditingEntityLocation,
        setInspectorOpen,
        setPendingInsert,
    ]);

    /**
     * Close the Inspector and clear any pending insert state.
     */
    const handleCloseModal = useCallback(() => {
        const wasPendingInsert = Boolean(pendingInsertRef.current);
        setEditingEntity(null);
        setEditingEntityLocation(null);
        setPendingInsert(null);
        pendingInsertRef.current = null;
        setInspectorOpen(false);
        if (wasPendingInsert) {
            selectTool('select');
        }
    }, [
        pendingInsertRef,
        selectTool,
        setEditingEntity,
        setEditingEntityLocation,
        setInspectorOpen,
        setPendingInsert,
    ]);

    /**
     * Save either a pending insert or an existing event edit.
     */
    const updateEntity = useCallback((updatedEntity: ScoreEntity, options: UpdateEntityOptions = {}) => {
        const currentPendingInsert = pendingInsertRef.current;
        const shouldKeepInspectorOpen = options.keepInspectorOpen === true;

        if (currentPendingInsert) {
            const { location } = currentPendingInsert;

            if (!currentXml || !scoreData) return;

            const result = insertEntity({
                updatedEntity,
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
            }

            setPendingInsert(null);
            pendingInsertRef.current = null;
            selectTool('select');
            if (shouldKeepInspectorOpen && result.success && result.newScoreData) {
                const inserted = findInsertedEntity(result.newScoreData, location);
                setEditingEntity(inserted?.entity ?? updatedEntity);
                setEditingEntityLocation(inserted?.location ?? {
                    measureIndex: location.measureIndex,
                    staveIndex: location.staveIndex,
                    xmlVoice: location.xmlVoice,
                    entityIndex: 0,
                });
                setInspectorOpen(true);
            } else {
                setEditingEntity(null);
                setEditingEntityLocation(null);
                setInspectorOpen(false);
            }
            return;
        }

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
    }, [currentXml, scoreData, editingEntityLocation, pendingInsertRef, currentXmlRef, setCurrentXml, history, getExpectedVoices, setScoreData, setPendingInsert, setEditingEntity, setEditingEntityLocation, setInspectorOpen, selectTool, t]);

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
            rebuildAutomaticBeamsForMeasure(xmlDoc, measureEl);

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
            console.error('Failed to delete entity:', error);
        }
    }, [currentXml, scoreData, currentXmlRef, setCurrentXml, history, getExpectedVoices, setScoreData, t]);

    return {
        // State
        editingEntity,
        editingEntityLocation,
        pendingInsert,

        // Actions
        handleEditEntity,
        handleDeleteEntity,
        handleAddEntity,
        handleCloseModal,
        updateEntity,
    };
}
