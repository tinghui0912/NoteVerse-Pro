import type { AccidentalValue, Duration } from '@/components/editor/input-values';
import type {
  InspectorViewModel,
  ScoreDocument,
  NoteAtom,
  Pitch,
  RhythmicValue,
  StemDirectionOverride,
} from '@/lib/editor-domain';
import type { EditableEvent } from './event-inspector-editable-event';

export type DomainSelectionSummary = {
  measure: number;
  voice: number;
  staffIndex: number;
};

export function toEditableEventFromDomainInspectorViewModel(
  viewModel: InspectorViewModel,
): EditableEvent | null {
  if (viewModel.kind === 'explicitRest') {
    return {
      duration: toFormDuration(viewModel.rhythm),
      dotted: viewModel.rhythm.notation.dots > 0,
      pitches: [],
      stemDirection: 'none',
      fingerings: [],
      accidentals: [],
    };
  }

  if (viewModel.kind === 'pitchedEvent') {
    return {
      duration: toFormDuration(viewModel.rhythm),
      dotted: viewModel.rhythm.notation.dots > 0,
      pitches: viewModel.notes.map((note) => toFormPitch(note.pitch)),
      stemDirection: toEditableStemDirection(viewModel.stemDirection),
      fingerings: viewModel.notes.map((note) => note.fingering ?? 'none'),
      accidentals: viewModel.notes.map((note) => toFormAccidental(note.accidental)),
    };
  }

  return null;
}

export function getDomainSelectionSummary(
  viewModel: InspectorViewModel,
  document: ScoreDocument,
): DomainSelectionSummary {
  const measure = document.measures.find(
    (measure) => measure.id === getViewModelMeasureId(viewModel),
  );
  const voice = document.voices.find((voice) => voice.id === viewModel.voiceId);
  const staff = document.staves.find((staff) => staff.id === viewModel.staffId);
  if (!measure || !voice || !staff)
    throw new Error('Inspector identity is not in the current document.');
  return { measure: measure.number, voice: voice.number, staffIndex: staff.index };
}

function getViewModelMeasureId(viewModel: InspectorViewModel): unknown {
  return viewModel.kind === 'timelineGap'
    ? viewModel.start.measureId
    : viewModel.position.measureId;
}

function toFormDuration(rhythm: RhythmicValue): Duration {
  switch (rhythm.notation.base) {
    case 'whole':
      return 'durationWhole';
    case 'half':
      return 'durationHalf';
    case 'quarter':
      return 'durationQuarter';
    case 'eighth':
      return 'durationEighth';
    case '16th':
      return 'duration16th';
    case '32nd':
    case '64th':
      return 'duration32nd';
    default:
      return exhaustive(rhythm.notation.base);
  }
}

function toFormPitch(pitch: Pitch): string {
  return `${pitch.step}${toFormPitchSuffix(pitch.alter)}${pitch.octave}`;
}

function toFormPitchSuffix(alter: number | undefined): string {
  if (alter === -2) return 'bb';
  if (alter === -1) return 'b';
  if (alter === 1) return '#';
  if (alter === 2) return '##';
  return '';
}

function toFormAccidental(value: NoteAtom['accidental']): AccidentalValue | null | undefined {
  if (value === 'double-sharp') return undefined;
  return value;
}

function toEditableStemDirection(
  value: StemDirectionOverride | undefined,
): EditableEvent['stemDirection'] {
  return value === 'up' || value === 'down' ? value : 'none';
}

function exhaustive(value: never): never {
  throw new Error(`Unhandled domain Inspector view-model value: ${String(value)}`);
}
