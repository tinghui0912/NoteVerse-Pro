'use client';

/**
 * 插入新实体到 MusicXML 的纯函数
 */

import type { ScoreEntity, AddLocation } from '@/types/score-types';
import type { ScoreData } from '@/types/score-types';
import { MusicXMLParser } from '@/lib/musicxml/parser';
import {
    parseXml,
    serializeXml,
    getEntityGroupsFromMeasure,
    getDurationValue,
    getDurationTypeName,
} from '@/lib/musicxml/core';
import {
    createNoteElementFromPitch,
    updateSingleNoteInXml,
} from '@/lib/musicxml/elements';
import { recalculateBackups } from '@/lib/musicxml/backup';

export interface InsertEntityParams {
    updatedEntity: ScoreEntity;
    location: AddLocation;
    currentXml: string;
    scoreData: ScoreData;
    getExpectedVoices: (data: ScoreData | null) => Map<number, Map<number, number[]>> | undefined;
}

export interface InsertEntityResult {
    success: boolean;
    newXml?: string;
    newScoreData?: ScoreData;
    historyLabel?: string;
}

/**
 * 插入新实体到 MusicXML 文档
 * 
 * @returns 处理结果，包含新的 XML 和解析后的乐谱数据
 */
export function insertEntity(params: InsertEntityParams): InsertEntityResult {
    const { updatedEntity, location, currentXml, scoreData, getExpectedVoices } = params;

    try {
        const xmlDoc = parseXml(currentXml);
        const divisionsEl = xmlDoc.querySelector('attributes divisions');
        const divisions = divisionsEl?.textContent ? parseInt(divisionsEl.textContent, 10) : 1;

        const measureNumber = location.measureIndex + 1;
        const staffNumber = location.staveIndex + 1;
        const voiceNum = location.xmlVoice;

        const measureEl = xmlDoc.querySelector(`measure[number="${measureNumber}"]`);
        if (!measureEl) return { success: false };

        // 创建新音符元素
        let noteEl: Element;
        if (updatedEntity.type === 'note' && 'pitch' in updatedEntity) {
            noteEl = createNoteElementFromPitch(xmlDoc, updatedEntity.pitch, updatedEntity.duration, voiceNum, staffNumber, divisions, false);
            updateSingleNoteInXml(noteEl, updatedEntity.pitch, updatedEntity.duration, divisions, false, {
                dotted: updatedEntity.dotted,
                stemDirection: updatedEntity.stemDirection,
                fingering: updatedEntity.fingering,
            });
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
            if (pitches.length === 0) return { success: false };

            // 创建第一个音符（无 chord 标签）
            const fingerings = updatedEntity.fingerings || [];
            noteEl = createNoteElementFromPitch(xmlDoc, pitches[0], updatedEntity.duration, voiceNum, staffNumber, divisions, false);
            updateSingleNoteInXml(noteEl, pitches[0], updatedEntity.duration, divisions, false, {
                dotted: updatedEntity.dotted,
                stemDirection: updatedEntity.stemDirection,
                fingering: fingerings[0],
            });

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
                updateSingleNoteInXml(chordNote, pitches[i], updatedEntity.duration, divisions, true, {
                    dotted: updatedEntity.dotted,
                    stemDirection: updatedEntity.stemDirection,
                    fingering: fingerings[i],
                });
                prevNote.parentNode?.insertBefore(chordNote, prevNote.nextSibling);
                prevNote = chordNote;
            }

            recalculateBackups(measureEl);

            const chordNewXml = serializeXml(xmlDoc);
            const chordNewParser = new MusicXMLParser(chordNewXml, { expectedVoices: getExpectedVoices(scoreData) });

            return {
                success: true,
                newXml: chordNewXml,
                newScoreData: chordNewParser.parse(),
                historyLabel: 'addChord',
            };
        } else {
            return { success: false }; // 不支持的类型
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
        const newParser = new MusicXMLParser(newXml, { expectedVoices: getExpectedVoices(scoreData) });

        return {
            success: true,
            newXml,
            newScoreData: newParser.parse(),
            historyLabel: 'addNote',
        };
    } catch (error) {
        console.error('Failed to insert entity:', error);
        return { success: false };
    }
}
