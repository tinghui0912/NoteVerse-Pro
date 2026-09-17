import type { Duration } from '@/types/score-types';
import {
  createInputDuration,
  insertExplicitRest,
  insertPitchedEvent,
  type EventId,
  type InputDuration,
  type MusicalPosition,
  type NoteAtomId,
  type Pitch,
  type RhythmicValue,
  type ScoreDocument,
  type StaffId,
  type VoiceId,
} from '@/lib/editor-domain';

export type AddModeInsertCommand =
  | {
      kind: 'insertExplicitRest';
      inputDuration: InputDuration;
    }
  | {
      kind: 'insertPitchedEvent';
      inputDuration: InputDuration;
      pitch: Pitch;
    };

export type AddModeInputKind = 'rest' | 'pitched';

export type AddModeInputState = {
  kind: AddModeInputKind;
  pitch: Pitch;
};

export type ApplyAddModeDomainInsertParams = {
  document: ScoreDocument;
  eventId: EventId;
  voiceId: VoiceId;
  staffId: StaffId;
  position: MusicalPosition;
  command: AddModeInsertCommand;
};

export function createDefaultAddModeInsertCommand(): AddModeInsertCommand {
  return {
    kind: 'insertExplicitRest',
    inputDuration: createDefaultAddModeInputDuration(),
  };
}

export function createDefaultAddModePitchedEventCommand(): AddModeInsertCommand {
  return {
    kind: 'insertPitchedEvent',
    inputDuration: createDefaultAddModeInputDuration(),
    pitch: {
      step: 'C',
      octave: 4,
    },
  };
}

export function createDefaultAddModeInputState(): AddModeInputState {
  return {
    kind: 'rest',
    pitch: {
      step: 'C',
      octave: 4,
    },
  };
}

export function createAddModeInsertCommand(params: {
  input: AddModeInputState;
  inputDuration: InputDuration;
}): AddModeInsertCommand {
  if (params.input.kind === 'rest') {
    return {
      kind: 'insertExplicitRest',
      inputDuration: params.inputDuration,
    };
  }

  return {
    kind: 'insertPitchedEvent',
    inputDuration: params.inputDuration,
    pitch: params.input.pitch,
  };
}

export function createDefaultAddModeInputDuration(): InputDuration {
  return createInputDuration({
    timelineDuration: { numerator: 1, denominator: 1 },
    notation: {
      base: 'quarter',
      dots: 0,
    },
  });
}

export function createAddModeInputDuration(rhythm: RhythmicValue): InputDuration {
  return createInputDuration(rhythm);
}

export function applyAddModeInsertCommandToDomain(params: ApplyAddModeDomainInsertParams) {
  if (params.command.kind === 'insertExplicitRest') {
    return insertExplicitRest(params.document, {
      id: params.eventId,
      voiceId: params.voiceId,
      staffId: params.staffId,
      position: params.position,
      rhythm: params.command.inputDuration.rhythm,
    });
  }

  return insertPitchedEvent(params.document, {
    id: params.eventId,
    voiceId: params.voiceId,
    staffId: params.staffId,
    position: params.position,
    rhythm: params.command.inputDuration.rhythm,
    notes: [{
      id: createAddModeNoteAtomId(params.eventId),
      pitch: params.command.pitch,
    }],
  });
}

export function createAddModeNoteAtomId(eventId: EventId): NoteAtomId {
  return `${eventId}-note-1` as NoteAtomId;
}

export function createAddModeInputDurationFromDuration(duration: Duration): InputDuration {
  return createInputDuration({
    timelineDuration: toTimelineDuration(duration),
    notation: {
      base: toNotationBase(duration),
      dots: 0,
    },
  });
}

function toTimelineDuration(duration: Duration): RhythmicValue['timelineDuration'] {
  switch (duration) {
    case 'durationWhole':
      return { numerator: 4, denominator: 1 };
    case 'durationHalf':
      return { numerator: 2, denominator: 1 };
    case 'durationQuarter':
      return { numerator: 1, denominator: 1 };
    case 'durationEighth':
      return { numerator: 1, denominator: 2 };
    case 'duration16th':
      return { numerator: 1, denominator: 4 };
    case 'duration32nd':
      return { numerator: 1, denominator: 8 };
    default:
      return exhaustive(duration);
  }
}

function toNotationBase(duration: Duration): RhythmicValue['notation']['base'] {
  switch (duration) {
    case 'durationWhole':
      return 'whole';
    case 'durationHalf':
      return 'half';
    case 'durationQuarter':
      return 'quarter';
    case 'durationEighth':
      return 'eighth';
    case 'duration16th':
      return '16th';
    case 'duration32nd':
      return '32nd';
    default:
      return exhaustive(duration);
  }
}

function exhaustive(value: never): never {
  throw new Error(`Unhandled add-mode duration value: ${String(value)}`);
}
