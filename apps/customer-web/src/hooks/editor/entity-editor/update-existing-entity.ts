'use client';

/**
 * Pure helper for updating an existing score entity in MusicXML.
 */

import type { ScoreEntity, EntityLocation } from '@/types/score-types';
import type { ScoreData } from '@/types/score-types';
import { MusicXMLParser } from '@/lib/musicxml/parser';
import {
    parseXml,
    serializeXml,
    getEntityGroupsFromMeasure,
    getEffectiveDurationValue,
    getDurationTypeName,
} from '@/lib/musicxml/core';
import {
    updateSingleNoteInXml,
    createNoteElementFromPitch,
} from '@/lib/musicxml/elements';
import { recalculateBackups } from '@/lib/musicxml/backup';
import { repairAutomaticBeamsForVoice } from '@/lib/musicxml/automatic-beams';
import { ensureStableMusicXmlIds } from '@/lib/musicxml/stable-ids';

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

function getRhythmSignature(elements: Element[]): string {
    const notes = elements.filter((element) => element.isConnected);
    const main = notes[0] ?? elements[0];
    if (!main) return 'missing';
    if (main.tagName === 'forward') {
        return JSON.stringify({
            kind: 'forward',
            duration: main.querySelector(':scope > duration')?.textContent?.trim() ?? '',
            members: 1,
        });
    }
    return JSON.stringify({
        kind: main.querySelector(':scope > rest') ? 'rest' : notes.length > 1 ? 'chord' : 'note',
        duration: main.querySelector(':scope > duration')?.textContent?.trim() ?? '',
        type: main.querySelector(':scope > type')?.textContent?.trim() ?? '',
        dots: main.querySelectorAll(':scope > dot').length,
        timeModification: main.querySelector(':scope > time-modification')?.textContent?.trim() ?? '',
        members: notes.length,
    });
}

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
    durationEl.textContent = String(getEffectiveDurationValue(duration, divisions, Boolean(dotted)));
    noteEl.appendChild(durationEl);

    const voiceEl = xmlDoc.createElement('voice');
    voiceEl.textContent = String(voiceNum);
    noteEl.appendChild(voiceEl);

    const typeEl = xmlDoc.createElement('type');
    typeEl.textContent = getDurationTypeName(duration);
    noteEl.appendChild(typeEl);

    if (dotted) {
        noteEl.appendChild(xmlDoc.createElement('dot'));
    }

    const staffEl = xmlDoc.createElement('staff');
    staffEl.textContent = String(staffNumber);
    noteEl.appendChild(staffEl);

    return noteEl;
}

function createReplacementElements(
    xmlDoc: XMLDocument,
    entity: ScoreEntity,
    voiceNum: number,
    staffNumber: number,
    divisions: number
): Element[] {
    if (entity.type === 'blank') {
        return [
            createForwardElement(
                xmlDoc,
                getEffectiveDurationValue(entity.duration, divisions, Boolean(entity.dotted)),
                voiceNum,
                staffNumber
            ),
        ];
    }

    if (entity.type === 'rest') {
        return [createRestElement(xmlDoc, entity.duration, voiceNum, staffNumber, divisions, entity.dotted)];
    }

    if (entity.type === 'note') {
        const noteEl = createNoteElementFromPitch(xmlDoc, entity.pitch, entity.duration, voiceNum, staffNumber, divisions, false);
        updateSingleNoteInXml(noteEl, entity.pitch, entity.duration, divisions, false, {
            dotted: entity.dotted,
            stemDirection: entity.stemDirection,
            fingering: entity.fingering,
            accidental: entity.accidental,
        });
        return [noteEl];
    }

    if (entity.pitches.length === 0) {
        return [];
    }

    const fingerings = entity.fingerings || [];
    const accidentals = entity.accidentals || [];
    return entity.pitches.map((pitch, index) => {
        const isChordMember = index > 0;
        const noteEl = createNoteElementFromPitch(xmlDoc, pitch, entity.duration, voiceNum, staffNumber, divisions, isChordMember);
        updateSingleNoteInXml(noteEl, pitch, entity.duration, divisions, isChordMember, {
            dotted: entity.dotted,
            stemDirection: entity.stemDirection,
            fingering: fingerings[index],
            accidental: accidentals[index],
        });
        return noteEl;
    });
}

function replaceElementWithElements(target: Element, replacements: Element[]): void {
    const parent = target.parentNode;
    if (!parent) return;

    const originalId = target.getAttribute('id');
    if (originalId && replacements[0]) {
        replacements[0].setAttribute('id', originalId);
    }

    replacements.forEach((replacement) => {
        parent.insertBefore(replacement, target);
    });
    parent.removeChild(target);
}

/**
 * Update an existing score entity in a MusicXML document.
 *
 * @returns A result containing the updated XML and parsed score data.
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
        const originalRhythmSignature = getRhythmSignature(targetElements);

        if (targetGroup.type === 'forward') {
            const replacements = createReplacementElements(xmlDoc, updatedEntity, voiceNum, staffNumber, divisions);
            if (replacements.length === 0) return { success: false };

            replaceElementWithElements(targetElements[0], replacements);
            recalculateBackups(measureEl);
            if (updatedEntity.type !== 'blank') {
                repairAutomaticBeamsForVoice(xmlDoc, measureEl, staffNumber, voiceNum);
            }
            ensureStableMusicXmlIds(xmlDoc);

            const newXml = serializeXml(xmlDoc);
            const newParser = new MusicXMLParser(newXml, { expectedVoices: getExpectedVoices(scoreData) });

            return {
                success: true,
                newXml,
                newScoreData: newParser.parse(),
            };
        }

        if (updatedEntity.type === 'chord' && 'pitches' in updatedEntity) {
            const pitches = updatedEntity.pitches;
            const fingerings = updatedEntity.fingerings || [];
            const accidentals = updatedEntity.accidentals || [];

            pitches.forEach((pitchStr, i) => {
                const noteOptions = {
                    dotted: 'dotted' in updatedEntity ? updatedEntity.dotted : undefined,
                    stemDirection: 'stemDirection' in updatedEntity ? updatedEntity.stemDirection : undefined,
                    fingering: fingerings[i] || undefined,
                    accidental: accidentals[i],
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
                mainNote.querySelector('chord')?.remove();
                mainNote.querySelector('stem')?.remove();
                mainNote.querySelector('notations')?.remove();

                let restEl = mainNote.querySelector('rest');
                if (!restEl) {
                    restEl = xmlDoc.createElement('rest');
                    mainNote.insertBefore(restEl, mainNote.firstChild);
                }
                if (updatedEntity.type === 'rest') {
                    restEl.removeAttribute('measure');
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
                    accidental: updatedEntity.accidental,
                };
                updateSingleNoteInXml(mainNote, updatedEntity.pitch, updatedEntity.duration, divisions, false, noteOptions);

                for (let i = 1; i < targetElements.length; i++) {
                    targetElements[i].remove();
                }
            }

            const durationEl = mainNote.querySelector('duration');
            if (durationEl) {
                const dotted = 'dotted' in updatedEntity && Boolean(updatedEntity.dotted);
                durationEl.textContent = String(
                    getEffectiveDurationValue(updatedEntity.duration, divisions, dotted)
                );
            }

            const typeEl = mainNote.querySelector('type');
            if (typeEl) {
                typeEl.textContent = getDurationTypeName(updatedEntity.duration);
            } else if (updatedEntity.type === 'rest') {
                const newTypeEl = xmlDoc.createElement('type');
                newTypeEl.textContent = getDurationTypeName(updatedEntity.duration);
                const voiceEl = mainNote.querySelector('voice');
                const durationEl = mainNote.querySelector('duration');
                if (voiceEl) voiceEl.after(newTypeEl);
                else if (durationEl) durationEl.after(newTypeEl);
                else mainNote.appendChild(newTypeEl);
                const dotEl = mainNote.querySelector('dot');
                if (dotEl) newTypeEl.after(dotEl);
            }
        }

        const updatedGroups = getEntityGroupsFromMeasure(measureEl, staffNumber, voiceNum);
        const updatedRhythmSignature = getRhythmSignature(updatedGroups[entityIndex]?.elements ?? targetElements);
        if (originalRhythmSignature !== updatedRhythmSignature) {
            recalculateBackups(measureEl);
            repairAutomaticBeamsForVoice(xmlDoc, measureEl, staffNumber, voiceNum);
        }
        ensureStableMusicXmlIds(xmlDoc);

        const newXml = serializeXml(xmlDoc);
        const newParser = new MusicXMLParser(newXml, { expectedVoices: getExpectedVoices(scoreData) });

        return {
            success: true,
            newXml,
            newScoreData: newParser.parse(),
        };
    } catch {
        return { success: false };
    }
}
