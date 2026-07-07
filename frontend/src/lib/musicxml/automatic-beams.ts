/** Deterministic, notation-aware MusicXML beam rebuilding. */

import { getDivisions, getEntityGroupsFromMeasure } from './core';
import { parseNotatedDuration } from './notated-duration';

type BeamType = 'begin' | 'continue' | 'end' | 'forward hook' | 'backward hook';
type VoiceKey = { staff: number; voice: number };
type BeamCandidate = {
  elements: Element[];
  startTick: number;
  duration: number;
  beamLevel: number;
};

function directText(element: Element, selector: string): string | null {
  return element.querySelector(selector)?.textContent?.trim() || null;
}

function directInt(element: Element, selector: string, fallback: number): number {
  const parsed = Number.parseInt(directText(element, selector) ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function removeBeamElements(note: Element): void {
  note.querySelectorAll(':scope > beam').forEach((beam) => beam.remove());
}

function addBeamElement(
  xmlDoc: XMLDocument,
  note: Element,
  level: number,
  type: BeamType
): void {
  const beam = xmlDoc.createElement('beam');
  beam.setAttribute('number', String(level));
  beam.textContent = type;
  const existingBeams = Array.from(note.querySelectorAll(':scope > beam'));
  const lastBeam = existingBeams.at(-1);
  const staff = note.querySelector(':scope > staff');
  if (lastBeam) lastBeam.after(beam);
  else if (staff) staff.after(beam);
  else note.appendChild(beam);
}

function parseAdditiveBeats(text: string): number[] {
  const groups = text.split('+').map((part) => Number.parseInt(part.trim(), 10));
  return groups.length > 0 && groups.every((value) => Number.isFinite(value) && value > 0)
    ? groups
    : [];
}

function defaultNumeratorGroups(beats: number, beatType: number): number[] {
  if (beatType === 8) {
    if (beats === 3) return [3];
    if (beats > 3 && beats % 3 === 0) return Array.from({ length: beats / 3 }, () => 3);
    if (beats === 5) return [2, 3];
    if (beats === 7) return [2, 2, 3];
    if (beats === 8) return [3, 3, 2];
  }
  return Array.from({ length: beats }, () => 1);
}

function getBeatGroupTicks(xmlDoc: XMLDocument, measure: Element, divisions: number): number[] {
  let beatsText = '4';
  let beatType = 4;
  for (const candidate of Array.from(xmlDoc.querySelectorAll('part > measure'))) {
    const time = candidate.querySelector('attributes > time');
    const nextBeats = time?.querySelector(':scope > beats')?.textContent?.trim();
    const nextBeatType = Number.parseInt(time?.querySelector(':scope > beat-type')?.textContent ?? '', 10);
    if (nextBeats) beatsText = nextBeats;
    if (Number.isFinite(nextBeatType) && nextBeatType > 0) beatType = nextBeatType;
    if (candidate === measure) break;
  }

  const explicitGroups = parseAdditiveBeats(beatsText);
  const beats = explicitGroups.reduce((sum, value) => sum + value, 0) || 4;
  const numeratorGroups = beatsText.includes('+')
    ? explicitGroups
    : defaultNumeratorGroups(beats, beatType);
  const unitTicks = divisions * (4 / beatType);
  return numeratorGroups.map((group) => Math.max(1, Math.round(group * unitTicks)));
}

function getGroupIndex(startTick: number, endTick: number, groupTicks: number[]): number | null {
  let boundary = 0;
  for (let index = 0; index < groupTicks.length; index += 1) {
    const nextBoundary = boundary + groupTicks[index];
    if (startTick >= boundary && startTick < nextBoundary) {
      return endTick <= nextBoundary ? index : null;
    }
    boundary = nextBoundary;
  }
  return null;
}

function discoverMeasureVoices(measure: Element): VoiceKey[] {
  const keys = new Map<string, VoiceKey>();
  measure.querySelectorAll(':scope > note, :scope > forward').forEach((element) => {
    const staff = directInt(element, ':scope > staff', 1);
    const voice = directInt(element, ':scope > voice', 1);
    keys.set(`${staff}-${voice}`, { staff, voice });
  });
  return [...keys.values()].sort((a, b) => a.staff - b.staff || a.voice - b.voice);
}

function isProtectedVoice(
  groups: ReturnType<typeof getEntityGroupsFromMeasure>,
  divisions: number
): boolean {
  return groups.some((group) => group.elements.some((note) => (
    Boolean(note.querySelector(':scope > grace, :scope > cue'))
    || Boolean(note.querySelector(':scope > beam[fan]'))
    || note.querySelectorAll(':scope > notations > tuplet').length > 1
    || (
      Boolean(note.querySelector(':scope > time-modification'))
      && parseNotatedDuration(note, divisions).tupletRatio === null
    )
    || (
      !note.querySelector(':scope > type')
      && parseNotatedDuration(note, divisions).beamLevel === 0
      && Boolean(note.querySelector(':scope > beam'))
    )
  )));
}

function hasCrossStaffBeam(measure: Element, voice: number): boolean {
  const notes = Array.from(measure.querySelectorAll(':scope > note')).filter((note) => (
    directInt(note, ':scope > voice', 1) === voice
  ));
  const staves = new Set(notes.map((note) => directInt(note, ':scope > staff', 1)));
  return staves.size > 1 && notes.some((note) => Boolean(note.querySelector(':scope > beam')));
}

function getPickupOffset(measure: Element, groups: ReturnType<typeof getEntityGroupsFromMeasure>, groupTicks: number[]): number {
  if (measure.getAttribute('implicit') !== 'yes') return 0;
  const expected = groupTicks.reduce((sum, ticks) => sum + ticks, 0);
  const actual = groups.reduce((sum, group) => {
    const first = group.elements[0];
    return sum + directInt(first, ':scope > duration', 0);
  }, 0);
  return actual > 0 && actual < expected ? expected - actual : 0;
}

function writeBeamLevel(
  xmlDoc: XMLDocument,
  group: BeamCandidate[],
  level: number
): void {
  let index = 0;
  while (index < group.length) {
    if (group[index].beamLevel < level) {
      index += 1;
      continue;
    }
    const start = index;
    while (index < group.length && group[index].beamLevel >= level) index += 1;
    const run = group.slice(start, index);
    if (run.length === 1) {
      const hook: BeamType = start === 0 ? 'forward hook' : 'backward hook';
      run[0].elements.forEach((note) => addBeamElement(xmlDoc, note, level, hook));
      continue;
    }
    run.forEach((candidate, runIndex) => {
      const type: BeamType = runIndex === 0
        ? 'begin'
        : runIndex === run.length - 1 ? 'end' : 'continue';
      candidate.elements.forEach((note) => addBeamElement(xmlDoc, note, level, type));
    });
  }
}

function writeBeamGroup(xmlDoc: XMLDocument, group: BeamCandidate[]): void {
  if (group.length < 2) return;
  const maxLevel = Math.max(...group.map((candidate) => candidate.beamLevel));
  for (let level = 1; level <= maxLevel; level += 1) writeBeamLevel(xmlDoc, group, level);
}

function rebuildVoiceBeams(
  xmlDoc: XMLDocument,
  measure: Element,
  voice: VoiceKey,
  divisions: number,
  groupTicks: number[]
): void {
  const entityGroups = getEntityGroupsFromMeasure(measure, voice.staff, voice.voice);
  if (isProtectedVoice(entityGroups, divisions) || hasCrossStaffBeam(measure, voice.voice)) return;
  entityGroups.forEach((group) => group.elements.forEach(removeBeamElements));

  let cursor = getPickupOffset(measure, entityGroups, groupTicks);
  let bucket: number | null = null;
  let current: BeamCandidate[] = [];
  const flush = () => {
    writeBeamGroup(xmlDoc, current);
    current = [];
    bucket = null;
  };

  entityGroups.forEach((group) => {
    const first = group.elements[0];
    const notation = first ? parseNotatedDuration(first, divisions) : null;
    const duration = notation?.soundingTicks ?? directInt(first, ':scope > duration', 0);
    const startTick = cursor;
    const endTick = startTick + duration;
    const groupIndex = getGroupIndex(startTick, endTick, groupTicks);
    const beamable = group.type !== 'rest'
      && group.type !== 'forward'
      && !first?.querySelector(':scope > rest')
      && Boolean(notation && notation.beamLevel > 0);

    if (!beamable || groupIndex === null) {
      flush();
      cursor = endTick;
      return;
    }
    if (bucket !== null && bucket !== groupIndex) flush();
    bucket = groupIndex;
    current.push({ elements: group.elements, startTick, duration, beamLevel: notation!.beamLevel });
    cursor = endTick;
  });
  flush();
}

export function rebuildAutomaticBeamsForMeasure(xmlDoc: XMLDocument, measure: Element): void {
  const divisions = getDivisions(xmlDoc);
  const groupTicks = getBeatGroupTicks(xmlDoc, measure, divisions);
  discoverMeasureVoices(measure).forEach((voice) => (
    rebuildVoiceBeams(xmlDoc, measure, voice, divisions, groupTicks)
  ));
}

export function rebuildAutomaticBeamsForVoice(
  xmlDoc: XMLDocument,
  measure: Element,
  staff: number,
  voice: number
): void {
  const divisions = getDivisions(xmlDoc);
  rebuildVoiceBeams(
    xmlDoc,
    measure,
    { staff, voice },
    divisions,
    getBeatGroupTicks(xmlDoc, measure, divisions)
  );
}

export function rebuildAutomaticBeams(xmlDoc: XMLDocument): void {
  xmlDoc.querySelectorAll('part > measure').forEach((measure) => (
    rebuildAutomaticBeamsForMeasure(xmlDoc, measure)
  ));
}
