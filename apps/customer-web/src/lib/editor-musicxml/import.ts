import {
  captureSource,
  parseSource,
  remember,
  UnsupportedEditorMusicXmlError,
  type MusicXmlSourceSnapshot,
  type SourceAnchors,
} from './source';
import {
  durationBases,
  integer,
  measureContexts,
  rational,
  rhythmLength,
  type MeasureContext,
} from './context';
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
} from '../editor-domain/model';
import type {
  NotationControl,
  NotationPlacementOverride,
  StemDirectionOverride,
} from '../editor-domain/notation-model';

type ImportState = {
  documentId: ScoreDocumentId;
  anchors: SourceAnchors;
  nodes: Map<string, Element[]>;
  contexts: Map<Element, MeasureContext>;
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

export type EditorMusicXmlImport = {
  document: ScoreDocument;
  gaps: TimelineGap[];
  source: MusicXmlSourceSnapshot;
};

export function importEditorMusicXml(xml: string): EditorMusicXmlImport {
  const xmlDoc = parseSource(xml);
  const state: ImportState = {
    documentId: toScoreDocumentId('score-document-1'),
    anchors: new Map(),
    nodes: new Map(),
    contexts: measureContexts(xmlDoc),
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
  const partElements = Array.from(xmlDoc.querySelectorAll('score-partwise > part'));
  const ids = new Set<string>();
  for (const note of Array.from(xmlDoc.querySelectorAll('part > measure > note[id]'))) {
    const id = note.getAttribute('id')!;
    if (ids.has(id)) throw new UnsupportedEditorMusicXmlError('Note source IDs must be unique.');
    ids.add(id);
  }
  if (!partElements.length) throw new UnsupportedEditorMusicXmlError('MusicXML requires a part.');

  partElements.forEach((partElement) => {
    const id = partElement.getAttribute('id');
    if (!id || state.parts.some((part) => part.id === id) || !partNames.has(toPartId(id)))
      throw new UnsupportedEditorMusicXmlError(
        'A unique declared part identity and name are required.',
      );
    const partId = toPartId(id);
    anchor(state, 'part:' + partId, [partElement]);
    state.parts.push({
      id: partId,
      name: partNames.get(partId)!,
    });

    importPartMeasures(state, partElement, partId);
  });

  const anchoredNotation = new Set(
    Array.from(state.nodes)
      .filter(([key]) => /^(tie|slur|beam):/.test(key))
      .flatMap(([, nodes]) => nodes),
  );
  if (
    Array.from(
      xmlDoc.querySelectorAll(
        'note > tie, note > beam, note > notations > tied, note > notations > slur',
      ),
    ).some((node) => !anchoredNotation.has(node))
  )
    throw new UnsupportedEditorMusicXmlError('A notation relationship has no safe domain mapping.');
  if (state.tieStartByKey.size || state.slurStartByKey.size || state.beamRunByVoiceId.size)
    throw new UnsupportedEditorMusicXmlError(
      'Open notation relationships cannot be edited safely.',
    );
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
    source: captureSource(xml, state.anchors),
  };
}

function anchor(state: ImportState, key: string, nodes: Element[]) {
  state.nodes.set(key, nodes);
  remember(state.anchors, key, nodes);
}

function getPartNames(xmlDoc: XMLDocument): Map<PartId, string> {
  const names = new Map<PartId, string>();

  xmlDoc.querySelectorAll('part-list > score-part').forEach((scorePart) => {
    const sourceId = scorePart.getAttribute('id');
    if (!sourceId)
      throw new UnsupportedEditorMusicXmlError('Part declarations require identities.');
    const id = toPartId(sourceId);
    const name = scorePart.querySelector(':scope > part-name')?.textContent?.trim();
    if (name) names.set(id, name);
  });

  return names;
}

function importPartMeasures(state: ImportState, partElement: Element, partId: PartId): void {
  const measureElements = Array.from(partElement.querySelectorAll(':scope > measure'));

  measureElements.forEach((measureElement, measureIndex) => {
    const measureNumber = integer(measureElement.getAttribute('number'), 'measure number');
    const measureId = toMeasureId(`${partId}:measure-${measureNumber}`);
    if (state.measures.has(measureId))
      throw new UnsupportedEditorMusicXmlError(
        'Repeated measure identities require explicit domain support.',
      );
    anchor(state, 'measure:' + measureId, [measureElement]);
    state.measures.set(measureId, {
      id: measureId,
      number: measureNumber,
    });

    const context = state.contexts.get(measureElement)!;
    const divisions = context.divisions;
    const measureDuration = context.meter;
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
        cursorTicks -= getDurationTicks(element);
        if (cursorTicks < 0)
          throw new UnsupportedEditorMusicXmlError('Backup crosses the measure start.');
        return;
      }

      if (element.tagName !== 'note') return;

      const note = element;
      for (const name of [
        'pitch',
        'rest',
        'duration',
        'type',
        'voice',
        'staff',
        'stem',
        'accidental',
      ])
        if (note.querySelectorAll(':scope > ' + name).length > 1)
          throw new UnsupportedEditorMusicXmlError('Ambiguous note fields.');
      if (note.querySelectorAll(':scope > notations > technical > fingering').length > 1)
        throw new UnsupportedEditorMusicXmlError(
          'Multiple fingerings require explicit domain support.',
        );
      if (divisions === undefined)
        throw new UnsupportedEditorMusicXmlError('A note requires inherited divisions.');
      if (
        note.querySelector(
          ':scope > grace, :scope > cue, :scope > unpitched, :scope > time-modification',
        )
      )
        throw new UnsupportedEditorMusicXmlError(
          'Grace, cue, unpitched and tuplet notation require explicit domain support.',
        );
      const staffNumber = getPositiveInt(note.querySelector(':scope > staff')?.textContent, 1);
      const voiceNumber = getPositiveInt(note.querySelector(':scope > voice')?.textContent, 1);
      const declaredStaves = measureElement.querySelector(':scope > attributes > staves');
      if (declaredStaves)
        for (let index = 1; index <= integer(declaredStaves.textContent, 'staves', 1); index++)
          ensureStaff(state, partId, index);
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
        if (
          !previous ||
          !atom ||
          state.nodes.get('event:' + previous.id)?.at(-1) !== note.previousElementSibling
        )
          throw new UnsupportedEditorMusicXmlError(
            'A chord member must immediately follow its pitched event.',
          );
        if (JSON.stringify(previous.rhythm) !== JSON.stringify(rhythm))
          throw new UnsupportedEditorMusicXmlError('Chord members require a shared rhythm.');
        if (previous && atom) {
          anchor(state, 'atom:' + atom.id, [note]);
          anchor(state, 'event:' + previous.id, [
            ...state.nodes.get('event:' + previous.id)!,
            note,
          ]);
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
        anchor(state, 'event:' + event.id, [note]);
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
      anchor(state, 'atom:' + atom.id, [note]);
      anchor(state, 'event:' + event.id, [note]);
      state.events.push(event);
      measureEvents.push(event);
      lastEventByVoice.set(voiceId, event);
      addStemNotationControl(state, event.id, note);
      addTieRelationshipEvent(state, atom, staffNumber, voiceId, note, partId, measureIndex);
      addSlurRelationshipEvent(state, atom, staffNumber, note, partId, measureIndex);
      addBeamRelationshipEvent(state, event.id, voiceId, note, partId, measureIndex);
      cursorTicks += durationTicks;
    });

    if (measureDuration)
      for (const voice of state.voices.values()) {
        if (voice.partId !== partId) continue;
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
    const number = getPositiveInt(slur.getAttribute('number'), 1);
    const slurKey = `${partId}:${staffNumber}:${number}`;

    if (type === 'stop') {
      const start = state.slurStartByKey.get(slurKey);
      if (!start) throw new UnsupportedEditorMusicXmlError('Slur stop has no matching start.');
      state.slurCounter += 1;
      const slurId = `${partId}-m${measureIndex + 1}-slur-${state.slurCounter}` as NotationId;
      state.slurRelationships.push(
        createSlurRelationship({
          id: slurId,
          startNoteAtomId: start.atom.id,
          stopNoteAtomId: atom.id,
        }),
      );
      if (start.placement) {
        state.notationControls.push({
          kind: 'slurNotation',
          notationId: slurId,
          placement: start.placement,
        });
      }
      const startNode = state.nodes.get('atom:' + start.atom.id)![0];
      anchor(state, 'slur:' + slurId, [
        ...Array.from(startNode.querySelectorAll(':scope > notations > slur')).filter(
          (element) =>
            element.getAttribute('type') === 'start' &&
            getPositiveInt(element.getAttribute('number'), 1) === number,
        ),
        slur,
      ]);
      state.slurStartByKey.delete(slurKey);
    }

    if (type !== 'start' && type !== 'stop')
      throw new UnsupportedEditorMusicXmlError('Unsupported slur continuation.');
    if (type === 'start') {
      if (state.slurStartByKey.has(slurKey))
        throw new UnsupportedEditorMusicXmlError('Overlapping slur numbers.');
      state.slurStartByKey.set(slurKey, {
        atom,
        placement: toSlurPlacement(slur.getAttribute('placement')),
      });
    }
  });
}

function toSlurPlacement(
  placement: string | null | undefined,
): NotationPlacementOverride | undefined {
  if (placement === 'above' || placement === 'below') return placement;
  if (placement) throw new UnsupportedEditorMusicXmlError('Unsupported slur placement.');
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
    if (!start) throw new UnsupportedEditorMusicXmlError('Tie stop has no matching start.');
    if (start) {
      state.tieCounter += 1;
      const tieId = `${partId}-m${measureIndex + 1}-tie-${state.tieCounter}` as TieId;
      start.atom.tieOut = tieId;
      atom.tieIn = tieId;
      state.tieRelationships.push(
        createTieRelationship({
          id: tieId,
          startNoteAtomId: start.atom.id,
          stopNoteAtomId: atom.id,
        }),
      );
      if (start.placement) {
        state.notationControls.push({
          kind: 'tieNotation',
          tieId,
          placement: start.placement,
        });
      }
      const startNode = state.nodes.get('atom:' + start.atom.id)![0];
      anchor(state, 'tie:' + tieId, [
        ...Array.from(
          startNode.querySelectorAll(
            ':scope > tie[type="start"], :scope > notations > tied[type="start"]',
          ),
        ),
        ...Array.from(
          note.querySelectorAll(
            ':scope > tie[type="stop"], :scope > notations > tied[type="stop"]',
          ),
        ),
      ]);
      state.tieStartByKey.delete(tieKey);
    }
  }

  if (hasStart) {
    if (state.tieStartByKey.has(tieKey))
      throw new UnsupportedEditorMusicXmlError('Overlapping tie starts.');
    state.tieStartByKey.set(tieKey, {
      atom,
      placement: toTiePlacement(
        note.querySelector(':scope > notations > tied[type="start"]')?.getAttribute('orientation'),
      ),
    });
  }
}

function toTiePlacement(
  orientation: string | null | undefined,
): NotationPlacementOverride | undefined {
  if (orientation === 'over') return 'above';
  if (orientation === 'under') return 'below';
  if (orientation) throw new UnsupportedEditorMusicXmlError('Unsupported tie orientation.');
  return undefined;
}

function getTieKey(atom: NoteAtom, staffNumber: number, voiceId: VoiceId): string {
  return [voiceId, staffNumber, atom.pitch.step, atom.pitch.alter ?? 0, atom.pitch.octave].join(
    ':',
  );
}

function addBeamRelationshipEvent(
  state: ImportState,
  eventId: EventId,
  voiceId: VoiceId,
  note: Element,
  partId: PartId,
  measureIndex: number,
): void {
  if (
    Array.from(note.querySelectorAll(':scope > beam')).some(
      (item) => getPositiveInt(item.getAttribute('number'), 1) !== 1,
    )
  )
    throw new UnsupportedEditorMusicXmlError(
      'Multiple beam levels require explicit domain support.',
    );
  const beam = getLevelOneBeamElement(note);
  const beamType = beam?.textContent?.trim();
  if (beam && beamType !== 'begin' && beamType !== 'continue' && beamType !== 'end')
    throw new UnsupportedEditorMusicXmlError('Unsupported beam hook.');
  if (!beam) return;

  if (beamType === 'begin') {
    state.beamRunByVoiceId.set(voiceId, [eventId]);
    return;
  }

  const run = state.beamRunByVoiceId.get(voiceId);
  if (!run) throw new UnsupportedEditorMusicXmlError('Beam continuation has no start.');
  run.push(eventId);

  if (beamType === 'end') {
    state.beamRunByVoiceId.delete(voiceId);
    if (run.length < 2) throw new UnsupportedEditorMusicXmlError('A beam requires two events.');
    state.beamCounter += 1;
    const beamId = `${partId}-m${measureIndex + 1}-beam-${state.beamCounter}` as BeamId;
    anchor(
      state,
      'beam:' + beamId,
      run.map((id) => getLevelOneBeamElement(state.nodes.get('event:' + id)![0])!),
    );
    state.beamRelationships.push(
      createBeamRelationship({
        id: beamId,
        eventIds: run,
      }),
    );
  }
}

function getLevelOneBeamElement(note: Element): Element | null {
  return (
    Array.from(note.querySelectorAll(':scope > beam')).find(
      (beam) => getPositiveInt(beam.getAttribute('number'), 1) === 1,
    ) ?? null
  );
}

function addStemNotationControl(state: ImportState, eventId: EventId, note: Element): void {
  const stemDirection = toStemDirectionOverride(
    note.querySelector(':scope > stem')?.textContent?.trim(),
  );
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

function ensureVoice(
  state: ImportState,
  partId: PartId,
  staffId: StaffId,
  voiceNumber: number,
): VoiceId {
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

function getDurationTicks(element: Element): number {
  return integer(element.querySelector(':scope > duration')?.textContent, 'duration', 1);
}

function toRhythmicValue(note: Element, durationTicks: number, divisions: number): RhythmicValue {
  const type = note.querySelector(':scope > type');
  const notation = type?.textContent?.trim();
  if (type && !notation)
    throw new UnsupportedEditorMusicXmlError('An explicit note type cannot be empty.');
  const dots = note.querySelectorAll(':scope > dot').length;
  const base = notation
    ? toDurationBase(notation)
    : (Object.keys(durationBases) as Array<keyof typeof durationBases>).find(
        (candidate) => rhythmLength(candidate, dots) === durationTicks / divisions,
      );
  if (!base || rhythmLength(base, dots) !== durationTicks / divisions)
    throw new UnsupportedEditorMusicXmlError(
      'Note duration and notation cannot be represented exactly.',
    );
  return {
    timelineDuration: durationTicksToQuarterRational(durationTicks, divisions),
    notation: {
      base,
      dots: note.querySelectorAll(':scope > dot').length,
    },
  };
}

function toDurationBase(value: string | null | undefined): RhythmicValue['notation']['base'] {
  if (
    value === 'whole' ||
    value === 'half' ||
    value === 'quarter' ||
    value === 'eighth' ||
    value === '16th' ||
    value === '32nd' ||
    value === '64th'
  ) {
    return value;
  }
  throw new UnsupportedEditorMusicXmlError('Unsupported note type.');
}

function toNoteAtom(note: Element, fallbackId: string): NoteAtom | null {
  const pitch = toPitch(note);
  if (!pitch) return null;
  const sourceId = note.getAttribute('id') || undefined;

  return {
    id: toNoteAtomId(note.getAttribute('id') || fallbackId),
    pitch,
    accidental: toAccidental(note.querySelector(':scope > accidental')?.textContent?.trim()),
    fingering: normalizeFingeringText(
      note.querySelector(':scope > notations > technical > fingering')?.textContent,
    ),
    source: {
      musicXmlElementId: sourceId,
    },
  };
}

function toPitch(note: Element): Pitch | null {
  const octave = integer(
    note.querySelector(':scope > pitch > octave')?.textContent,
    'pitch octave',
  );
  if (octave > 9) throw new UnsupportedEditorMusicXmlError('Unsupported pitch octave.');
  const stepText = note.querySelector(':scope > pitch > step')?.textContent?.trim();
  if (!isPitchStep(stepText))
    throw new UnsupportedEditorMusicXmlError('A pitched note requires a valid step.');

  return {
    step: stepText,
    octave,
    alter: getOptionalInt(note.querySelector(':scope > pitch > alter')?.textContent),
  };
}

function isPitchStep(value: string | null | undefined): value is PitchStep {
  return (
    value === 'C' ||
    value === 'D' ||
    value === 'E' ||
    value === 'F' ||
    value === 'G' ||
    value === 'A' ||
    value === 'B'
  );
}

function toAccidental(value: string | null | undefined): NoteAtom['accidental'] {
  if (
    value === 'flat-flat' ||
    value === 'flat' ||
    value === 'natural' ||
    value === 'sharp' ||
    value === 'double-sharp'
  ) {
    return value;
  }
  if (value) throw new UnsupportedEditorMusicXmlError('Unsupported accidental.');
  return undefined;
}

function toStemDirectionOverride(
  value: string | null | undefined,
): StemDirectionOverride | undefined {
  if (value === 'up' || value === 'down' || value === 'none' || value === 'double') {
    return value;
  }
  if (value) throw new UnsupportedEditorMusicXmlError('Unsupported stem value.');
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
  if (!/^[1-5]$/.test(mapped)) throw new UnsupportedEditorMusicXmlError('Unsupported fingering.');
  return mapped;
}

function durationTicksToQuarterRational(durationTicks: number, divisions: number): Rational {
  return normalizeRational({
    numerator: durationTicks,
    denominator: divisions,
  });
}

function normalizeRational(value: Rational): Rational {
  return rational(value.numerator, value.denominator);
}

function getPositiveInt(value: string | null | undefined, omitted: number): number {
  return value == null ? omitted : integer(value, 'voice, staff or notation identity', 1);
}

function getOptionalInt(value: string | null | undefined): number | undefined {
  if (value == null) return undefined;
  const number = Number(value.trim());
  if (!value.trim() || !Number.isFinite(number))
    throw new UnsupportedEditorMusicXmlError('Invalid pitch alteration.');
  return number;
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
