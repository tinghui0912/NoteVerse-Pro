import type { AccidentalValue, Duration } from '@/types/score-types';
import type {
  InspectorViewModel,
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
      duration: toLegacyDuration(viewModel.rhythm),
      dotted: viewModel.rhythm.notation.dots > 0,
      pitches: [],
      stemDirection: 'none',
      fingerings: [],
      accidentals: [],
    };
  }

  if (viewModel.kind === 'pitchedEvent') {
    return {
      duration: toLegacyDuration(viewModel.rhythm),
      dotted: viewModel.rhythm.notation.dots > 0,
      pitches: viewModel.notes.map((note) => toLegacyPitch(note.pitch)),
      stemDirection: toEditableStemDirection(viewModel.stemDirection),
      fingerings: viewModel.notes.map((note) => note.fingering ?? 'none'),
      accidentals: viewModel.notes.map((note) => toLegacyAccidental(note.accidental)),
    };
  }

  return null;
}

export function getDomainSelectionSummary(viewModel: InspectorViewModel): DomainSelectionSummary {
  return {
    measure: getTrailingNumber(String(getViewModelMeasureId(viewModel)), 1),
    voice: getTrailingNumber(String(viewModel.voiceId), 1),
    staffIndex: Math.max(0, getTrailingNumber(String(viewModel.staffId), 1) - 1),
  };
}

function getTrailingNumber(value: string, fallback: number): number {
  const match = value.match(/(\d+)$/);
  if (!match) return fallback;
  const parsed = Number.parseInt(match[1] ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getViewModelMeasureId(viewModel: InspectorViewModel): unknown {
  return viewModel.kind === 'timelineGap'
    ? viewModel.start.measureId
    : viewModel.position.measureId;
}

function toLegacyDuration(rhythm: RhythmicValue): Duration {
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

function toLegacyPitch(pitch: Pitch): string {
  return `${pitch.step}${toLegacyPitchSuffix(pitch.alter)}${pitch.octave}`;
}

function toLegacyPitchSuffix(alter: number | undefined): string {
  if (alter === -2) return 'bb';
  if (alter === -1) return 'b';
  if (alter === 1) return '#';
  if (alter === 2) return '##';
  return '';
}

function toLegacyAccidental(value: NoteAtom['accidental']): AccidentalValue | null | undefined {
  if (value === 'double-sharp') return undefined;
  return value;
}

function toEditableStemDirection(value: StemDirectionOverride | undefined): EditableEvent['stemDirection'] {
  return value === 'up' || value === 'down' ? value : 'none';
}

function exhaustive(value: never): never {
  throw new Error(`Unhandled domain Inspector view-model value: ${String(value)}`);
}
