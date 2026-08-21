export type Brand<TValue, TBrand extends string> = TValue & { readonly __brand: TBrand };

export type ScoreDocumentId = Brand<string, 'ScoreDocumentId'>;
export type PartId = Brand<string, 'PartId'>;
export type StaffId = Brand<string, 'StaffId'>;
export type VoiceId = Brand<string, 'VoiceId'>;
export type MeasureId = Brand<string, 'MeasureId'>;
export type EventId = Brand<string, 'EventId'>;
export type NoteAtomId = Brand<string, 'NoteAtomId'>;
export type NotationId = Brand<string, 'NotationId'>;
export type TupletId = Brand<string, 'TupletId'>;
export type TieId = Brand<string, 'TieId'>;
export type BeamId = Brand<string, 'BeamId'>;

export type Rational = {
  numerator: number;
  denominator: number;
};

export type MusicalPosition = {
  measureId: MeasureId;
  offset: Rational;
};

export type DurationBase =
  | 'whole'
  | 'half'
  | 'quarter'
  | 'eighth'
  | '16th'
  | '32nd'
  | '64th';

export type RhythmicValue = {
  /** Timeline length in quarter-note units: quarter = 1, half = 2, whole = 4. */
  timelineDuration: Rational;
  notation: {
    base: DurationBase;
    dots: number;
  };
  tupletId?: TupletId;
};

export type PitchStep = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B';

export type Pitch = {
  step: PitchStep;
  octave: number;
  alter?: number;
};

export type Accidental =
  | 'flat-flat'
  | 'flat'
  | 'natural'
  | 'sharp'
  | 'double-sharp';

export type NoteAtom = {
  id: NoteAtomId;
  pitch: Pitch;
  accidental?: Accidental | null;
  fingering?: string;
  tieIn?: TieId;
  tieOut?: TieId;
  source?: {
    musicXmlElementId?: string;
  };
};

export type PitchedEvent = {
  id: EventId;
  kind: 'pitched';
  voiceId: VoiceId;
  staffId: StaffId;
  position: MusicalPosition;
  rhythm: RhythmicValue;
  notes: [NoteAtom, ...NoteAtom[]];
  source?: {
    musicXmlElementIds: string[];
  };
};

export type ExplicitRestEvent = {
  id: EventId;
  kind: 'explicitRest';
  voiceId: VoiceId;
  staffId: StaffId;
  position: MusicalPosition;
  rhythm: RhythmicValue;
  source?: {
    musicXmlElementId?: string;
  };
};

export type VoiceEvent = PitchedEvent | ExplicitRestEvent;

export type BeamRelationship = {
  id: BeamId;
  eventIds: [EventId, EventId, ...EventId[]];
};

export type TieRelationship = {
  id: TieId;
  startNoteAtomId: NoteAtomId;
  stopNoteAtomId: NoteAtomId;
};

export type SlurRelationship = {
  id: NotationId;
  startNoteAtomId: NoteAtomId;
  stopNoteAtomId: NoteAtomId;
};

export type TimelineGap = {
  kind: 'timelineGap';
  voiceId: VoiceId;
  staffId: StaffId;
  start: MusicalPosition;
  duration: Rational;
};

export type DerivedRest = {
  kind: 'derivedRest';
  voiceId: VoiceId;
  staffId: StaffId;
  position: MusicalPosition;
  rhythm: RhythmicValue;
  sourceGap: TimelineGap;
};

export type EventSelection = {
  kind: 'event';
  eventId: EventId;
};

export type NoteAtomSelection = {
  kind: 'noteAtom';
  eventId: EventId;
  noteAtomId: NoteAtomId;
};

export type CaretSelection = {
  kind: 'caret';
  position: MusicalPosition;
  voiceId: VoiceId;
  staffId: StaffId;
};

export type TimelineGapSelection = {
  kind: 'timelineGap';
  gap: TimelineGap;
};

export type DerivedRestSelection = {
  kind: 'derivedRest';
  rest: DerivedRest;
};

export type NotationSelection = {
  kind: 'notation';
  notationId: NotationId;
};

export type RangeSelection = {
  kind: 'range';
  start: MusicalPosition;
  end: MusicalPosition;
  staffId: StaffId;
  voiceId?: VoiceId;
};

export type EditorSelection =
  | EventSelection
  | NoteAtomSelection
  | CaretSelection
  | TimelineGapSelection
  | DerivedRestSelection
  | NotationSelection
  | RangeSelection;

export type Voice = {
  id: VoiceId;
  partId: PartId;
  homeStaffId: StaffId;
  stemPolicy: 'automatic' | 'up' | 'down';
};

export type Measure = {
  id: MeasureId;
  number: number;
};

export type Staff = {
  id: StaffId;
  partId: PartId;
  index: number;
};

export type Part = {
  id: PartId;
  name: string;
};

export type ScoreDocument = {
  schemaVersion: 1;
  id: ScoreDocumentId;
  parts: Part[];
  staves: Staff[];
  voices: Voice[];
  measures: Measure[];
  events: VoiceEvent[];
  beamRelationships: BeamRelationship[];
  tieRelationships: TieRelationship[];
  slurRelationships: SlurRelationship[];
  notationControls: import('./notation-model').NotationControl[];
};

export type PitchedEventInput = Omit<PitchedEvent, 'kind' | 'notes'> & {
  notes: NoteAtom[];
};

export function createPitchedEvent(input: PitchedEventInput): PitchedEvent {
  if (input.notes.length === 0) {
    throw new Error('PitchedEvent requires at least one NoteAtom.');
  }

  return {
    ...input,
    kind: 'pitched',
    notes: input.notes as [NoteAtom, ...NoteAtom[]],
  };
}

export function createExplicitRestEvent(input: Omit<ExplicitRestEvent, 'kind'>): ExplicitRestEvent {
  return {
    ...input,
    kind: 'explicitRest',
  };
}

export function createBeamRelationship(input: {
  id: BeamId;
  eventIds: EventId[];
}): BeamRelationship {
  if (input.eventIds.length < 2) {
    throw new Error('BeamRelationship requires at least two events.');
  }

  return {
    id: input.id,
    eventIds: input.eventIds as [EventId, EventId, ...EventId[]],
  };
}

export function createTieRelationship(input: {
  id: TieId;
  startNoteAtomId: NoteAtomId;
  stopNoteAtomId: NoteAtomId;
}): TieRelationship {
  if (input.startNoteAtomId === input.stopNoteAtomId) {
    throw new Error('TieRelationship requires two distinct note atoms.');
  }

  return {
    id: input.id,
    startNoteAtomId: input.startNoteAtomId,
    stopNoteAtomId: input.stopNoteAtomId,
  };
}

export function createSlurRelationship(input: {
  id: NotationId;
  startNoteAtomId: NoteAtomId;
  stopNoteAtomId: NoteAtomId;
}): SlurRelationship {
  if (input.startNoteAtomId === input.stopNoteAtomId) {
    throw new Error('SlurRelationship requires two distinct note atoms.');
  }

  return {
    id: input.id,
    startNoteAtomId: input.startNoteAtomId,
    stopNoteAtomId: input.stopNoteAtomId,
  };
}

export function getPitchedEventDisplayKind(event: PitchedEvent): 'note' | 'chord' {
  return event.notes.length === 1 ? 'note' : 'chord';
}

export function isVoiceEvent(value: unknown): value is VoiceEvent {
  if (!value || typeof value !== 'object') return false;
  const kind = (value as { kind?: unknown }).kind;
  return kind === 'pitched' || kind === 'explicitRest';
}

export function createTimelineGap(params: Omit<TimelineGap, 'kind'>): TimelineGap {
  if (compareRational(params.duration, { numerator: 0, denominator: 1 }) <= 0) {
    throw new Error('TimelineGap duration must be positive.');
  }

  return {
    ...params,
    kind: 'timelineGap',
  };
}

export function compareRational(left: Rational, right: Rational): number {
  assertValidRational(left);
  assertValidRational(right);
  return left.numerator * right.denominator - right.numerator * left.denominator;
}

export function addRational(left: Rational, right: Rational): Rational {
  assertValidRational(left);
  assertValidRational(right);
  return normalizeRational({
    numerator: left.numerator * right.denominator + right.numerator * left.denominator,
    denominator: left.denominator * right.denominator,
  });
}

export function subtractRational(left: Rational, right: Rational): Rational {
  assertValidRational(left);
  assertValidRational(right);
  return normalizeRational({
    numerator: left.numerator * right.denominator - right.numerator * left.denominator,
    denominator: left.denominator * right.denominator,
  });
}

export function getEventEndPosition(event: VoiceEvent): MusicalPosition {
  return {
    measureId: event.position.measureId,
    offset: addRational(event.position.offset, event.rhythm.timelineDuration),
  };
}

export function deleteVoiceEventAndDeriveGaps(params: {
  events: VoiceEvent[];
  eventId: EventId;
  measureId: MeasureId;
  staffId: StaffId;
  voiceId: VoiceId;
  measureDuration: Rational;
}): { events: VoiceEvent[]; gaps: TimelineGap[] } {
  const events = params.events.filter((event) => event.id !== params.eventId);
  return {
    events,
    gaps: deriveTimelineGaps({
      events,
      measureId: params.measureId,
      staffId: params.staffId,
      voiceId: params.voiceId,
      measureDuration: params.measureDuration,
    }),
  };
}

export function deriveTimelineGaps(params: {
  events: VoiceEvent[];
  measureId: MeasureId;
  staffId: StaffId;
  voiceId: VoiceId;
  measureDuration: Rational;
}): TimelineGap[] {
  const matchingEvents = params.events
    .filter((event) => (
      event.position.measureId === params.measureId
      && event.staffId === params.staffId
      && event.voiceId === params.voiceId
    ))
    .sort((left, right) => compareRational(left.position.offset, right.position.offset));

  const gaps: TimelineGap[] = [];
  let cursor: Rational = { numerator: 0, denominator: 1 };

  for (const event of matchingEvents) {
    if (compareRational(event.position.offset, cursor) > 0) {
      gaps.push(createTimelineGap({
        voiceId: params.voiceId,
        staffId: params.staffId,
        start: {
          measureId: params.measureId,
          offset: cursor,
        },
        duration: subtractRational(event.position.offset, cursor),
      }));
    }

    const eventEnd = getEventEndPosition(event).offset;
    if (compareRational(eventEnd, cursor) > 0) {
      cursor = eventEnd;
    }
  }

  if (compareRational(params.measureDuration, cursor) > 0) {
    gaps.push(createTimelineGap({
      voiceId: params.voiceId,
      staffId: params.staffId,
      start: {
        measureId: params.measureId,
        offset: cursor,
      },
      duration: subtractRational(params.measureDuration, cursor),
    }));
  }

  return gaps;
}

export type MusicXmlCursorInstruction =
  | {
      kind: 'forward';
      duration: Rational;
    }
  | {
      kind: 'backup';
      duration: Rational;
    };

export function applyMusicXmlCursorInstruction(
  cursor: Rational,
  instruction: MusicXmlCursorInstruction
): Rational {
  if (instruction.kind === 'forward') {
    return addRational(cursor, instruction.duration);
  }

  const next = subtractRational(cursor, instruction.duration);
  return compareRational(next, { numerator: 0, denominator: 1 }) < 0
    ? { numerator: 0, denominator: 1 }
    : next;
}

function assertValidRational(value: Rational): void {
  if (!Number.isInteger(value.numerator) || !Number.isInteger(value.denominator) || value.denominator <= 0) {
    throw new Error('Rational values must use integer numerators and positive integer denominators.');
  }
}

function normalizeRational(value: Rational): Rational {
  assertValidRational(value);
  if (value.numerator === 0) return { numerator: 0, denominator: 1 };

  const divisor = greatestCommonDivisor(Math.abs(value.numerator), value.denominator);
  return {
    numerator: value.numerator / divisor,
    denominator: value.denominator / divisor,
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
