/** The explicit Practice product domain: physical piano keys A0..C8, independent of source. */
export type PracticePianoKey = number;

export function isPracticePianoKey(value: unknown): value is PracticePianoKey {
  return typeof value === 'number' && Number.isInteger(value) && value >= 21 && value <= 108;
}
