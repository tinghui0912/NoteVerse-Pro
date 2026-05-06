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
    getDurationValue,
    getDurationTypeName,
} from '@/lib/musicxml-core';
import {
    updateSingleNoteInXml,
    createNoteElementFromPitch,
} from '@/lib/musicxml-elements';
import { recalculateBackups } from '@/lib/musicxml-backup';

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

            // 插入新实体
            if (!currentXml || !scoreData) return;

            try {
                const xmlDoc = parseXml(currentXml);
                const divisionsEl = xmlDoc.querySelector('attributes divisions');
                const divisions = divisionsEl?.textContent ? parseInt(divisionsEl.textContent, 10) : 1;

                const measureNumber = location.measureIndex + 1;
                const staffNumber = location.staveIndex + 1;
                const voiceNum = location.xmlVoice;

                const measureEl = xmlDoc.querySelector(`measure[number="${measureNumber}"]`);
                if (!measureEl) return;

                // 创建新音符元素
                let noteEl: Element;
                if (updatedEntity.type === 'note' && 'pitch' in updatedEntity) {
                    noteEl = createNoteElementFromPitch(xmlDoc, updatedEntity.pitch, updatedEntity.duration, voiceNum, staffNumber, divisions, false);
                } else if (updatedEntity.type === 'rest') {
                    noteEl = xmlDoc.createElement('note');
                    const restEl = xmlDoc.createElement('common.rest');
                    noteEl.appendChild(restEl);
                    const durationEl = xmlDoc.createElement('duration');
                    durationEl.textContent = String(getDurationValue(updatedEntity.duration, divisions));
                    noteEl.appendChild(durationEl);
                    const voiceEl = xmlDoc.createElement('common.voice');
                    voiceEl.textContent = String(voiceNum);
                    noteEl.appendChild(voiceEl);
                    const typeEl = xmlDoc.createElement('type');
                    typeEl.textContent = getDurationTypeName(updatedEntity.duration);
                    noteEl.appendChild(typeEl);
                    const staffEl = xmlDoc.createElement('staff');
                    staffEl.textContent = String(staffNumber);
                    noteEl.appendChild(staffEl);
                } else if (updatedEntity.type === 'blank') {
                    // 空白使用 forward 元素表示
                    noteEl = xmlDoc.createElement('forward');
                    const durationEl = xmlDoc.createElement('duration');
                    durationEl.textContent = String(getDurationValue(updatedEntity.duration, divisions));
                    noteEl.appendChild(durationEl);
                    const voiceEl = xmlDoc.createElement('common.voice');
                    voiceEl.textContent = String(voiceNum);
                    noteEl.appendChild(voiceEl);
                    const staffEl = xmlDoc.createElement('staff');
                    staffEl.textContent = String(staffNumber);
                    noteEl.appendChild(staffEl);
                } else if (updatedEntity.type === 'chord' && 'pitches' in updatedEntity) {
                    // 和弦新增：创建多个音符元素
                    const pitches = updatedEntity.pitches;
                    if (pitches.length === 0) return;

                    // 创建第一个音符（无 chord 标签）
                    noteEl = createNoteElementFromPitch(xmlDoc, pitches[0], updatedEntity.duration, voiceNum, staffNumber, divisions, false);

                    // 找到插入位置
                    const chordEntityGroups = getEntityGroupsFromMeasure(measureEl, staffNumber, voiceNum);
                    const chordInsertIndex = location.position === 'after'
                        ? location.entityIndex + 1
                        : location.entityIndex;

                    if (chordEntityGroups.length === 0 || chordInsertIndex >= chordEntityGroups.length) {
                        measureEl.appendChild(noteEl);
                    } else {
                        const refElement = chordEntityGroups[chordInsertIndex].elements[0];
                        refElement.parentNode?.insertBefore(noteEl, refElement);
                    }

                    // 添加其余音符（带 chord 标签）
                    let prevNote = noteEl;
                    for (let i = 1; i < pitches.length; i++) {
                        const chordNote = createNoteElementFromPitch(xmlDoc, pitches[i], updatedEntity.duration, voiceNum, staffNumber, divisions, true);
                        prevNote.parentNode?.insertBefore(chordNote, prevNote.nextSibling);
                        prevNote = chordNote;
                    }

                    recalculateBackups(measureEl);

                    const chordNewXml = serializeXml(xmlDoc);
                    history.push(chordNewXml, t('addChord'));
                    currentXmlRef.current = chordNewXml;
                    setCurrentXml(chordNewXml);

                    const chordNewParser = new MusicXMLParser(chordNewXml, { expectedVoices: getExpectedVoices(scoreData) });
                    setScoreData(chordNewParser.parse());

                    setPendingInsert(null);
                    pendingInsertRef.current = null;
                    setEditingEntity(null);
                    setEditingEntityLocation(null);
                    return;
                } else {
                    return; // 不支持的类型
                }

                // 找到插入位置（考虑 position 字段）
                const entityGroups = getEntityGroupsFromMeasure(measureEl, staffNumber, voiceNum);
                // position === 'before' 时使用原始 entityIndex，position === 'after' 时 +1
                const insertIndex = location.position === 'after'
                    ? location.entityIndex + 1
                    : location.entityIndex;

                if (entityGroups.length === 0 || insertIndex >= entityGroups.length) {
                    measureEl.appendChild(noteEl);
                } else {
                    const refElement = entityGroups[insertIndex].elements[0];
                    refElement.parentNode?.insertBefore(noteEl, refElement);
                }

                recalculateBackups(measureEl);

                const newXml = serializeXml(xmlDoc);
                history.push(newXml, t('addNote'));
                currentXmlRef.current = newXml;
                setCurrentXml(newXml);

                const newParser = new MusicXMLParser(newXml, { expectedVoices: getExpectedVoices(scoreData) });
                setScoreData(newParser.parse());
            } catch (error) {
                console.error('Failed to insert entity:', error);
            }

            setPendingInsert(null);
            pendingInsertRef.current = null;
            setEditingEntity(null);
            setEditingEntityLocation(null);
            return;
        }

        // 以下是编辑现有实体的逻辑
        if (!editingEntityLocation || !currentXml || !scoreData) return;

        const { measureIndex, staveIndex, xmlVoice, entityIndex } = editingEntityLocation;

        try {
            const xmlDoc = parseXml(currentXml);
            const divisionsEl = xmlDoc.querySelector('attributes divisions');
            const divisions = divisionsEl?.textContent ? parseInt(divisionsEl.textContent, 10) : 1;

            const measureNumber = measureIndex + 1;
            const staffNumber = staveIndex + 1;
            const voiceNum = xmlVoice;

            const measureEl = xmlDoc.querySelector(`measure[number="${measureNumber}"]`);
            if (!measureEl) return;

            const entityGroups = getEntityGroupsFromMeasure(measureEl, staffNumber, voiceNum);
            const targetGroup = entityGroups[entityIndex];
            if (!targetGroup || targetGroup.elements.length === 0) return;

            const targetElements = targetGroup.elements;

            if (updatedEntity.type === 'chord' && 'pitches' in updatedEntity) {
                const pitches = updatedEntity.pitches;
                const fingerings = updatedEntity.fingerings || [];

                pitches.forEach((pitchStr, i) => {
                    const noteOptions = {
                        dotted: 'dotted' in updatedEntity ? updatedEntity.dotted : undefined,
                        stemDirection: 'stemDirection' in updatedEntity ? updatedEntity.stemDirection : undefined,
                        fingering: fingerings[i] || undefined,
                    };

                    if (i < targetElements.length) {
                        updateSingleNoteInXml(targetElements[i], pitchStr, updatedEntity.duration, divisions, i > 0, noteOptions);
                    } else {
                        const newNoteEl = createNoteElementFromPitch(xmlDoc, pitchStr, updatedEntity.duration, voiceNum, staffNumber, divisions, true);
                        const lastNote = targetElements[targetElements.length - 1];
                        lastNote.parentNode?.insertBefore(newNoteEl, lastNote.nextSibling);
                        targetElements.push(newNoteEl);
                        updateSingleNoteInXml(newNoteEl, pitchStr, updatedEntity.duration, divisions, true, noteOptions);
                    }
                });

                for (let i = targetElements.length - 1; i >= pitches.length; i--) {
                    targetElements[i].remove();
                }
            } else {
                const mainNote = targetElements[0];

                if (updatedEntity.type === 'rest' || updatedEntity.type === 'blank') {
                    const existingPitch = mainNote.querySelector('pitch');
                    if (existingPitch) existingPitch.remove();

                    let restEl = mainNote.querySelector('rest');
                    if (!restEl) {
                        restEl = xmlDoc.createElement('common.rest');
                        mainNote.insertBefore(restEl, mainNote.firstChild);
                    }

                    if ('dotted' in updatedEntity) {
                        const existingDot = mainNote.querySelector('dot');
                        if (updatedEntity.dotted && !existingDot) {
                            const dotEl = xmlDoc.createElement('dot');
                            const typeEl = mainNote.querySelector('type');
                            if (typeEl) {
                                typeEl.after(dotEl);
                            } else {
                                mainNote.appendChild(dotEl);
                            }
                        } else if (!updatedEntity.dotted && existingDot) {
                            existingDot.remove();
                        }
                    }

                    for (let i = 1; i < targetElements.length; i++) {
                        targetElements[i].remove();
                    }
                } else if (updatedEntity.type === 'note' && 'pitch' in updatedEntity) {
                    const noteOptions = {
                        dotted: updatedEntity.dotted,
                        stemDirection: updatedEntity.stemDirection,
                        fingering: updatedEntity.fingering,
                    };
                    updateSingleNoteInXml(mainNote, updatedEntity.pitch, updatedEntity.duration, divisions, false, noteOptions);

                    for (let i = 1; i < targetElements.length; i++) {
                        targetElements[i].remove();
                    }
                }

                const durationEl = mainNote.querySelector('duration');
                if (durationEl) {
                    durationEl.textContent = String(getDurationValue(updatedEntity.duration, divisions));
                }

                const typeEl = mainNote.querySelector('type');
                if (typeEl) {
                    typeEl.textContent = getDurationTypeName(updatedEntity.duration);
                }
            }

            recalculateBackups(measureEl);

            const newXml = serializeXml(xmlDoc);
            history.push(newXml, t('editNote'));
            currentXmlRef.current = newXml;
            setCurrentXml(newXml);

            const newParser = new MusicXMLParser(newXml, { expectedVoices: getExpectedVoices(scoreData) });
            setScoreData(newParser.parse());
        } catch (error) {
            console.error('Failed to update entity:', error);
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
