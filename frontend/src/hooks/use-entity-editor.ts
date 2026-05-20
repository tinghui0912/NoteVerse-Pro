'use client';

/**
 * 实体编辑 Hook - 管理实体的增删改
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
        editingEntity,
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
     * 打开编辑实体模态框
     */
    const handleEditEntity = useCallback((entity: ScoreEntity, location: EntityLocation) => {
        setEditingEntity(entity);
        setEditingEntityLocation(location);
    }, [setEditingEntity, setEditingEntityLocation]);

    /**
     * 打开添加实体模态框
     */
    const handleAddEntity = useCallback((location: AddLocation) => {
        setCurrentAddLocation(location);
        setIsAddEntityModalOpen(true);
    }, [setCurrentAddLocation, setIsAddEntityModalOpen]);

    /**
     * 关闭模态框
     */
    const handleCloseModal = useCallback(() => {
        setEditingEntity(null);
        setEditingEntityLocation(null);
        setIsAddEntityModalOpen(false);
        setCurrentAddLocation(null);
        setPendingInsert(null);
    }, [setEditingEntity, setEditingEntityLocation, setIsAddEntityModalOpen, setCurrentAddLocation, setPendingInsert]);

    /**
     * 选择实体类型后创建默认实体
     */
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

        // 保存待插入状态（包含实体和位置）
        const insertData = { entity: newEntity, location: currentAddLocation };
        setPendingInsert(insertData);
        pendingInsertRef.current = insertData;

        // 关闭类型选择模态框，打开编辑模态框
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
     * 更新实体（编辑或新增）
     */
    const updateEntity = useCallback((updatedEntity: ScoreEntity) => {
        const currentPendingInsert = pendingInsertRef.current;

        // 检查是否是新增操作
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
                history.push(result.newXml, t(result.historyLabel as any));
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

        // 以下是编辑现有实体的逻辑
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
     * 删除实体
     */
    const handleDeleteEntity = useCallback((location: EntityLocation) => {
        const { measureIndex, staveIndex, xmlVoice, entityIndex } = location;

        if (!currentXml || !scoreData) return;

        const measureNumber = measureIndex + 1;
        const staffNumber = staveIndex + 1;
        const voiceNum = xmlVoice;

        try {
            // 1. 解析 XML 并删除目标实体
            const xmlDoc = parseXml(currentXml);
            const measureEl = xmlDoc.querySelector(`measure[number="${measureNumber}"]`);
            if (!measureEl) return;

            const entityGroups = getEntityGroupsFromMeasure(measureEl, staffNumber, voiceNum);
            const targetGroup = entityGroups[entityIndex];
            if (!targetGroup) return;

            targetGroup.elements.forEach(el => el.parentNode?.removeChild(el));

            // 重新计算 backup 元素的 duration
            recalculateBackups(measureEl);

            // 2. 序列化新 XML
            const newXml = serializeXml(xmlDoc);

            // 3. 记录历史
            history.push(newXml, t('deleteNote'));

            // 4. 更新 XML 状态
            currentXmlRef.current = newXml;
            setCurrentXml(newXml);

            // 5. 重新解析 XML
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
        // 状态
        editingEntity,
        editingEntityLocation,
        isAddEntityModalOpen,
        currentAddLocation,
        pendingInsert,

        // 操作
        handleEditEntity,
        handleDeleteEntity,
        handleAddEntity,
        handleSelectEntityType,
        handleCloseModal,
        updateEntity,
    };
}
