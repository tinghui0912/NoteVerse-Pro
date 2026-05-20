'use client';

/**
 * 更新已有实体的纯函数
 */

import type { ScoreEntity, EntityLocation } from '@/types/score-types';
import type { ScoreData } from '@/types/score-types';
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

export interface UpdateExistingEntityParams {
    updatedEntity: ScoreEntity;
    editingEntityLocation: EntityLocation;
    currentXml: string;
    scoreData: ScoreData;
    getExpectedVoices: (data: ScoreData | null) => Map<number, Map<number, number[]>> | undefined;
}

export interface UpdateExistingEntityResult {
    success: boolean;
    newXml?: string;
    newScoreData?: ScoreData;
}

/**
 * 更新已存在的实体
 * 
 * @returns 处理结果，包含新的 XML 和解析后的乐谱数据
 */
export function updateExistingEntity(params: UpdateExistingEntityParams): UpdateExistingEntityResult {
    const { updatedEntity, editingEntityLocation, currentXml, scoreData, getExpectedVoices } = params;
    const { measureIndex, staveIndex, xmlVoice, entityIndex } = editingEntityLocation;

    try {
        const xmlDoc = parseXml(currentXml);
        const divisionsEl = xmlDoc.querySelector('attributes divisions');
        const divisions = divisionsEl?.textContent ? parseInt(divisionsEl.textContent, 10) : 1;

        const measureNumber = measureIndex + 1;
        const staffNumber = staveIndex + 1;
        const voiceNum = xmlVoice;

        const measureEl = xmlDoc.querySelector(`measure[number="${measureNumber}"]`);
        if (!measureEl) return { success: false };

        const entityGroups = getEntityGroupsFromMeasure(measureEl, staffNumber, voiceNum);
        const targetGroup = entityGroups[entityIndex];
        if (!targetGroup || targetGroup.elements.length === 0) return { success: false };

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
        const newParser = new MusicXMLParser(newXml, { expectedVoices: getExpectedVoices(scoreData) });

        return {
            success: true,
            newXml,
            newScoreData: newParser.parse(),
        };
    } catch (error) {
        console.error('Failed to update entity:', error);
        return { success: false };
    }
}
