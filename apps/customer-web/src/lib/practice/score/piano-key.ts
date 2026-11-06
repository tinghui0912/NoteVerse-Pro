import {
  PRACTICE_PIANO_KEY_MIN,
  PRACTICE_PIANO_KEY_MAX,
} from '@/lib/practice/contracts/generated/score-artifact';
/** The explicit Practice product domain: physical piano keys A0..C8, independent of source. */
export type PracticePianoKey = number;

export function isPracticePianoKey(value: unknown): value is PracticePianoKey {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= PRACTICE_PIANO_KEY_MIN &&
    value <= PRACTICE_PIANO_KEY_MAX
  );
}
