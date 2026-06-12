'use client';

/**
 * 瀹炰綋缂栬緫 Hook - 绠＄悊瀹炰綋鐨勫鍒犳敼
 */

import { useCallback } from 'react';
import { useScoreData } from '../contexts/score-data-context';
import { useEditorState } from '../contexts/editor-state-context';
import { useHistory } from '../contexts/history-context';
import { useTranslations } from 'next-intl';
import type { ScoreEntity, ScoreEntityType, AddLocation, EntityLocation } from '@/types/score-types';
import { MusicXMLParser } from '@/lib/musicxml-parser';
import {
    parseXml,
    serializeXml,
    getEntityGroupsFromMeasure,
} from '@/lib/musicxml-core';
import { recalculateBackups } from '@/lib/musicxml-backup';
import { insertEntity } from './entity-editor/insert-entity';
import { updateExistingEntity } from './entity-editor/update-existing-entity';

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
        setEditingEntity,
        editingEntityLocation,
        setEditingEntityLocation,
        isAddEntityModalOpen,
        setIsAddEntityModalOpen,
        currentAddLocation,
        setCurrentAddLocation,
        pendingInsert,
        setPendingInsert,
        pendingInsertRef,
    } = useEditorState();

    const history = useHistory();

    /**
     * 鎵撳紑缂栬緫瀹炰綋妯℃€佹
     */
    const handleEditEntity = useCallback((entity: ScoreEntity, location: EntityLocation) => {
        setEditingEntity(entity);
        setEditingEntityLocation(location);
    }, [setEditingEntity, setEditingEntityLocation]);

    /**
     * 鎵撳紑娣诲姞瀹炰綋妯℃€佹
     */
    const handleAddEntity = useCallback((location: AddLocation) => {
        setCurrentAddLocation(location);
        setIsAddEntityModalOpen(true);
    }, [setCurrentAddLocation, setIsAddEntityModalOpen]);

    /**
     * 鍏抽棴妯℃€佹
     */
    const handleCloseModal = useCallback(() => {
        setEditingEntity(null);
        setEditingEntityLocation(null);
        setIsAddEntityModalOpen(false);
        setCurrentAddLocation(null);
        setPendingInsert(null);
    }, [setEditingEntity, setEditingEntityLocation, setIsAddEntityModalOpen, setCurrentAddLocation, setPendingInsert]);

    /**
     * 閫夋嫨瀹炰綋绫诲瀷鍚庡垱寤洪粯璁ゅ疄浣?     */
    const handleSelectEntityType = useCallback((type: ScoreEntityType) => {
        if (!currentAddLocation) return;

        let newEntity: ScoreEntity;

        if (type === 'note') {
            newEntity = {
                type: 'note',
                pitch: 'C4',
                duration: 'durationQuarter',
                dotted: false,
            };
        } else if (type === 'rest') {
            newEntity = {
                type: 'rest',
                duration: 'durationQuarter',
                dotted: false,
            };
        } else if (type === 'chord') {
            newEntity = {
                type: 'chord',
                pitches: ['C4', 'E4', 'G4'],
                duration: 'durationQuarter',
                dotted: false,
            };
        } else if (type === 'blank') {
            newEntity = {
                type: 'blank',
                duration: 'durationQuarter',
                dotted: false,
            };
        } else {
            return;
        }

        // 淇濆瓨寰呮彃鍏ョ姸鎬侊紙鍖呭惈瀹炰綋鍜屼綅缃級
        const insertData = { entity: newEntity, location: currentAddLocation };
        setPendingInsert(insertData);
        pendingInsertRef.current = insertData;

        // 鍏抽棴绫诲瀷閫夋嫨妯℃€佹锛屾墦寮€缂栬緫妯℃€佹
        setIsAddEntityModalOpen(false);
        setEditingEntity(newEntity);
        setEditingEntityLocation({
            measureIndex: currentAddLocation.measureIndex,
            staveIndex: currentAddLocation.staveIndex,
            xmlVoice: currentAddLocation.xmlVoice,
            entityIndex: currentAddLocation.position === 'before'
                ? currentAddLocation.entityIndex
                : currentAddLocation.entityIndex + 1,
        });
    }, [currentAddLocation, setPendingInsert, pendingInsertRef, setIsAddEntityModalOpen, setEditingEntity, setEditingEntityLocation]);

    /**
     * 鏇存柊瀹炰綋锛堢紪杈戞垨鏂板锛?     */
    const updateEntity = useCallback((updatedEntity: ScoreEntity) => {
        const currentPendingInsert = pendingInsertRef.current;

        // 妫€鏌ユ槸鍚︽槸鏂板鎿嶄綔
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
            setEditingEntity(null);
            setEditingEntityLocation(null);
            return;
        }

        // 浠ヤ笅鏄紪杈戠幇鏈夊疄浣撶殑閫昏緫
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

        setEditingEntity(null);
        setEditingEntityLocation(null);
    }, [currentXml, scoreData, editingEntityLocation, pendingInsertRef, currentXmlRef, setCurrentXml, history, getExpectedVoices, setScoreData, setPendingInsert, setEditingEntity, setEditingEntityLocation, t]);

    /**
     * 鍒犻櫎瀹炰綋
     */
    const handleDeleteEntity = useCallback((location: EntityLocation) => {
        const { measureIndex, staveIndex, xmlVoice, entityIndex } = location;

        if (!currentXml || !scoreData) return;

        const measureNumber = measureIndex + 1;
        const staffNumber = staveIndex + 1;
        const voiceNum = xmlVoice;

        try {
            // 1. 瑙ｆ瀽 XML 骞跺垹闄ょ洰鏍囧疄浣?
            const xmlDoc = parseXml(currentXml);
            const measureEl = xmlDoc.querySelector(`measure[number="${measureNumber}"]`);
            if (!measureEl) return;

            const entityGroups = getEntityGroupsFromMeasure(measureEl, staffNumber, voiceNum);
            const targetGroup = entityGroups[entityIndex];
            if (!targetGroup) return;

            targetGroup.elements.forEach(el => el.parentNode?.removeChild(el));

            // 閲嶆柊璁＄畻 backup 鍏冪礌鐨?duration
            recalculateBackups(measureEl);

            // 2. 搴忓垪鍖栨柊 XML
            const newXml = serializeXml(xmlDoc);

            // 3. 璁板綍鍘嗗彶
            history.push(newXml, t('deleteNote'));

            // 4. 鏇存柊 XML 鐘舵€?
            currentXmlRef.current = newXml;
            setCurrentXml(newXml);

            // 5. 閲嶆柊瑙ｆ瀽 XML
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
        // 鐘舵€?        editingEntity,
        editingEntityLocation,
        isAddEntityModalOpen,
        currentAddLocation,
        pendingInsert,

        // 鎿嶄綔
        handleEditEntity,
        handleDeleteEntity,
        handleAddEntity,
        handleSelectEntityType,
        handleCloseModal,
        updateEntity,
    };
}
