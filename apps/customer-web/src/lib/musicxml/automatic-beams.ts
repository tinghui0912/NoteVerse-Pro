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
      const root = run[0].elements[0];
      if (root) addBeamElement(xmlDoc, root, level, hook);
      continue;
    }
    run.forEach((candidate, runIndex) => {
      const type: BeamType = runIndex === 0
        ? 'begin'
        : runIndex === run.length - 1 ? 'end' : 'continue';
      const root = candidate.elements[0];
      if (root) addBeamElement(xmlDoc, root, level, type);
    });
  }
}

function writeBeamGroup(xmlDoc: XMLDocument, group: BeamCandidate[]): void {
  if (group.length < 2) return;
  const maxLevel = Math.max(...group.map((candidate) => candidate.beamLevel));
  for (let level = 1; level <= maxLevel; level += 1) writeBeamLevel(xmlDoc, group, level);
}

function beamType(note: Element, level: number): string | null {
  return Array.from(note.querySelectorAll(':scope > beam')).find((beam) => (
    Number.parseInt(beam.getAttribute('number') ?? '1', 10) === level
  ))?.textContent?.trim() ?? null;
}

function removeBeamLevel(note: Element, level: number): void {
  note.querySelectorAll(':scope > beam').forEach((beam) => {
    if (Number.parseInt(beam.getAttribute('number') ?? '1', 10) === level) beam.remove();
  });
}

function normalizeExistingBeamRuns(
  groups: ReturnType<typeof getEntityGroupsFromMeasure>,
  divisions: number
): void {
  const roots = groups.map((group) => group.elements[0]).filter((note): note is Element => Boolean(note));
  groups.forEach((group) => group.elements.slice(1).forEach(removeBeamElements));

  roots.forEach((root) => {
    const maxLevel = parseNotatedDuration(root, divisions).beamLevel;
    root.querySelectorAll(':scope > beam').forEach((beam) => {
      const level = Number.parseInt(beam.getAttribute('number') ?? '1', 10);
      if (level < 1 || level > maxLevel) beam.remove();
    });
  });

  for (let level = 1; level <= 8; level += 1) {
    const normalizeRun = (run: number[]) => {
      if (run.length < 2) {
        run.forEach((item) => removeBeamLevel(roots[item], level));
        return;
      }
      run.forEach((item, runIndex) => {
        removeBeamLevel(roots[item], level);
        addBeamElement(
          roots[item].ownerDocument,
          roots[item],
          level,
          runIndex === 0 ? 'begin' : runIndex === run.length - 1 ? 'end' : 'continue'
        );
      });
    };
    let open: number[] | null = null;
    roots.forEach((root, index) => {
      const type = beamType(root, level);
      if (type === 'begin') {
        if (open) normalizeRun(open);
        open = [index];
      } else if (type === 'continue') {
        if (open) open.push(index);
        else removeBeamLevel(root, level);
      } else if (type === 'end') {
        if (!open) {
          removeBeamLevel(root, level);
          return;
        }
        open.push(index);
        normalizeRun(open);
        open = null;
      } else if (type !== 'forward hook' && type !== 'backward hook' && open) {
        if (parseNotatedDuration(root, divisions).beamLevel >= level) open.push(index);
        else {
          normalizeRun(open);
          open = null;
        }
      }
    });
    if (open) normalizeRun(open);
  }
}

function rebuildVoiceBeams(
  xmlDoc: XMLDocument,
  measure: Element,
  voice: VoiceKey,
  divisions: number,
  groupTicks: number[],
  preserveExisting: boolean = false
): void {
  const entityGroups = getEntityGroupsFromMeasure(measure, voice.staff, voice.voice, {
    includeForwardGroups: true,
  });
  if (isProtectedVoice(entityGroups, divisions) || hasCrossStaffBeam(measure, voice.voice)) return;
  if (preserveExisting) normalizeExistingBeamRuns(entityGroups, divisions);
  else entityGroups.forEach((group) => group.elements.forEach(removeBeamElements));

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
    const hasPreservedBeam = preserveExisting && group.elements.some((note) => (
      Boolean(note.querySelector(':scope > beam'))
    ));

    if (!beamable || groupIndex === null || hasPreservedBeam) {
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

export function repairAutomaticBeamsForVoice(
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
    getBeatGroupTicks(xmlDoc, measure, divisions),
    true
  );
}

export type BeamDirection = 'auto' | 'up' | 'down';

function noteId(note: Element): string | null {
  return note.getAttribute('id');
}

function levelOneRunBounds(roots: Element[], index: number): [number, number] {
  if (!beamType(roots[index], 1)) return [index, index];
  let start = index;
  let end = index;
  while (start > 0 && beamType(roots[start], 1) !== 'begin' && beamType(roots[start - 1], 1)) start -= 1;
  while (end < roots.length - 1 && beamType(roots[end], 1) !== 'end' && beamType(roots[end + 1], 1)) end += 1;
  return [start, end];
}

function findBeamContext(xmlDoc: XMLDocument, entityId: string) {
  const target = Array.from(xmlDoc.querySelectorAll('note')).find((note) => noteId(note) === entityId);
  const measure = target?.closest('measure');
  if (!target || !measure) return null;
  const staff = directInt(target, ':scope > staff', 1);
  const voice = directInt(target, ':scope > voice', 1);
  const groups = getEntityGroupsFromMeasure(measure, staff, voice, {
    includeForwardGroups: true,
  });
  const index = groups.findIndex((group) => group.elements.some((note) => noteId(note) === entityId));
  if (index < 0) return null;
  const roots = groups.map((group) => group.elements[0]).filter((note): note is Element => Boolean(note));
  return { target, measure, groups, index, roots };
}

function setStemDirection(xmlDoc: XMLDocument, note: Element, direction: BeamDirection): void {
  note.querySelector(':scope > stem')?.remove();
  if (direction === 'auto') return;
  const stem = xmlDoc.createElement('stem');
  stem.textContent = direction;
  const anchor = note.querySelector(':scope > dot:last-of-type') || note.querySelector(':scope > type');
  if (anchor) anchor.after(stem);
  else note.appendChild(stem);
}

export function getManualBeamDirectionAtEntity(xmlDoc: XMLDocument, entityId: string): BeamDirection | null {
  const context = findBeamContext(xmlDoc, entityId);
  if (!context) return null;
  const [start, end] = levelOneRunBounds(context.roots, context.index);
  if (start === end) return null;
  const values = context.roots.slice(start, end + 1).map((root) => root.querySelector(':scope > stem')?.textContent?.trim());
  if (values.every((value) => value === 'up')) return 'up';
  if (values.every((value) => value === 'down')) return 'down';
  return 'auto';
}

export function getManualBeamRunSourceIdsAtEntity(xmlDoc: XMLDocument, entityId: string): string[] {
  const context = findBeamContext(xmlDoc, entityId);
  if (!context) return [];
  const [start, end] = levelOneRunBounds(context.roots, context.index);
  if (start === end) return [];
  return context.roots
    .slice(start, end + 1)
    .map((root) => noteId(root))
    .filter((id): id is string => Boolean(id));
}

export function updateManualBeamDirectionAtEntity(
  xmlDoc: XMLDocument,
  entityId: string,
  direction: BeamDirection
): boolean {
  const context = findBeamContext(xmlDoc, entityId);
  if (!context) return false;
  const [start, end] = levelOneRunBounds(context.roots, context.index);
  if (start === end) return false;
  for (let item = start; item <= end; item += 1) {
    const group = context.groups[item];
    if (!group) continue;
    setStemDirection(xmlDoc, group.elements[0], direction);
    group.elements.slice(1).forEach((member) => member.querySelector(':scope > stem')?.remove());
  }
  return true;
}

export function rebuildAutomaticBeams(xmlDoc: XMLDocument): void {
  xmlDoc.querySelectorAll('part > measure').forEach((measure) => (
    rebuildAutomaticBeamsForMeasure(xmlDoc, measure)
  ));
}
