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
import { rebuildAutomaticBeamsForMeasure } from '@/lib/musicxml/automatic-beams';
import { ensureStableMusicXmlIds } from '@/lib/musicxml/stable-ids';

function createForwardElement(xmlDoc: XMLDocument, durationValue: number, voiceNum: number, staffNumber: number): Element {
    const forwardEl = xmlDoc.createElement('forward');
    const durationEl = xmlDoc.createElement('duration');
    durationEl.textContent = String(durationValue);
    forwardEl.appendChild(durationEl);

    const voiceEl = xmlDoc.createElement('voice');
    voiceEl.textContent = String(voiceNum);
    forwardEl.appendChild(voiceEl);

    const staffEl = xmlDoc.createElement('staff');
    staffEl.textContent = String(staffNumber);
    forwardEl.appendChild(staffEl);

    return forwardEl;
}

function createBackupElement(xmlDoc: XMLDocument, durationValue: number): Element {
    const backupEl = xmlDoc.createElement('backup');
    const durationEl = xmlDoc.createElement('duration');
    durationEl.textContent = String(durationValue);
    backupEl.appendChild(durationEl);
    return backupEl;
}

function getMeasureEndCursor(measureEl: Element): number {
    let cursor = 0;

    Array.from(measureEl.children).forEach((element) => {
        const tagName = element.tagName.toLowerCase();

        if (tagName === 'note' || tagName === 'forward') {
            if (tagName === 'note' && element.querySelector('chord')) return;
            const duration = parseInt(element.querySelector('duration')?.textContent || '0', 10);
            cursor += duration;
        } else if (tagName === 'backup') {
            const duration = parseInt(element.querySelector('duration')?.textContent || '0', 10);
            cursor = Math.max(0, cursor - duration);
        }
    });

    return cursor;
}

function appendIntoEmptyVoiceAtTick(
    xmlDoc: XMLDocument,
    measureEl: Element,
    elements: Element[],
    tick: number,
    voiceNum: number,
    staffNumber: number
): void {
    const endCursor = getMeasureEndCursor(measureEl);
    if (endCursor > 0) {
        measureEl.appendChild(createBackupElement(xmlDoc, endCursor));
    }

    if (tick > 0) {
        measureEl.appendChild(createForwardElement(xmlDoc, tick, voiceNum, staffNumber));
    }

    elements.forEach((element) => measureEl.appendChild(element));
}

type CreatedEntityElements = {
    elements: Element[];
    historyLabel: 'addNote' | 'addChord';
};

function createRestElement(
    xmlDoc: XMLDocument,
    duration: string,
    voiceNum: number,
    staffNumber: number,
    divisions: number,
    dotted?: boolean
): Element {
    const noteEl = xmlDoc.createElement('note');
    const restEl = xmlDoc.createElement('rest');
    noteEl.appendChild(restEl);

    const durationEl = xmlDoc.createElement('duration');
    durationEl.textContent = String(getDurationValue(duration, divisions));
    noteEl.appendChild(durationEl);

    const voiceEl = xmlDoc.createElement('voice');
    voiceEl.textContent = String(voiceNum);
    noteEl.appendChild(voiceEl);

    const typeEl = xmlDoc.createElement('type');
    typeEl.textContent = getDurationTypeName(duration);
    noteEl.appendChild(typeEl);

    if (dotted) {
        const dotEl = xmlDoc.createElement('dot');
        noteEl.appendChild(dotEl);
    }

    const staffEl = xmlDoc.createElement('staff');
    staffEl.textContent = String(staffNumber);
    noteEl.appendChild(staffEl);

    return noteEl;
}

function createEntityElements(
    xmlDoc: XMLDocument,
    entity: ScoreEntity,
    voiceNum: number,
    staffNumber: number,
    divisions: number
): CreatedEntityElements | null {
    if (entity.type === 'note') {
        const noteEl = createNoteElementFromPitch(xmlDoc, entity.pitch, entity.duration, voiceNum, staffNumber, divisions, false);
        updateSingleNoteInXml(noteEl, entity.pitch, entity.duration, divisions, false, {
            dotted: entity.dotted,
            stemDirection: entity.stemDirection,
            fingering: entity.fingering,
        });
        return { elements: [noteEl], historyLabel: 'addNote' };
    }

    if (entity.type === 'rest') {
        return {
            elements: [createRestElement(xmlDoc, entity.duration, voiceNum, staffNumber, divisions, entity.dotted)],
            historyLabel: 'addNote',
        };
    }

    if (entity.type === 'blank') {
        return {
            elements: [createForwardElement(xmlDoc, getDurationValue(entity.duration, divisions), voiceNum, staffNumber)],
            historyLabel: 'addNote',
        };
    }

    if (entity.type === 'chord') {
        if (entity.pitches.length === 0) return null;

        const fingerings = entity.fingerings || [];
        const elements = entity.pitches.map((pitch, index) => {
            const isChordMember = index > 0;
            const noteEl = createNoteElementFromPitch(xmlDoc, pitch, entity.duration, voiceNum, staffNumber, divisions, isChordMember);
            updateSingleNoteInXml(noteEl, pitch, entity.duration, divisions, isChordMember, {
                dotted: entity.dotted,
                stemDirection: entity.stemDirection,
                fingering: fingerings[index],
            });
            return noteEl;
        });

        return { elements, historyLabel: 'addChord' };
    }

    return null;
}

function insertElementsAtEntityIndex(
    measureEl: Element,
    elements: Element[],
    entityGroups: ReturnType<typeof getEntityGroupsFromMeasure>,
    insertIndex: number
): void {
    if (entityGroups.length === 0 || insertIndex >= entityGroups.length) {
        elements.forEach((element) => measureEl.appendChild(element));
        return;
    }

    const refElement = entityGroups[insertIndex].elements[0];
    elements.forEach((element) => {
        refElement.parentNode?.insertBefore(element, refElement);
    });
}

function getInsertIndexAtTick(scoreData: ScoreData, location: AddLocation): number {
    const voice = scoreData.measures[location.measureIndex]?.staves[location.staveIndex]?.voices.find((candidate) => {
        const firstEntityVoice = candidate.notes.find((entity) => entity.meta)?.meta?.xmlVoice;
        if (firstEntityVoice) return firstEntityVoice === location.xmlVoice;

        const match = candidate.name.match(/voiceLabel\s*(\d+)/);
        return match ? Number.parseInt(match[1], 10) === location.xmlVoice : false;
    });

    if (!voice || voice.notes.length === 0) return 0;

    const sorted = voice.notes
        .map((entity, entityIndex) => ({
            entityIndex,
            startTick: entity.meta?.startTick ?? 0,
        }))
        .sort((left, right) => left.startTick - right.startTick);

    const nextEntity = sorted.find((item) => location.tick <= item.startTick);
    return nextEntity?.entityIndex ?? voice.notes.length;
}

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
    const { updatedEntity, currentXml, scoreData, getExpectedVoices } = params;
    const location = params.location;

    try {
        const xmlDoc = parseXml(currentXml);
        const divisionsEl = xmlDoc.querySelector('attributes divisions');
        const divisions = divisionsEl?.textContent ? parseInt(divisionsEl.textContent, 10) : 1;

        const measureNumber = location.measureIndex + 1;
        const staffNumber = location.staveIndex + 1;
        const voiceNum = location.xmlVoice;

        const measureEl = xmlDoc.querySelector(`measure[number="${measureNumber}"]`);
        if (!measureEl) return { success: false };

        const created = createEntityElements(xmlDoc, updatedEntity, voiceNum, staffNumber, divisions);
        if (!created) return { success: false };

        const entityGroups = getEntityGroupsFromMeasure(measureEl, staffNumber, voiceNum);
        const insertedIntoEmptyVoice = entityGroups.length === 0;
        if (insertedIntoEmptyVoice) {
            appendIntoEmptyVoiceAtTick(xmlDoc, measureEl, created.elements, location.tick, voiceNum, staffNumber);
        } else {
            const insertIndex = getInsertIndexAtTick(scoreData, location);
            insertElementsAtEntityIndex(measureEl, created.elements, entityGroups, insertIndex);
            recalculateBackups(measureEl);
        }

        rebuildAutomaticBeamsForMeasure(xmlDoc, measureEl);
        ensureStableMusicXmlIds(xmlDoc);

        const newXml = serializeXml(xmlDoc);
        const newParser = new MusicXMLParser(newXml, { expectedVoices: getExpectedVoices(scoreData) });

        return {
            success: true,
            newXml,
            newScoreData: newParser.parse(),
            historyLabel: created.historyLabel,
        };
    } catch (error) {
        console.error('Failed to insert entity:', error);
        return { success: false };
    }
}
