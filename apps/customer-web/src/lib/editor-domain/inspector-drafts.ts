import {
  addNoteAtom,
  materializeDerivedRestAsExplicitRest,
  materializeTimelineGapAsExplicitRest,
  deleteVoiceEvent,
  removeNoteAtom,
  setEventStemDirectionOverride,
  updateExplicitRest,
  updateNoteAtom,
  updatePitchedEvent,
  type CommandResult,
} from './commands';
import type {
  Accidental,
  EventId,
  MusicalPosition,
  NoteAtom,
  NoteAtomId,
  Pitch,
  RhythmicValue,
  ScoreDocument,
  StaffId,
  VoiceId,
} from './model';
import type {
  DerivedRestInspectorViewModel,
  ExplicitRestInspectorViewModel,
  InspectorViewModel,
  NoteAtomInspectorViewModel,
  PitchedEventInspectorViewModel,
  TimelineGapInspectorViewModel,
} from './inspector-view-model';
import type { StemDirectionOverride } from './notation-model';
import { createAppendedNoteAtomIdentity } from './note-atom-identity';

export type PitchedEventInspectorDraft = {
  readonly kind: 'pitchedEvent';
  readonly eventId: EventId;
  readonly voiceId?: VoiceId;
  readonly staffId?: StaffId;
  readonly position?: MusicalPosition;
  readonly rhythm?: RhythmicValue;
  readonly notes?: readonly NoteAtom[];
};

export type NoteAtomInspectorDraft = {
  readonly kind: 'noteAtom';
  readonly eventId: EventId;
  readonly noteAtomId: NoteAtomId;
  readonly pitch?: Pitch;
  readonly accidental?: Accidental | null;
  readonly fingering?: string | null;
};

export type AppendNoteAtomInspectorDraft = {
  readonly kind: 'appendNoteAtom';
  readonly eventId: EventId;
  readonly pitch: Pitch;
};

export type RemoveNoteAtomInspectorDraft = {
  readonly kind: 'removeNoteAtom';
  readonly eventId: EventId;
  readonly noteAtomId: NoteAtomId;
};

export type DeleteEventInspectorDraft = {
  readonly kind: 'deleteEvent';
  readonly eventId: EventId;
};

export type ExplicitRestInspectorDraft = {
  readonly kind: 'explicitRest';
  readonly eventId: EventId;
  readonly voiceId?: VoiceId;
  readonly staffId?: StaffId;
  readonly position?: MusicalPosition;
  readonly rhythm?: RhythmicValue;
};

export type TimelineGapInspectorDraft =
  | {
      readonly kind: 'timelineGap';
      readonly source: TimelineGapInspectorViewModel;
      readonly action: 'inspectOnly';
    }
  | {
      readonly kind: 'timelineGap';
      readonly source: TimelineGapInspectorViewModel;
      readonly action: 'materializeExplicitRest';
      readonly eventId: EventId;
      readonly rhythm: RhythmicValue;
    };

export type DerivedRestInspectorDraft =
  | {
      readonly kind: 'derivedRest';
      readonly source: DerivedRestInspectorViewModel;
      readonly action: 'inspectOnly';
    }
  | {
      readonly kind: 'derivedRest';
      readonly source: DerivedRestInspectorViewModel;
      readonly action: 'materializeExplicitRest';
      readonly eventId: EventId;
      readonly rhythm?: RhythmicValue;
    };

export type InspectorDraft =
  | PitchedEventInspectorDraft
  | NoteAtomInspectorDraft
  | AppendNoteAtomInspectorDraft
  | RemoveNoteAtomInspectorDraft
  | DeleteEventInspectorDraft
  | ExplicitRestInspectorDraft
  | TimelineGapInspectorDraft
  | DerivedRestInspectorDraft;

export type InspectorNotationOverrides = {
  readonly stemDirection?: StemDirectionOverride;
};

export function createInspectorDraftFromViewModel(
  viewModel: InspectorViewModel,
): InspectorDraft {
  switch (viewModel.kind) {
    case 'pitchedEvent':
      return createPitchedEventDraft(viewModel);
    case 'noteAtom':
      return createNoteAtomDraft(viewModel);
    case 'explicitRest':
      return createExplicitRestDraft(viewModel);
    case 'timelineGap':
      return createTimelineGapDraft(viewModel);
    case 'derivedRest':
      return createDerivedRestDraft(viewModel);
    default:
      return exhaustive(viewModel);
  }
}

export function applyInspectorDraft(
  document: ScoreDocument,
  draft: InspectorDraft,
): CommandResult {
  switch (draft.kind) {
    case 'pitchedEvent':
      return updatePitchedEvent({
        document,
        eventId: draft.eventId,
        patch: {
          voiceId: draft.voiceId,
          staffId: draft.staffId,
          position: draft.position,
          rhythm: draft.rhythm,
          notes: draft.notes ? [...draft.notes] : undefined,
        },
      });
    case 'noteAtom':
      return updateNoteAtom({
        document,
        eventId: draft.eventId,
        noteAtomId: draft.noteAtomId,
        patch: {
          ...(draft.pitch ? { pitch: draft.pitch } : {}),
          ...(Object.hasOwn(draft, 'accidental') ? { accidental: draft.accidental } : {}),
          ...(Object.hasOwn(draft, 'fingering') ? { fingering: draft.fingering } : {}),
        },
      });
    case 'appendNoteAtom': {
      const event = document.events.find((candidate) => candidate.id === draft.eventId);
      if (!event || event.kind !== 'pitched') {
        return { success: false, error: 'Only existing pitched events can receive an appended note atom.' };
      }
      const identity = createAppendedNoteAtomIdentity(document, event);
      return addNoteAtom({
        document,
        eventId: draft.eventId,
        note: {
          id: identity.noteAtomId,
          pitch: draft.pitch,
          source: { musicXmlElementId: identity.musicXmlElementId },
        },
      });
    }
    case 'removeNoteAtom':
      return removeNoteAtom({
        document,
        eventId: draft.eventId,
        noteAtomId: draft.noteAtomId,
      });
    case 'deleteEvent':
      return deleteVoiceEvent({
        document,
        eventId: draft.eventId,
      });
    case 'explicitRest':
      return updateExplicitRest({
        document,
        eventId: draft.eventId,
        patch: {
          voiceId: draft.voiceId,
          staffId: draft.staffId,
          position: draft.position,
          rhythm: draft.rhythm,
        },
      });
    case 'timelineGap':
      if (draft.action === 'inspectOnly') {
        return { success: false, error: 'Timeline gap inspection does not mutate the document.' };
      }
      return materializeTimelineGapAsExplicitRest({
        document,
        gap: {
          kind: 'timelineGap',
          voiceId: draft.source.voiceId,
          staffId: draft.source.staffId,
          start: draft.source.start,
          duration: draft.source.duration,
        },
        eventId: draft.eventId,
        rhythm: draft.rhythm,
      });
    case 'derivedRest':
      if (draft.action === 'inspectOnly') {
        return { success: false, error: 'Derived rest inspection does not mutate the document.' };
      }
      return materializeDerivedRestAsExplicitRest({
        document,
        rest: {
          kind: 'derivedRest',
          voiceId: draft.source.voiceId,
          staffId: draft.source.staffId,
          position: draft.source.position,
          rhythm: draft.source.rhythm,
          sourceGap: draft.source.sourceGap,
        },
        eventId: draft.eventId,
        rhythm: draft.rhythm,
      });
    default:
      return exhaustive(draft);
  }
}

export function applyInspectorEdit(
  document: ScoreDocument,
  draft: InspectorDraft,
  notationOverrides: InspectorNotationOverrides = {},
): CommandResult {
  const draftResult = applyInspectorDraft(document, draft);
  if (!draftResult.success) {
    return draftResult;
  }

  if (!Object.hasOwn(notationOverrides, 'stemDirection')) {
    return draftResult;
  }

  if (!('eventId' in draft)) {
    return { success: false, error: 'Stem direction override requires an event-backed inspector draft.' };
  }

  return setEventStemDirectionOverride({
    document: draftResult.document,
    eventId: draft.eventId,
    stemDirection: notationOverrides.stemDirection,
  });
}

function createPitchedEventDraft(
  viewModel: PitchedEventInspectorViewModel,
): PitchedEventInspectorDraft {
  return {
    kind: 'pitchedEvent',
    eventId: viewModel.eventId,
    voiceId: viewModel.voiceId,
    staffId: viewModel.staffId,
    position: viewModel.position,
    rhythm: viewModel.rhythm,
  };
}

function createNoteAtomDraft(
  viewModel: NoteAtomInspectorViewModel,
): NoteAtomInspectorDraft {
  return {
    kind: 'noteAtom',
    eventId: viewModel.eventId,
    noteAtomId: viewModel.noteAtomId,
    pitch: viewModel.pitch,
    accidental: viewModel.accidental,
    fingering: viewModel.fingering,
  };
}

function createExplicitRestDraft(
  viewModel: ExplicitRestInspectorViewModel,
): ExplicitRestInspectorDraft {
  return {
    kind: 'explicitRest',
    eventId: viewModel.eventId,
    voiceId: viewModel.voiceId,
    staffId: viewModel.staffId,
    position: viewModel.position,
    rhythm: viewModel.rhythm,
  };
}

function createTimelineGapDraft(
  viewModel: TimelineGapInspectorViewModel,
): TimelineGapInspectorDraft {
  return {
    kind: 'timelineGap',
    source: viewModel,
    action: 'inspectOnly',
  };
}

function createDerivedRestDraft(
  viewModel: DerivedRestInspectorViewModel,
): DerivedRestInspectorDraft {
  return {
    kind: 'derivedRest',
    source: viewModel,
    action: 'inspectOnly',
  };
}

function exhaustive(value: never): never {
  throw new Error(`Unhandled inspector draft value: ${JSON.stringify(value)}`);
}
