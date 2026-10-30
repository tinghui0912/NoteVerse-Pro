import type { MeterSegment } from '@/lib/practice/kernel/artifact';
import type { ResolvedPracticeTempoPlan } from '@/lib/practice/kernel/tempo';

/** Immutable musical projection of an admitted session; no browser resources. */
export type ResolvedMetronomePlan = Readonly<{
  mode: 'STEP' | 'CONTINUOUS';
  meterSegments: readonly Readonly<MeterSegment>[];
  tempoPlan: ResolvedPracticeTempoPlan;
  timelineEndBeat: number;
  scopeStartBeat: number;
  scopeEndBeat: number;
  initiallyEnabled: boolean;
}>;

export function resolveMetronomePlan(input: ResolvedMetronomePlan): ResolvedMetronomePlan {
  if (!['STEP', 'CONTINUOUS'].includes(input.mode) || typeof input.initiallyEnabled !== 'boolean'
    || !Number.isFinite(input.timelineEndBeat) || input.timelineEndBeat <= 0
    || !Number.isFinite(input.scopeStartBeat) || input.scopeStartBeat < 0
    || !Number.isFinite(input.scopeEndBeat) || input.scopeEndBeat < input.scopeStartBeat
    || input.scopeEndBeat > input.timelineEndBeat || !input.tempoPlan?.segments.length) {
    throw new Error('Invalid resolved metronome timing.');
  }
  const meterSegments = input.meterSegments.length ? input.meterSegments : [{ startBeat: 0,
    numerator: 4, denominator: 4, measureDurationBeats: 4, countInPulses: 4, source: 'DEFAULT_4_4' as const }];
  for (const segment of meterSegments) {
    if (!Number.isFinite(segment.startBeat) || segment.startBeat < 0
      || !Number.isFinite(segment.numerator) || segment.numerator <= 0
      || !Number.isFinite(segment.denominator) || segment.denominator <= 0
      || !Number.isFinite(segment.measureDurationBeats) || segment.measureDurationBeats <= 0) {
      throw new Error('Invalid metronome meter timing.');
    }
  }
  freeze(input.tempoPlan);
  return Object.freeze({ ...input, meterSegments: Object.freeze(meterSegments.map(segment => Object.freeze({ ...segment }))) });
}
function freeze(value: object): void {
  for (const child of Object.values(value)) if (child && typeof child === 'object') freeze(child);
  Object.freeze(value);
}
