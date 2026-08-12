import {
  toScoreEntity,
  type EditableEvent,
} from '@/lib/editor/editable-event';
import type { AccidentalValue, Blank, Duration, ScoreEntity } from '@/types/score-types';

export const PITCH_NAMES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
export const ACCIDENTALS: Array<{ value: AccidentalValue; symbol: string }> = [
  { value: 'flat-flat', symbol: 'bb' },
  { value: 'flat', symbol: 'b' },
  { value: 'natural', symbol: 'natural' },
  { value: 'sharp', symbol: '#' },
];
export const DURATIONS: Duration[] = [
  'durationWhole',
  'durationHalf',
  'durationQuarter',
  'durationEighth',
  'duration16th',
  'duration32nd',
];

export function splitPitch(pitch: string) {
  const match = pitch.match(/^([A-Ga-g])([#b]{0,2})(\d)$/);
  return {
    name: match?.[1] ?? 'C',
    accidental: match?.[2] ?? '',
    octave: match?.[3] ?? '4',
  };
}

export function updatePitchPart(
  pitch: string,
  part: 'name' | 'octave',
  value: string
) {
  const parsed = splitPitch(pitch);
  return part === 'name'
    ? `${value}${parsed.accidental}${parsed.octave}`
    : `${parsed.name}${parsed.accidental}${value}`;
}

export function accidentalPitchSuffix(accidental: AccidentalValue) {
  if (accidental === 'flat-flat') return 'bb';
  if (accidental === 'flat') return 'b';
  if (accidental === 'sharp') return '#';
  return '';
}

export function toEntityForSave(original: ScoreEntity, event: EditableEvent): ScoreEntity {
  if (original.type === 'blank' && event.pitches.length === 0) {
    return {
      ...(original as Blank),
      duration: event.duration,
      dotted: event.dotted,
    };
  }

  return toScoreEntity(event, original.meta);
}

export function getEntitySummaryPitch(
  entity: ScoreEntity,
  restLabel: string,
  blankLabel: string
): string {
  if (entity.type === 'note') return entity.pitch;
  if (entity.type === 'chord') return entity.pitches.join(' + ');
  if (entity.type === 'rest') return restLabel;
  return blankLabel;
}

export function getEntitySummaryIcon(entity: ScoreEntity): string {
  if (entity.type === 'rest') return 'rest';
  if (entity.type === 'chord') return 'chord';
  return 'note';
}
