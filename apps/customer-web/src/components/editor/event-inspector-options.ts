import type { AccidentalValue, Duration } from '@/types/score-types';

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
