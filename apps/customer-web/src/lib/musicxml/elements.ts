/**
 * MusicXML Element Operations
 * 
 * Element creation, update, and lookup helpers.
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
 * Options for updating one MusicXML note element.
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
 * Updates the contents of one MusicXML `note` element.
 *
 * This low-level helper keeps pitch, duration, dotted state, accidental, stem,
 * fingering, and chord membership in sync for a single note element.
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
 * Creates a new MusicXML `note` element from a pitch string.
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
 * Finds note elements by UI entity location.
 *
 * @param xmlDoc XML document.
 * @param measureIndex 0-based measure index.
 * @param staveIndex 0-based staff index, converted to MusicXML's 1-based staff number.
 * @param xmlVoice MusicXML voice number.
 * @param entityIndex UI entity index within the resolved voice.
 * @returns Matching note elements; chords return multiple elements.
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

    // Resolve the same entity groups used by the parser and editor.
    const entityGroups = getEntityGroupsFromMeasure(measureEl, staffNumber, xmlVoice);
    const targetGroup = entityGroups[entityIndex];

    if (!targetGroup) return [];
    return targetGroup.elements;
}
