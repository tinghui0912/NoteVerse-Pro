/**
 * Automatic MusicXML beam rebuilding.
 *
 * Beams are layout-derived for this editor: every structural edit clears stale
 * beams in the affected measure and regenerates them from meter, voice, staff,
 * note duration, rests, and measure boundaries.
 */

import { getDivisions, getEntityGroupsFromMeasure } from './core';

type BeamType = 'begin' | 'continue' | 'end';

type VoiceKey = {
    staff: number;
    voice: number;
};

type BeamCandidate = {
    elements: Element[];
    startTick: number;
    duration: number;
};

function matchesName(element: Element, name: string): boolean {
    return element.localName === name || element.tagName === name || element.tagName.endsWith(`.${name}`);
}

function findDescendant(element: Element, name: string): Element | null {
    const descendants = Array.from(element.getElementsByTagName('*'));
    return descendants.find(child => matchesName(child, name)) ?? null;
}

function getDescendantText(element: Element, name: string): string | null {
    return findDescendant(element, name)?.textContent?.trim() ?? null;
}

function getIntDescendant(element: Element, name: string, fallback: number): number {
    const text = getDescendantText(element, name);
    if (!text) return fallback;
    const parsed = parseInt(text, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function removeBeamElements(noteElement: Element): void {
    Array.from(noteElement.getElementsByTagName('*'))
        .filter(child => matchesName(child, 'beam'))
        .forEach(beam => beam.parentNode?.removeChild(beam));
}

function addBeamElement(xmlDoc: XMLDocument, noteElement: Element, type: BeamType): void {
    const beam = xmlDoc.createElement('beam');
    beam.setAttribute('number', '1');
    beam.textContent = type;

    const staffEl = findDescendant(noteElement, 'staff');
    if (staffEl?.nextSibling) {
        noteElement.insertBefore(beam, staffEl.nextSibling);
    } else if (staffEl) {
        staffEl.after(beam);
    } else {
        noteElement.appendChild(beam);
    }
}

function getMeasureTimeSignature(xmlDoc: XMLDocument, measureEl: Element): { beats: number; beatType: number } {
    let beats = 4;
    let beatType = 4;
    const measures = Array.from(xmlDoc.querySelectorAll('part > measure'));

    for (const measure of measures) {
        const beatsText = measure.querySelector('attributes time beats')?.textContent?.trim();
        const beatTypeText = measure.querySelector('attributes time beat-type')?.textContent?.trim();

        if (beatsText && beatTypeText) {
            const parsedBeats = parseInt(beatsText, 10);
            const parsedBeatType = parseInt(beatTypeText, 10);
            if (Number.isFinite(parsedBeats) && parsedBeats > 0) beats = parsedBeats;
            if (Number.isFinite(parsedBeatType) && parsedBeatType > 0) beatType = parsedBeatType;
        }

        if (measure === measureEl) break;
    }

    return { beats, beatType };
}

function getBeamGroupTicks(xmlDoc: XMLDocument, measureEl: Element, divisions: number): number {
    const { beats, beatType } = getMeasureTimeSignature(xmlDoc, measureEl);

    if (beatType === 8 && beats % 3 === 0) {
        return Math.max(1, divisions * 3 * (4 / beatType));
    }

    return Math.max(1, divisions * (4 / beatType));
}

function getDurationTicks(groupElements: Element[]): number {
    const durationText = getDescendantText(groupElements[0], 'duration');
    if (!durationText) return 0;
    const duration = parseInt(durationText, 10);
    return Number.isFinite(duration) ? duration : 0;
}

function isBeamableGroup(group: { type: string; elements: Element[] }, divisions: number): boolean {
    if (group.type === 'rest' || group.type === 'forward') return false;
    const firstNote = group.elements[0];
    if (!firstNote || findDescendant(firstNote, 'rest')) return false;

    const duration = getDurationTicks(group.elements);
    return duration > 0 && duration < divisions;
}

function discoverMeasureVoices(measureEl: Element): VoiceKey[] {
    const keys = new Map<string, VoiceKey>();

    Array.from(measureEl.childNodes).forEach(node => {
        if (node.nodeType !== 1) return;
        const element = node as Element;
        if (!matchesName(element, 'note') && !matchesName(element, 'forward')) return;

        const staff = getIntDescendant(element, 'staff', 1);
        const voice = getIntDescendant(element, 'voice', 1);
        keys.set(`${staff}-${voice}`, { staff, voice });
    });

    return Array.from(keys.values()).sort((a, b) => a.staff - b.staff || a.voice - b.voice);
}

function writeBeamGroup(xmlDoc: XMLDocument, group: BeamCandidate[]): void {
    if (group.length < 2) return;

    group.forEach((candidate, index) => {
        const beamType = index === 0 ? 'begin' : index === group.length - 1 ? 'end' : 'continue';
        candidate.elements.forEach(noteElement => addBeamElement(xmlDoc, noteElement, beamType));
    });
}

function rebuildVoiceBeams(xmlDoc: XMLDocument, measureEl: Element, voice: VoiceKey, divisions: number, groupTicks: number): void {
    const entityGroups = getEntityGroupsFromMeasure(measureEl, voice.staff, voice.voice);
    entityGroups.forEach(group => group.elements.forEach(removeBeamElements));

    let cursor = 0;
    let currentGroup: BeamCandidate[] = [];
    let currentBucket: number | null = null;

    const flush = () => {
        writeBeamGroup(xmlDoc, currentGroup);
        currentGroup = [];
        currentBucket = null;
    };

    entityGroups.forEach(group => {
        const duration = getDurationTicks(group.elements);
        const startTick = cursor;
        const endTick = startTick + duration;
        const startBucket = Math.floor(startTick / groupTicks);
        const endBucket = Math.floor(Math.max(startTick, endTick - 1) / groupTicks);
        const crossesGroupBoundary = duration > 0 && startBucket !== endBucket;

        if (!isBeamableGroup(group, divisions) || crossesGroupBoundary) {
            flush();
            cursor = endTick;
            return;
        }

        if (currentBucket !== null && currentBucket !== startBucket) {
            flush();
        }

        currentBucket = startBucket;
        currentGroup.push({ elements: group.elements, startTick, duration });
        cursor = endTick;

        if (cursor > 0 && cursor % groupTicks === 0) {
            flush();
        }
    });

    flush();
}

export function rebuildAutomaticBeamsForMeasure(xmlDoc: XMLDocument, measureEl: Element): void {
    const divisions = getDivisions(xmlDoc);
    const groupTicks = getBeamGroupTicks(xmlDoc, measureEl, divisions);
    const voices = discoverMeasureVoices(measureEl);

    voices.forEach(voice => rebuildVoiceBeams(xmlDoc, measureEl, voice, divisions, groupTicks));
}

export function rebuildAutomaticBeams(xmlDoc: XMLDocument): void {
    Array.from(xmlDoc.querySelectorAll('part > measure')).forEach(measureEl => {
        rebuildAutomaticBeamsForMeasure(xmlDoc, measureEl);
    });
}