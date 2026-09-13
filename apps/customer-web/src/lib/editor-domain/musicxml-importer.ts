import {
  createExplicitRestEvent,
  createBeamRelationship,
  createPitchedEvent,
  createSlurRelationship,
  createTieRelationship,
  deriveTimelineGaps,
  type BeamId,
  type BeamRelationship,
  type EventId,
  type Measure,
  type MeasureId,
  type NoteAtom,
  type NoteAtomId,
  type NotationId,
  type Part,
  type PartId,
  type Pitch,
  type PitchStep,
  type Rational,
  type RhythmicValue,
  type ScoreDocument,
  type ScoreDocumentId,
  type SlurRelationship,
  type Staff,
  type StaffId,
  type TimelineGap,
  type TieId,
  type TieRelationship,
  type Voice,
  type VoiceEvent,
  type VoiceId,
} from './model';
import type { NotationControl, NotationPlacementOverride, StemDirectionOverride } from './notation-model';

type ImportState = {
  documentId: ScoreDocumentId;
  parts: Part[];
  staves: Map<StaffId, Staff>;
  voices: Map<VoiceId, Voice>;
  measures: Map<MeasureId, Measure>;
  events: VoiceEvent[];
  gaps: TimelineGap[];
  beamRelationships: BeamRelationship[];
  tieRelationships: TieRelationship[];
  slurRelationships: SlurRelationship[];
  notationControls: NotationControl[];
  beamRunByVoiceId: Map<VoiceId, EventId[]>;
  beamCounter: number;
  tieStartByKey: Map<string, { atom: NoteAtom; placement?: NotationPlacementOverride }>;
  tieCounter: number;
  slurStartByKey: Map<string, { atom: NoteAtom; placement?: NotationPlacementOverride }>;
  slurCounter: number;
};

export type MusicXmlImportResult = {
  document: ScoreDocument;
  gaps: TimelineGap[];
};

export function importMusicXmlToEditorDomain(xml: string): MusicXmlImportResult {
  const xmlDoc = parseMusicXml(xml);
  const state: ImportState = {
    documentId: toScoreDocumentId('score-document-1'),
    parts: [],
    staves: new Map(),
    voices: new Map(),
    measures: new Map(),
    events: [],
    gaps: [],
    beamRelationships: [],
    tieRelationships: [],
    slurRelationships: [],
    notationControls: [],
    beamRunByVoiceId: new Map(),
    beamCounter: 0,
    tieStartByKey: new Map(),
    tieCounter: 0,
    slurStartByKey: new Map(),
    slurCounter: 0,
  };

  const partNames = getPartNames(xmlDoc);
  const partElements = Array.from(xmlDoc.querySelectorAll('score-partwise > part, part'));

  partElements.forEach((partElement, partIndex) => {
    const partId = toPartId(partElement.getAttribute('id') || `part-${partIndex + 1}`);
    state.parts.push({
      id: partId,
      name: partNames.get(partId) || `Part ${partIndex + 1}`,
    });

    importPartMeasures(state, partElement, partId);
  });

  return {
    document: {
      schemaVersion: 1,
      id: state.documentId,
      parts: state.parts,
      staves: Array.from(state.staves.values()),
      voices: Array.from(state.voices.values()),
      measures: Array.from(state.measures.values()),
      events: state.events,
      beamRelationships: state.beamRelationships,
      tieRelationships: state.tieRelationships,
      slurRelationships: state.slurRelationships,
      notationControls: state.notationControls,
    },
    gaps: state.gaps,
  };
}

function parseMusicXml(xml: string): XMLDocument {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xml, 'application/xml');
  const parserError = xmlDoc.querySelector('parsererror');
  if (parserError) {
    throw new Error('Failed to parse MusicXML.');
  }
  return xmlDoc;
}

function getPartNames(xmlDoc: XMLDocument): Map<PartId, string> {
  const names = new Map<PartId, string>();

  xmlDoc.querySelectorAll('part-list > score-part').forEach((scorePart, index) => {
    const id = toPartId(scorePart.getAttribute('id') || `part-${index + 1}`);
    const name = scorePart.querySelector(':scope > part-name')?.textContent?.trim();
    if (name) names.set(id, name);
  });

  return names;
}

function importPartMeasures(state: ImportState, partElement: Element, partId: PartId): void {
  const measureElements = Array.from(partElement.querySelectorAll(':scope > measure'));

  measureElements.forEach((measureElement, measureIndex) => {
    const measureNumber = Number.parseInt(measureElement.getAttribute('number') || `${measureIndex + 1}`, 10);
    const measureId = toMeasureId(`${partId}:measure-${Number.isFinite(measureNumber) ? measureNumber : measureIndex + 1}`);
    state.measures.set(measureId, {
      id: measureId,
      number: Number.isFinite(measureNumber) ? measureNumber : measureIndex + 1,
    });

    const divisions = getMeasureDivisions(measureElement);
    const measureDuration = getMeasureDuration(measureElement, divisions);
    let cursorTicks = 0;
    const lastEventByVoice = new Map<VoiceId, ReturnType<typeof createPitchedEvent>>();
    const measureEvents: VoiceEvent[] = [];

    Array.from(measureElement.childNodes).forEach((node, nodeIndex) => {
      if (node.nodeType !== 1) return;
      const element = node as Element;

      if (element.tagName === 'forward') {
        cursorTicks += getDurationTicks(element);
        return;
      }

      if (element.tagName === 'backup') {
        cursorTicks = Math.max(0, cursorTicks - getDurationTicks(element));
        return;
      }

      if (element.tagName !== 'note') return;

      const note = element;
      const staffNumber = getPositiveInt(note.querySelector(':scope > staff')?.textContent, 1);
      const voiceNumber = getPositiveInt(note.querySelector(':scope > voice')?.textContent, 1);
      const staffId = ensureStaff(state, partId, staffNumber);
      const voiceId = ensureVoice(state, partId, staffId, voiceNumber);
      const durationTicks = getDurationTicks(note);
      const rhythm = toRhythmicValue(note, durationTicks, divisions);
      const position = {
        measureId,
        offset: durationTicksToQuarterRational(cursorTicks, divisions),
      };

      if (note.querySelector(':scope > chord')) {
        const previous = lastEventByVoice.get(voiceId);
        const atom = toNoteAtom(note, `${partId}-m${measureIndex + 1}-n${nodeIndex + 1}`);
        if (previous && atom) {
          previous.notes.push(atom);
          if (atom.source?.musicXmlElementId) {
            previous.source = {
              musicXmlElementIds: [
                ...(previous.source?.musicXmlElementIds ?? []),
                atom.source.musicXmlElementId,
              ],
            };
          }
          addTieRelationshipEvent(state, atom, staffNumber, voiceId, note, partId, measureIndex);
          addSlurRelationshipEvent(state, atom, staffNumber, note, partId, measureIndex);
        }
        return;
      }

      lastEventByVoice.delete(voiceId);

      if (note.querySelector(':scope > rest')) {
        const event = createExplicitRestEvent({
          id: toEventId(`${partId}-m${measureIndex + 1}-e${nodeIndex + 1}`),
          voiceId,
          staffId,
          position,
          rhythm,
          source: {
            musicXmlElementId: note.getAttribute('id') || undefined,
          },
        });
        state.events.push(event);
        measureEvents.push(event);
        cursorTicks += durationTicks;
        return;
      }

      const atom = toNoteAtom(note, `${partId}-m${measureIndex + 1}-n${nodeIndex + 1}`);
      if (!atom) {
        cursorTicks += durationTicks;
        return;
      }

      const event = createPitchedEvent({
        id: toEventId(`${partId}-m${measureIndex + 1}-e${nodeIndex + 1}`),
        voiceId,
        staffId,
        position,
        rhythm,
        notes: [atom],
        source: {
          musicXmlElementIds: [atom.source?.musicXmlElementId].filter(Boolean) as string[],
        },
      });
      state.events.push(event);
      measureEvents.push(event);
      lastEventByVoice.set(voiceId, event);
      addStemNotationControl(state, event.id, note);
      addTieRelationshipEvent(state, atom, staffNumber, voiceId, note, partId, measureIndex);
      addSlurRelationshipEvent(state, atom, staffNumber, note, partId, measureIndex);
      addBeamRelationshipEvent(state, event.id, voiceId, note, partId, measureIndex);
      cursorTicks += durationTicks;
    });

    for (const voice of state.voices.values()) {
      const voiceGaps = deriveTimelineGaps({
        events: measureEvents,
        measureId,
        staffId: voice.homeStaffId,
        voiceId: voice.id,
        measureDuration,
      });
      state.gaps.push(...voiceGaps);
    }
  });
}

function addSlurRelationshipEvent(
  state: ImportState,
  atom: NoteAtom,
  staffNumber: number,
  note: Element,
  partId: PartId,
  measureIndex: number,
): void {
  const slurs = Array.from(note.querySelectorAll(':scope > notations > slur'));

  slurs.forEach((slur) => {
    const type = slur.getAttribute('type');
    const number = Number.parseInt(slur.getAttribute('number') ?? '1', 10) || 1;
    const slurKey = `${staffNumber}:${number}`;

    if (type === 'stop') {
      const start = state.slurStartByKey.get(slurKey);
      if (!start) return;
      state.slurCounter += 1;
      const slurId = `${partId}-m${measureIndex + 1}-slur-${state.slurCounter}` as NotationId;
      state.slurRelationships.push(createSlurRelationship({
        id: slurId,
        startNoteAtomId: start.atom.id,
        stopNoteAtomId: atom.id,
      }));
      if (start.placement) {
        state.notationControls.push({
          kind: 'slurNotation',
          notationId: slurId,
          placement: start.placement,
        });
      }
      state.slurStartByKey.delete(slurKey);
    }

    if (type === 'start') {
      state.slurStartByKey.set(slurKey, {
        atom,
        placement: toSlurPlacement(slur.getAttribute('placement')),
      });
    }
  });
}

function toSlurPlacement(placement: string | null | undefined): NotationPlacementOverride | undefined {
  if (placement === 'above' || placement === 'below') return placement;
  return undefined;
}

function addTieRelationshipEvent(
  state: ImportState,
  atom: NoteAtom,
  staffNumber: number,
  voiceId: VoiceId,
  note: Element,
  partId: PartId,
  measureIndex: number,
): void {
  const tieElements = Array.from(note.querySelectorAll(':scope > tie'));
  const hasStop = tieElements.some((tie) => tie.getAttribute('type') === 'stop');
  const hasStart = tieElements.some((tie) => tie.getAttribute('type') === 'start');
  const tieKey = getTieKey(atom, staffNumber, voiceId);

  if (hasStop) {
    const start = state.tieStartByKey.get(tieKey);
    if (start) {
      state.tieCounter += 1;
      const tieId = `${partId}-m${measureIndex + 1}-tie-${state.tieCounter}` as TieId;
      start.atom.tieOut = tieId;
      atom.tieIn = tieId;
      state.tieRelationships.push(createTieRelationship({
        id: tieId,
        startNoteAtomId: start.atom.id,
        stopNoteAtomId: atom.id,
      }));
      if (start.placement) {
        state.notationControls.push({
          kind: 'tieNotation',
          tieId,
          placement: start.placement,
        });
      }
      state.tieStartByKey.delete(tieKey);
    }
  }

  if (hasStart) {
    state.tieStartByKey.set(tieKey, {
      atom,
      placement: toTiePlacement(note.querySelector(':scope > notations > tied[type="start"]')?.getAttribute('orientation')),
    });
  }
}

function toTiePlacement(orientation: string | null | undefined): NotationPlacementOverride | undefined {
  if (orientation === 'over') return 'above';
  if (orientation === 'under') return 'below';
  return undefined;
}

function getTieKey(atom: NoteAtom, staffNumber: number, voiceId: VoiceId): string {
  return [
    voiceId,
    staffNumber,
    atom.pitch.step,
    atom.pitch.alter ?? 0,
    atom.pitch.octave,
  ].join(':');
}

function addBeamRelationshipEvent(
  state: ImportState,
  eventId: EventId,
  voiceId: VoiceId,
  note: Element,
  partId: PartId,
  measureIndex: number,
): void {
  const beam = getLevelOneBeamElement(note);
  const beamType = beam?.textContent?.trim();
  if (beamType !== 'begin' && beamType !== 'continue' && beamType !== 'end') return;

  if (beamType === 'begin') {
    state.beamRunByVoiceId.set(voiceId, [eventId]);
    return;
  }

  const run = state.beamRunByVoiceId.get(voiceId);
  if (!run) return;
  run.push(eventId);

  if (beamType === 'end') {
    state.beamRunByVoiceId.delete(voiceId);
    if (run.length < 2) return;
    state.beamCounter += 1;
    state.beamRelationships.push(createBeamRelationship({
      id: `${partId}-m${measureIndex + 1}-beam-${state.beamCounter}` as BeamId,
      eventIds: run,
    }));
  }
}

function getLevelOneBeamElement(note: Element): Element | null {
  return Array.from(note.querySelectorAll(':scope > beam')).find((beam) => (
    Number.parseInt(beam.getAttribute('number') ?? '1', 10) === 1
  )) ?? null;
}

function addStemNotationControl(state: ImportState, eventId: EventId, note: Element): void {
  const stemDirection = toStemDirectionOverride(note.querySelector(':scope > stem')?.textContent?.trim());
  if (!stemDirection) return;

  state.notationControls.push({
    kind: 'eventNotation',
    eventId,
    stemDirection,
  });
}

function ensureStaff(state: ImportState, partId: PartId, staffNumber: number): StaffId {
  const staffId = toStaffId(`${partId}:staff-${staffNumber}`);
  if (!state.staves.has(staffId)) {
    state.staves.set(staffId, {
      id: staffId,
      partId,
      index: staffNumber - 1,
    });
  }
  return staffId;
}

function ensureVoice(state: ImportState, partId: PartId, staffId: StaffId, voiceNumber: number): VoiceId {
  const voiceId = toVoiceId(`${partId}:voice-${voiceNumber}`);
  if (!state.voices.has(voiceId)) {
    state.voices.set(voiceId, {
      id: voiceId,
      partId,
      homeStaffId: staffId,
      stemPolicy: 'automatic',
    });
  }
  return voiceId;
}

function getMeasureDivisions(measureElement: Element): number {
  return getPositiveInt(measureElement.querySelector(':scope > attributes > divisions')?.textContent, 1);
}

function getMeasureDuration(measureElement: Element, divisions: number): Rational {
  const beats = getPositiveInt(measureElement.querySelector(':scope > attributes > time > beats')?.textContent, 4);
  const beatType = getPositiveInt(measureElement.querySelector(':scope > attributes > time > beat-type')?.textContent, 4);
  return normalizeRational({
    numerator: beats * 4,
    denominator: beatType,
  }, divisions);
}

function getDurationTicks(element: Element): number {
  return getPositiveInt(element.querySelector(':scope > duration')?.textContent, 0);
}

function toRhythmicValue(note: Element, durationTicks: number, divisions: number): RhythmicValue {
  return {
    timelineDuration: durationTicksToQuarterRational(durationTicks, divisions),
    notation: {
      base: toDurationBase(note.querySelector(':scope > type')?.textContent?.trim()),
      dots: note.querySelectorAll(':scope > dot').length,
    },
  };
}

function toDurationBase(value: string | null | undefined): RhythmicValue['notation']['base'] {
  if (
    value === 'whole'
    || value === 'half'
    || value === 'quarter'
    || value === 'eighth'
    || value === '16th'
    || value === '32nd'
    || value === '64th'
  ) {
    return value;
  }
  return 'quarter';
}

function toNoteAtom(note: Element, fallbackId: string): NoteAtom | null {
  const pitch = toPitch(note);
  if (!pitch) return null;
  const sourceId = note.getAttribute('id') || undefined;

  return {
    id: toNoteAtomId(note.getAttribute('id') || fallbackId),
    pitch,
    accidental: toAccidental(note.querySelector(':scope > accidental')?.textContent?.trim()),
    fingering: normalizeFingeringText(note.querySelector(':scope > notations > technical > fingering')?.textContent),
    source: {
      musicXmlElementId: sourceId,
    },
  };
}

function toPitch(note: Element): Pitch | null {
  const stepText = note.querySelector(':scope > pitch > step')?.textContent?.trim();
  if (!isPitchStep(stepText)) return null;

  return {
    step: stepText,
    octave: getPositiveInt(note.querySelector(':scope > pitch > octave')?.textContent, 4),
    alter: getOptionalInt(note.querySelector(':scope > pitch > alter')?.textContent),
  };
}

function isPitchStep(value: string | null | undefined): value is PitchStep {
  return value === 'C' || value === 'D' || value === 'E' || value === 'F' || value === 'G' || value === 'A' || value === 'B';
}

function toAccidental(value: string | null | undefined): NoteAtom['accidental'] {
  if (
    value === 'flat-flat'
    || value === 'flat'
    || value === 'natural'
    || value === 'sharp'
    || value === 'double-sharp'
  ) {
    return value;
  }
  return undefined;
}

function toStemDirectionOverride(value: string | null | undefined): StemDirectionOverride | undefined {
  if (value === 'up' || value === 'down' || value === 'none' || value === 'double') {
    return value;
  }
  return undefined;
}

const FINGERING_TEXT_MAP: Record<string, string> = {
  '\u2460': '1',
  '\u2461': '2',
  '\u2462': '3',
  '\u2463': '4',
  '\u2464': '5',
};

function normalizeFingeringText(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  const mapped = FINGERING_TEXT_MAP[normalized] ?? normalized;
  return /^[1-5]$/.test(mapped) ? mapped : undefined;
}

function durationTicksToQuarterRational(durationTicks: number, divisions: number): Rational {
  return normalizeRational({
    numerator: durationTicks,
    denominator: divisions,
  });
}

function normalizeRational(value: Rational, fallbackDenominator = 1): Rational {
  const denominator = value.denominator > 0 ? value.denominator : fallbackDenominator;
  if (value.numerator === 0) return { numerator: 0, denominator: 1 };
  const divisor = greatestCommonDivisor(Math.abs(value.numerator), denominator);
  return {
    numerator: value.numerator / divisor,
    denominator: denominator / divisor,
  };
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = left;
  let b = right;
  while (b !== 0) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a || 1;
}

function getPositiveInt(value: string | null | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getOptionalInt(value: string | null | undefined): number | undefined {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toScoreDocumentId(value: string): ScoreDocumentId {
  return value as ScoreDocumentId;
}

function toPartId(value: string): PartId {
  return value as PartId;
}

function toStaffId(value: string): StaffId {
  return value as StaffId;
}

function toVoiceId(value: string): VoiceId {
  return value as VoiceId;
}

function toMeasureId(value: string): MeasureId {
  return value as MeasureId;
}

function toEventId(value: string): EventId {
  return value as EventId;
}

function toNoteAtomId(value: string): NoteAtomId {
  return value as NoteAtomId;
}
