/**
 * MusicXML Core Utilities
 * 
 * Parsing, serialization, pitch, duration, and entity grouping helpers.
 * 
 * @module lib/musicxml-core
 */

// ============================================================================
// Constants
// ============================================================================

/** Duration type to MusicXML divisions mapping (assuming divisions=1) */
export const DURATION_MAP: Record<string, number> = {
    durationWhole: 4,
    durationHalf: 2,
    durationQuarter: 1,
    durationEighth: 0.5,
    duration16th: 0.25,
    duration32nd: 0.125,
};

/** Duration type to MusicXML <type> element value mapping */
export const DURATION_TYPE_MAP: Record<string, string> = {
    durationWhole: 'whole',
    durationHalf: 'half',
    durationQuarter: 'quarter',
    durationEighth: 'eighth',
    duration16th: '16th',
    duration32nd: '32nd',
};

// ============================================================================
// XML Parsing and Serialization
// ============================================================================

/**
 * Serialize XMLDocument back to string (with pretty-print formatting)
 */
export function serializeXml(xmlDoc: XMLDocument): string {
    const raw = new XMLSerializer().serializeToString(xmlDoc);
    return formatXml(raw);
}

/**
 * Formats an XML string with stable indentation.
 * 
 * XMLSerializer does not preserve indentation for inserted or modified nodes,
 * so this normalizes serialized output for readable saved MusicXML files.
 */
function formatXml(xml: string): string {
    // Preserve an existing XML declaration such as <?xml version="1.0" ...?>.
    const xmlDeclMatch = xml.match(/^(<\?xml[^?]*\?>)\s*/);
    const xmlDecl = xmlDeclMatch ? xmlDeclMatch[1] : '';
    const body = xmlDeclMatch ? xml.slice(xmlDeclMatch[0].length) : xml;

    // Insert line breaks only between adjacent tags.
    const formatted = body
        .replace(/>\s*</g, '>\n<')
        .split('\n');

    const indent = '  ';
    let level = 0;
    const result: string[] = [];

    for (const rawLine of formatted) {
        const line = rawLine.trim();
        if (!line) continue;

        // Preserve pure text lines as-is.
        if (!line.startsWith('<')) {
            result.push(line);
            continue;
        }

        // Self-closing tag: keep the current nesting level.
        if (line.match(/^<[^/!][^>]*\/>\s*$/)) {
            result.push(indent.repeat(level) + line);
        }
        // Closing tag: decrease the nesting level before writing.
        else if (line.startsWith('</')) {
            level = Math.max(0, level - 1);
            result.push(indent.repeat(level) + line);
        }
        // Inline text element such as <tag>text</tag>.
        else if (line.match(/^<[^/!][^>]*>[^<]*<\/[^>]+>$/)) {
            result.push(indent.repeat(level) + line);
        }
        // DOCTYPE / comment
        else if (line.startsWith('<!')) {
            result.push(indent.repeat(level) + line);
        }
        // Opening tag: write at the current level, then increase nesting.
        else if (line.match(/^<[^/!?][^>]*[^/]>$/)) {
            result.push(indent.repeat(level) + line);
            level++;
        }
        // Fallback for declarations or unusual XML fragments.
        else {
            result.push(indent.repeat(level) + line);
        }
    }

    return (xmlDecl ? xmlDecl + '\n' : '') + result.join('\n') + '\n';
}

/**
 * Parse XML string to XMLDocument
 */
export function parseXml(xmlString: string): XMLDocument {
    const parser = new DOMParser();
    return parser.parseFromString(xmlString, 'application/xml');
}

/**
 * Get the divisions value from the XML document
 */
export function getDivisions(xmlDoc: XMLDocument): number {
    const divisionsEl = xmlDoc.querySelector('attributes divisions');
    if (divisionsEl?.textContent) {
        return parseInt(divisionsEl.textContent, 10) || 1;
    }
    return 1;
}

// ============================================================================
// Pitch and Duration Helpers
// ============================================================================

/**
 * Parse a pitch string like "C4" or "C#5" into step, alter, and octave
 */
export function parsePitchString(pitchString: string): { step: string; alter: number; octave: number } {
    const match = pitchString.match(/^([A-Ga-g])([#b]*)(\d)$/);
    if (!match) {
        return { step: 'C', alter: 0, octave: 4 };
    }

    const step = match[1].toUpperCase();
    const accidentals = match[2];
    const octave = parseInt(match[3], 10);

    let alter = 0;
    if (accidentals) {
        for (const char of accidentals) {
            if (char === '#') alter += 1;
            if (char === 'b') alter -= 1;
        }
    }

    return { step, alter, octave };
}

/**
 * Get MusicXML duration value from duration type string
 */
export function getDurationValue(durationType: string, divisions: number = 1): number {
    const baseDuration = DURATION_MAP[durationType] ?? 1;
    return baseDuration * divisions;
}

export function getEffectiveDurationValue(
    durationType: string,
    divisions: number = 1,
    dotted: boolean = false
): number {
    return Math.round(getDurationValue(durationType, divisions) * (dotted ? 1.5 : 1));
}

/**
 * Get MusicXML <type> element value from duration type string
 */
export function getDurationTypeName(durationType: string): string {
    return DURATION_TYPE_MAP[durationType] ?? 'quarter';
}

// ============================================================================
// Entity Group Utilities
// ============================================================================

/**
 * Entity groups map MusicXML note/forward elements to one UI score entity.
 * A group may represent a note, chord, rest, or blank forward entity.
 */
export type EntityGroup = {
    /** UI entity type represented by this group. */
    type: 'note' | 'chord' | 'rest' | 'forward';
    /** XML elements in this group; chords may contain multiple note elements. */
    elements: Element[];
};

/**
 * Returns all UI entity groups for a staff/voice within one measure.
 * 
 * This mirrors `MusicXMLParser.parseMeasures` so returned array indexes match
 * UI `entityIndex` values:
 * - iterate `note` and `forward` elements in document order;
 * - group chord members with their root note;
 * - represent matching `forward` elements as blank UI entities.
 *
 * @param measureEl Measure element.
 * @param staffNumber 1-based MusicXML staff number.
 * @param voiceNum 1-based MusicXML voice number.
 * @returns Entity groups for the requested staff/voice.
 */
export function getEntityGroupsFromMeasure(
    measureEl: Element,
    staffNumber: number,
    voiceNum: number
): EntityGroup[] {
    const entityGroups: EntityGroup[] = [];
    let currentNoteGroup: Element[] = [];
    let currentGroupType: 'note' | 'chord' | 'rest' = 'note';

    const children = Array.from(measureEl.childNodes);

    for (const node of children) {
        if (node.nodeType !== 1) continue;
        const element = node as Element;

        if (element.tagName === 'forward') {
            // MusicXML forward elements may omit staff; use the caller staff in that case.
            const staffEl = element.querySelector('staff');
            const voiceEl = element.querySelector('voice');
            const staff = staffEl ? parseInt(staffEl.textContent || '1', 10) : staffNumber;
            const voice = voiceEl ? parseInt(voiceEl.textContent || '1', 10) : 1;

            if (staff === staffNumber && voice === voiceNum) {
                // Flush the previous note group before adding a forward entity.
                if (currentNoteGroup.length > 0) {
                    entityGroups.push({
                        type: currentNoteGroup.length > 1 ? 'chord' : currentGroupType,
                        elements: currentNoteGroup
                    });
                    currentNoteGroup = [];
                }
                // A matching forward element is exposed as its own blank entity.
                entityGroups.push({
                    type: 'forward',
                    elements: [element]
                });
            }
        } else if (element.tagName === 'note') {
            const staffEl = element.querySelector('staff');
            const voiceEl = element.querySelector('voice');
            const staff = staffEl ? parseInt(staffEl.textContent || '1', 10) : 1;
            const voice = voiceEl ? parseInt(voiceEl.textContent || '1', 10) : 1;

            if (staff === staffNumber && voice === voiceNum) {
                const isChordMember = element.querySelector('chord') !== null;
                const isRest = element.querySelector('rest') !== null;

                if (isChordMember && currentNoteGroup.length > 0) {
                    // Chord members join the current root-note group.
                    currentNoteGroup.push(element);
                } else {
                    // A new root note starts a new group after flushing the previous one.
                    if (currentNoteGroup.length > 0) {
                        entityGroups.push({
                            type: currentNoteGroup.length > 1 ? 'chord' : currentGroupType,
                            elements: currentNoteGroup
                        });
                    }
                    currentNoteGroup = [element];
                    currentGroupType = isRest ? 'rest' : 'note';
                }
            }
        }
    }

    // Flush the final note group.
    if (currentNoteGroup.length > 0) {
        entityGroups.push({
            type: currentNoteGroup.length > 1 ? 'chord' : currentGroupType,
            elements: currentNoteGroup
        });
    }

    return entityGroups;
}
