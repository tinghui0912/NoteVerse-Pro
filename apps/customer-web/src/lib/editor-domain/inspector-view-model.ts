import type {
  DerivedRest,
  EditorSelection,
  EventId,
  ExplicitRestEvent,
  NoteAtom,
  NoteAtomId,
  PitchedEvent,
  RhythmicValue,
  ScoreDocument,
  TimelineGap,
  VoiceEvent,
} from './model';
import { getPitchedEventDisplayKind } from './model';
import { getEventStemDirectionOverride, type NotationControl, type StemDirectionOverride } from './notation-model';

export type InspectorNoteAtomViewModel = {
  readonly noteAtomId: NoteAtomId;
  readonly pitch: NoteAtom['pitch'];
  readonly accidental?: NoteAtom['accidental'];
  readonly fingering?: NoteAtom['fingering'];
};

export type PitchedEventInspectorViewModel = {
  readonly kind: 'pitchedEvent';
  readonly eventId: EventId;
  readonly displayKind: 'note' | 'chord';
  readonly voiceId: PitchedEvent['voiceId'];
  readonly staffId: PitchedEvent['staffId'];
  readonly position: PitchedEvent['position'];
  readonly rhythm: RhythmicValue;
  readonly stemDirection?: StemDirectionOverride;
  readonly notes: readonly InspectorNoteAtomViewModel[];
};

export type NoteAtomInspectorViewModel = {
  readonly kind: 'noteAtom';
  readonly eventId: EventId;
  readonly noteAtomId: NoteAtomId;
  readonly voiceId: PitchedEvent['voiceId'];
  readonly staffId: PitchedEvent['staffId'];
  readonly position: PitchedEvent['position'];
  readonly rhythm: RhythmicValue;
  readonly stemDirection?: StemDirectionOverride;
  readonly pitch: NoteAtom['pitch'];
  readonly accidental?: NoteAtom['accidental'];
  readonly fingering?: NoteAtom['fingering'];
};

export type ExplicitRestInspectorViewModel = {
  readonly kind: 'explicitRest';
  readonly eventId: EventId;
  readonly voiceId: ExplicitRestEvent['voiceId'];
  readonly staffId: ExplicitRestEvent['staffId'];
  readonly position: ExplicitRestEvent['position'];
  readonly rhythm: RhythmicValue;
};

export type TimelineGapInspectorViewModel = {
  readonly kind: 'timelineGap';
  readonly voiceId: TimelineGap['voiceId'];
  readonly staffId: TimelineGap['staffId'];
  readonly start: TimelineGap['start'];
  readonly duration: TimelineGap['duration'];
};

export type DerivedRestInspectorViewModel = {
  readonly kind: 'derivedRest';
  readonly voiceId: DerivedRest['voiceId'];
  readonly staffId: DerivedRest['staffId'];
  readonly position: DerivedRest['position'];
  readonly rhythm: RhythmicValue;
  readonly sourceGap: TimelineGap;
};

export type InspectorViewModel =
  | PitchedEventInspectorViewModel
  | NoteAtomInspectorViewModel
  | ExplicitRestInspectorViewModel
  | TimelineGapInspectorViewModel
  | DerivedRestInspectorViewModel;

export function getInspectorViewModelForSelection(
  document: ScoreDocument,
  selection: EditorSelection,
): InspectorViewModel | null {
  switch (selection.kind) {
    case 'event': {
      const event = findEvent(document, selection.eventId);
      return event ? getInspectorViewModelForEvent(event, document.notationControls) : null;
    }
    case 'noteAtom': {
      const event = findEvent(document, selection.eventId);
      if (!event || event.kind !== 'pitched') {
        return null;
      }
      return getInspectorViewModelForNoteAtom(event, selection.noteAtomId, document.notationControls);
    }
    case 'timelineGap':
      return getInspectorViewModelForTimelineGap(selection.gap);
    case 'derivedRest':
      return getInspectorViewModelForDerivedRest(selection.rest);
    case 'caret':
    case 'notation':
    case 'range':
      return null;
    default:
      return exhaustive(selection);
  }
}

export function getInspectorViewModelForEvent(
  event: VoiceEvent,
  notationControls: readonly NotationControl[] = [],
): InspectorViewModel {
  if (event.kind === 'pitched') {
    return {
      kind: 'pitchedEvent',
      eventId: event.id,
      displayKind: getPitchedEventDisplayKind(event),
      voiceId: event.voiceId,
      staffId: event.staffId,
      position: event.position,
      rhythm: event.rhythm,
      stemDirection: getEventStemDirectionOverride(notationControls, event.id),
      notes: event.notes.map(getInspectorViewModelForNote),
    };
  }

  return {
    kind: 'explicitRest',
    eventId: event.id,
    voiceId: event.voiceId,
    staffId: event.staffId,
    position: event.position,
    rhythm: event.rhythm,
  };
}

export function getInspectorViewModelForTimelineGap(
  gap: TimelineGap,
): TimelineGapInspectorViewModel {
  return {
    kind: 'timelineGap',
    voiceId: gap.voiceId,
    staffId: gap.staffId,
    start: gap.start,
    duration: gap.duration,
  };
}

export function getInspectorViewModelForDerivedRest(
  rest: DerivedRest,
): DerivedRestInspectorViewModel {
  return {
    kind: 'derivedRest',
    voiceId: rest.voiceId,
    staffId: rest.staffId,
    position: rest.position,
    rhythm: rest.rhythm,
    sourceGap: rest.sourceGap,
  };
}

function getInspectorViewModelForNoteAtom(
  event: PitchedEvent,
  noteAtomId: NoteAtomId,
  notationControls: readonly NotationControl[] = [],
): NoteAtomInspectorViewModel | null {
  const note = event.notes.find((candidate) => candidate.id === noteAtomId);
  if (!note) {
    return null;
  }
  return {
    kind: 'noteAtom',
    eventId: event.id,
    noteAtomId: note.id,
    voiceId: event.voiceId,
    staffId: event.staffId,
    position: event.position,
    rhythm: event.rhythm,
    stemDirection: getEventStemDirectionOverride(notationControls, event.id),
    pitch: note.pitch,
    accidental: note.accidental,
    fingering: note.fingering,
  };
}

function getInspectorViewModelForNote(note: NoteAtom): InspectorNoteAtomViewModel {
  return {
    noteAtomId: note.id,
    pitch: note.pitch,
    accidental: note.accidental,
    fingering: note.fingering,
  };
}

function findEvent(document: ScoreDocument, eventId: EventId): VoiceEvent | null {
  return document.events.find((candidate) => candidate.id === eventId) ?? null;
}

function exhaustive(value: never): never {
  throw new Error(`Unhandled inspector selection: ${JSON.stringify(value)}`);
}
