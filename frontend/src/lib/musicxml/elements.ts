/**
 * MusicXML Element Operations
 * 
 * 元素创建和更新函数
 * 
 * @module lib/musicxml-elements
 */

import {
    parsePitchString,
    getDurationValue,
    getEffectiveDurationValue,
    getDurationTypeName,
    getEntityGroupsFromMeasure,
} from './core';
import type { AccidentalValue } from '@/types/score-types';

// ============================================================================
// Types
// ============================================================================

/**
 * UpdateSingleNoteOptions - 更新单个音符的选项
 */
export type UpdateSingleNoteOptions = {
    dotted?: boolean;
    stemDirection?: string;
    fingering?: string;
    accidental?: AccidentalValue | null;
};

// ============================================================================
// Element Update Functions
// ============================================================================

/**
 * 更新 XML 中单个 note 元素的内容
 * 这是一个底层函数，用于更新音符的所有属性
 */
export function updateSingleNoteInXml(
    noteEl: Element,
    pitchStr: string,
    duration: string,
    divisions: number,
    isChordMember: boolean,
    options?: UpdateSingleNoteOptions
): void {
    const xmlDoc = noteEl.ownerDocument;

    // Remove rest if present
    const restEl = noteEl.querySelector('rest');
    if (restEl) restEl.remove();

    // Parse pitch using existing parsePitchString function
    const pitchData = parsePitchString(pitchStr);
    const { step, alter, octave } = pitchData;

    // Update or create pitch element
    let pitchEl = noteEl.querySelector('pitch');
    if (!pitchEl) {
        pitchEl = xmlDoc.createElement('pitch');
        const chordEl = noteEl.querySelector('chord');
        if (chordEl) {
            chordEl.after(pitchEl);
        } else {
            noteEl.insertBefore(pitchEl, noteEl.firstChild);
        }
    }

    let stepEl = pitchEl.querySelector('step');
    if (!stepEl) {
        stepEl = xmlDoc.createElement('step');
        pitchEl.appendChild(stepEl);
    }
    stepEl.textContent = step;

    let alterEl = pitchEl.querySelector('alter');
    if (alter !== 0) {
        if (!alterEl) {
            alterEl = xmlDoc.createElement('alter');
            const octaveEl = pitchEl.querySelector('octave');
            if (octaveEl) {
                pitchEl.insertBefore(alterEl, octaveEl);
            } else {
                pitchEl.appendChild(alterEl);
            }
        }
        alterEl.textContent = String(alter);
    } else if (alterEl) {
        alterEl.remove();
    }

    let octaveEl = pitchEl.querySelector('octave');
    if (!octaveEl) {
        octaveEl = xmlDoc.createElement('octave');
        pitchEl.appendChild(octaveEl);
    }
    octaveEl.textContent = String(octave);

    // Handle chord element
    if (isChordMember && !noteEl.querySelector('chord')) {
        const chordEl = xmlDoc.createElement('chord');
        noteEl.insertBefore(chordEl, noteEl.firstChild);
    } else if (!isChordMember) {
        const chordEl = noteEl.querySelector('chord');
        if (chordEl) chordEl.remove();
    }

    // Update duration
    const durationEl = noteEl.querySelector('duration');
    const dotted = options?.dotted ?? Boolean(noteEl.querySelector(':scope > dot'));
    if (durationEl) {
        durationEl.textContent = String(getEffectiveDurationValue(duration, divisions, dotted));
    }

    let typeEl = noteEl.querySelector('type');
    if (typeEl) {
        typeEl.textContent = getDurationTypeName(duration);
    } else {
        typeEl = xmlDoc.createElement('type');
        typeEl.textContent = getDurationTypeName(duration);
        const voiceEl = noteEl.querySelector('voice');
        if (voiceEl) voiceEl.after(typeEl);
        else if (durationEl) durationEl.after(typeEl);
        else noteEl.appendChild(typeEl);
    }

    // Handle dot element
    if (options?.dotted !== undefined) {
        const existingDot = noteEl.querySelector('dot');
        if (options.dotted && !existingDot) {
            const dotEl = xmlDoc.createElement('dot');
            const typeEl = noteEl.querySelector('type');
            if (typeEl && typeEl.nextSibling) {
                noteEl.insertBefore(dotEl, typeEl.nextSibling);
            } else if (typeEl) {
                typeEl.after(dotEl);
            } else {
                noteEl.appendChild(dotEl);
            }
        } else if (!options.dotted && existingDot) {
            existingDot.remove();
        }
    }

    if (options?.accidental) {
        let accidentalEl = noteEl.querySelector(':scope > accidental');
        if (!accidentalEl) {
            accidentalEl = xmlDoc.createElement('accidental');
            const dots = Array.from(noteEl.querySelectorAll(':scope > dot'));
            const insertAfter = dots.at(-1) || noteEl.querySelector(':scope > type');
            if (insertAfter) insertAfter.after(accidentalEl);
            else noteEl.appendChild(accidentalEl);
        }
        accidentalEl.textContent = options.accidental;
    } else if (options?.accidental === null) {
        noteEl.querySelector(':scope > accidental')?.remove();
    }

    // Handle stem element
    if (options?.stemDirection === 'up' || options?.stemDirection === 'down') {
        let stemEl = noteEl.querySelector('stem');
        if (!stemEl) {
            stemEl = xmlDoc.createElement('stem');
            const typeEl = noteEl.querySelector('type');
            const dotEl = noteEl.querySelector('dot');
            const insertAfter = dotEl || typeEl;
            if (insertAfter && insertAfter.nextSibling) {
                noteEl.insertBefore(stemEl, insertAfter.nextSibling);
            } else if (insertAfter) {
                insertAfter.after(stemEl);
            } else {
                noteEl.appendChild(stemEl);
            }
        }
        stemEl.textContent = options.stemDirection;
    } else if (options?.stemDirection === 'none') {
        const stemEl = noteEl.querySelector('stem');
        if (stemEl) stemEl.remove();
    }
    // Handle fingering element
    if (options?.fingering && /^[1-5]$/.test(options.fingering)) {
        let notationsEl = noteEl.querySelector('notations');
        if (!notationsEl) {
            notationsEl = xmlDoc.createElement('notations');
            noteEl.appendChild(notationsEl);
        }
        let technicalEl = notationsEl.querySelector('technical');
        if (!technicalEl) {
            technicalEl = xmlDoc.createElement('technical');
            notationsEl.appendChild(technicalEl);
        }
        let fingeringEl = technicalEl.querySelector('fingering');
        if (!fingeringEl) {
            fingeringEl = xmlDoc.createElement('fingering');
            technicalEl.appendChild(fingeringEl);
        }
        fingeringEl.textContent = options.fingering;
    } else if (options?.fingering === 'none' || options?.fingering === '') {
        const fingeringEl = noteEl.querySelector('notations > technical > fingering');
        if (fingeringEl) {
            const technicalEl = fingeringEl.parentElement;
            fingeringEl.remove();
            if (technicalEl && technicalEl.children.length === 0) {
                const notationsEl = technicalEl.parentElement;
                technicalEl.remove();
                if (notationsEl && notationsEl.children.length === 0) {
                    notationsEl.remove();
                }
            }
        }
    }
}

// ============================================================================
// Element Creation Functions
// ============================================================================

/**
 * 从 pitch 字符串创建一个新的 note 元素
 */
export function createNoteElementFromPitch(
    xmlDoc: XMLDocument,
    pitchStr: string,
    duration: string,
    voice: number,
    staff: number,
    divisions: number,
    isChordMember: boolean
): Element {
    const noteEl = xmlDoc.createElement('note');

    if (isChordMember) {
        const chordEl = xmlDoc.createElement('chord');
        noteEl.appendChild(chordEl);
    }

    // Parse pitch using existing function
    const pitchData = parsePitchString(pitchStr);
    const { step, alter, octave } = pitchData;

    const pitchEl = xmlDoc.createElement('pitch');
    const stepEl = xmlDoc.createElement('step');
    stepEl.textContent = step;
    pitchEl.appendChild(stepEl);

    if (alter !== 0) {
        const alterEl = xmlDoc.createElement('alter');
        alterEl.textContent = String(alter);
        pitchEl.appendChild(alterEl);
    }

    const octaveEl = xmlDoc.createElement('octave');
    octaveEl.textContent = String(octave);
    pitchEl.appendChild(octaveEl);

    noteEl.appendChild(pitchEl);

    const durationEl = xmlDoc.createElement('duration');
    durationEl.textContent = String(getDurationValue(duration, divisions));
    noteEl.appendChild(durationEl);

    const voiceEl = xmlDoc.createElement('voice');
    voiceEl.textContent = String(voice);
    noteEl.appendChild(voiceEl);

    const typeEl = xmlDoc.createElement('type');
    typeEl.textContent = getDurationTypeName(duration);
    noteEl.appendChild(typeEl);

    const staffEl = xmlDoc.createElement('staff');
    staffEl.textContent = String(staff);
    noteEl.appendChild(staffEl);

    return noteEl;
}

// ============================================================================
// Element Finding Functions
// ============================================================================

/**
 * 根据位置信息查找 XML 中的 note 元素
 * @param xmlDoc XML 文档
 * @param measureIndex 小节索引 (0-based)
 * @param staveIndex 谱表索引 (0-based, 转换为 staff 1-based)
 * @param xmlVoice XML 声部号 (来自 MusicXML)
 * @param entityIndex 实体索引
 * @returns 找到的所有 note 元素（和弦会返回多个）
 */
export function findNoteElementsByMeta(
    xmlDoc: XMLDocument,
    measureIndex: number,
    staveIndex: number,
    xmlVoice: number,
    entityIndex: number
): Element[] {
    const measureNumber = measureIndex + 1;
    const staffNumber = staveIndex + 1;

    const measureEl = xmlDoc.querySelector(`measure[number="${measureNumber}"]`);
    if (!measureEl) return [];

    // 使用 getEntityGroupsFromMeasure 获取实体组
    const entityGroups = getEntityGroupsFromMeasure(measureEl, staffNumber, xmlVoice);
    const targetGroup = entityGroups[entityIndex];

    if (!targetGroup) return [];
    return targetGroup.elements;
}
