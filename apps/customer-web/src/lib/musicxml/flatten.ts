/**
 * MusicXML voice normalization utilities.
 *
 * Normalizes each staff to a single MusicXML voice while preserving staff
 * identity:
 * - treble staff voices -> voice=1
 * - bass staff voices -> voice=1
 */

import { parseXml, serializeXml } from './core';

/**
 * Note timeline metadata used while rebuilding one measure.
 */
type NoteInfo = {
    absoluteTime: number;
    note: Element;
    duration: number;
    isChord: boolean;
    originalVoice: number;
    originalIndex: number;
};

/**
 * Root note plus any MusicXML chord-member notes that follow it.
 */
type ChordGroup = {
    mainNote: NoteInfo;
    chordMembers: NoteInfo[];
};

/**
 * Returns an element's MusicXML duration value.
 */
function getDuration(node: Element): number {
    const durationEl = node.querySelector('duration');
    return durationEl ? parseInt(durationEl.textContent || '0', 10) : 0;
}

/**
 * Returns an element's MusicXML staff number.
 */
function getStaff(node: Element): number {
    const staffEl = node.querySelector('staff');
    return staffEl ? parseInt(staffEl.textContent || '1', 10) : 1;
}

/**
 * Returns an element's MusicXML voice number.
 */
function getVoice(node: Element): number {
    const voiceEl = node.querySelector('voice');
    return voiceEl ? parseInt(voiceEl.textContent || '1', 10) : 1;
}

/**
 * Returns whether a note is a MusicXML chord member.
 */
function isChordMember(node: Element): boolean {
    return !!node.querySelector('chord');
}

/**
 * Returns whether a note is a grace note.
 */
function isGrace(node: Element): boolean {
    return !!node.querySelector('grace');
}

/**
 * Normalizes all voices in one measure.
 */
function normalizeSingleMeasureVoices(xmlDoc: XMLDocument, measureEl: Element): void {

    // Group note elements by staff.
    const notesByStaff = new Map<number, NoteInfo[]>();

    // Per-voice timeline cursors.
    const voiceCursors = new Map<number, number>();
    const getVC = (v: number): number => voiceCursors.get(v) ?? 0;
    const setVC = (v: number, pos: number): void => { voiceCursors.set(v, pos); };

    const ensureList = (staff: number): NoteInfo[] => {
        if (!notesByStaff.has(staff)) notesByStaff.set(staff, []);
        return notesByStaff.get(staff)!;
    };

    // Walk every direct child in the measure.
    const children = Array.from(measureEl.childNodes);
    let currentProcessingVoice: number | null = null;

    for (let i = 0; i < children.length; i++) {
        const node = children[i];
        if (node.nodeType !== 1) continue;
        const element = node as Element;
        const tag = element.tagName;

        if (tag === 'note') {
            const staff = getStaff(element);
            const voice = getVoice(element);
            const duration = isGrace(element) ? 0 : getDuration(element);
            const isChord = isChordMember(element);
            currentProcessingVoice = voice;
            const absoluteTime = getVC(voice);

            // Clone the note and normalize its voice value.
            const copy = element.cloneNode(true) as Element;
            let voiceEl = copy.querySelector('voice');
            if (!voiceEl) {
                voiceEl = xmlDoc.createElement('voice');
                copy.appendChild(voiceEl);
            }
            // Each staff is normalized to voice=1; staff still preserves treble/bass identity.
            voiceEl.textContent = '1';

            ensureList(staff).push({
                absoluteTime,
                note: copy,
                duration,
                isChord,
                originalVoice: voice,
                originalIndex: i
            });

            if (!isChord) {
                setVC(voice, absoluteTime + duration);
            }

        } else if (tag === 'forward' || tag === 'backup') {
            const amt = getDuration(element);
            const voiceEl = element.querySelector('voice');

            if (voiceEl) {
                const voice = parseInt(voiceEl.textContent || '1', 10);
                const pos = getVC(voice);
                if (tag === 'forward') {
                    setVC(voice, pos + amt);
                } else {
                    const newPos = Math.max(0, pos - amt);
                    setVC(voice, newPos);
                }
            } else {
                // Infer the target voice for forward/backup elements that omit voice.
                let targetVoice = currentProcessingVoice;
                if (targetVoice === null) {
                    for (let j = i + 1; j < children.length; j++) {
                        const next = children[j];
                        if (next.nodeType === 1 && (next as Element).tagName === 'note') {
                            targetVoice = getVoice(next as Element);
                            break;
                        }
                    }
                }

                if (targetVoice !== null) {
                    const pos = getVC(targetVoice);
                    if (tag === 'forward') {
                        setVC(targetVoice, pos + amt);
                    } else {
                        const newPos = Math.max(0, pos - amt);
                        setVC(targetVoice, newPos);
                    }
                }
            }
        }
    }

    // Remove existing timeline-bearing elements before rebuilding the measure.
    Array.from(measureEl.querySelectorAll('note, backup, forward')).forEach(el => el.remove());

    // Reinsert notes staff by staff.
    const staffs = Array.from(notesByStaff.keys()).sort((a, b) => a - b);

    for (let staffIdx = 0; staffIdx < staffs.length; staffIdx++) {
        const staff = staffs[staffIdx];
        const notes = notesByStaff.get(staff)!;

        // Preserve original document order within each staff before grouping.
        notes.sort((a, b) => a.originalIndex - b.originalIndex);

        // Group chord members with their root note.
        const chordGroups: ChordGroup[] = [];
        let currentGroup: ChordGroup | null = null;

        for (const noteInfo of notes) {
            if (noteInfo.isChord) {
                if (currentGroup) {
                    currentGroup.chordMembers.push(noteInfo);
                } else {
                    // Convert an orphan chord member to a root note.
                    noteInfo.isChord = false;
                    const chordEl = noteInfo.note.querySelector('chord');
                    if (chordEl) chordEl.remove();
                    currentGroup = { mainNote: noteInfo, chordMembers: [] };
                    chordGroups.push(currentGroup);
                }
            } else {
                currentGroup = { mainNote: noteInfo, chordMembers: [] };
                chordGroups.push(currentGroup);
            }
        }

        // Sort by timeline position.
        chordGroups.sort((a, b) => {
            if (a.mainNote.absoluteTime !== b.mainNote.absoluteTime) {
                return a.mainNote.absoluteTime - b.mainNote.absoluteTime;
            }
            return a.mainNote.originalIndex - b.mainNote.originalIndex;
        });

        // Write rebuilt note groups.
        let writeCursor = 0;
        const targetVoice = 1;

        for (const group of chordGroups) {
            const startTime = group.mainNote.absoluteTime;

            // Insert a forward element when there is a gap before the next note.
            if (startTime > writeCursor) {
                const gap = startTime - writeCursor;
                const forward = xmlDoc.createElement('forward');
                const duration = xmlDoc.createElement('duration');
                duration.textContent = String(gap);
                forward.appendChild(duration);

                const staffEl = xmlDoc.createElement('staff');
                staffEl.textContent = String(staff);
                forward.appendChild(staffEl);

                const voiceEl = xmlDoc.createElement('voice');
                voiceEl.textContent = String(targetVoice);
                forward.appendChild(voiceEl);

                measureEl.appendChild(forward);
                writeCursor = startTime;
            }

            // Write the root note.
            measureEl.appendChild(group.mainNote.note);
            writeCursor += group.mainNote.duration;

            // Write chord members immediately after the root note.
            for (const member of group.chordMembers) {
                measureEl.appendChild(member.note);
            }
        }

        // Add a backup between staffs so the next staff starts at time zero.
        if (staffIdx < staffs.length - 1 && writeCursor > 0) {
            const backup = xmlDoc.createElement('backup');
            const duration = xmlDoc.createElement('duration');
            duration.textContent = String(writeCursor);
            backup.appendChild(duration);
            measureEl.appendChild(backup);
        }
    }
}

/**
 * Cleans up normalized MusicXML structure.
 */
function cleanupXMLStructure(xmlDoc: XMLDocument): void {
    // Remove empty forward/backup elements.
    Array.from(xmlDoc.querySelectorAll('forward, backup')).forEach(el => {
        const duration = parseInt(el.querySelector('duration')?.textContent || '0', 10);
        if (duration <= 0) el.remove();
    });

    // Ensure every note has a voice element.
    Array.from(xmlDoc.querySelectorAll('note')).forEach(note => {
        if (!note.querySelector('voice')) {
            const voice = xmlDoc.createElement('voice');
            voice.textContent = '1';
            note.appendChild(voice);
        }
    });

    // Validate chord structure and convert orphan chord members to root notes.
    Array.from(xmlDoc.querySelectorAll('measure')).forEach(measure => {
        const notes = Array.from(measure.querySelectorAll('note'));
        for (let i = 0; i < notes.length; i++) {
            const note = notes[i];
            if (note.querySelector('chord')) {
                let hasMain = false;
                for (let j = i - 1; j >= 0; j--) {
                    const prev = notes[j];
                    if (!prev.querySelector('chord')) {
                        hasMain = true;
                        break;
                    }
                }
                if (!hasMain) {
                    const chordEl = note.querySelector('chord');
                    if (chordEl) chordEl.remove();
                }
            }
        }
    });
}

/**
 * Normalizes voice numbers in every measure.
 *
 * @param xmlString Source XML string.
 * @returns Normalized XML string.
 */
export function normalizeMeasureVoices(xmlString: string): string {
    const xmlDoc = parseXml(xmlString);

    const measures = Array.from(xmlDoc.querySelectorAll('measure'));
    measures.forEach(m => normalizeSingleMeasureVoices(xmlDoc, m));

    // Clean the rebuilt structure.
    cleanupXMLStructure(xmlDoc);

    // Normalize forward/backup children so only duration remains.
    Array.from(xmlDoc.querySelectorAll('forward, backup')).forEach(el => {
        // Remove all attributes.
        if (el.attributes && el.attributes.length) {
            Array.from(el.attributes).forEach(a => el.removeAttribute(a.name));
        }
        // Keep only duration.
        Array.from(el.childNodes).forEach(ch => {
            if (ch.nodeType === 1 && (ch as Element).tagName !== 'duration') {
                el.removeChild(ch);
            }
        });
    });

    return serializeXml(xmlDoc);
}
