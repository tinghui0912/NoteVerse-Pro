import type { CaptureTime } from './timebase';

export type CapturedAttack = CaptureTime & {
  pitch: string;
  confidence: number;
  source: 'ACOUSTIC' | 'MIDI';
  inferenceCompletedAtMs?: number;
};

export function normalizePitchSet(pitches: readonly string[]): string[] {
  return Array.from(new Set(pitches)).sort();
}

export function pitchSetsEqual(left: readonly string[], right: readonly string[]): boolean {
  return normalizePitchSet(left).join('\u001f') === normalizePitchSet(right).join('\u001f');
}
