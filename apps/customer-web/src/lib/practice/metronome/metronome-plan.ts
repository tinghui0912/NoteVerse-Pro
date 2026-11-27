import { scoreTick, ticksPerQuarter } from '@/lib/practice/score/score-time';
import { measureDurationTicks, type MeterSegment } from '@/lib/practice/score/artifact';
import type { ResolvedPracticeTempoPlan } from '@/lib/practice/planning/tempo';

/** Immutable musical projection of an admitted session; no browser resources. */
export type ResolvedMetronomePlan = Readonly<{
  ticksPerQuarter: number;
  mode: 'STEP' | 'CONTINUOUS';
  meterSegments: readonly Readonly<MeterSegment>[];
  tempoPlan: ResolvedPracticeTempoPlan;
  timelineEndTick: number;
  scopeStartTick: number;
  scopeEndTick: number;
  initiallyEnabled: boolean;
}>;

export function resolveMetronomePlan(input: ResolvedMetronomePlan): ResolvedMetronomePlan {
  ticksPerQuarter(input.ticksPerQuarter);
  for (const tick of [input.timelineEndTick, input.scopeStartTick, input.scopeEndTick]) scoreTick(tick);
  if (!['STEP', 'CONTINUOUS'].includes(input.mode) || typeof input.initiallyEnabled !== 'boolean'
    || !Number.isSafeInteger(input.timelineEndTick) || input.timelineEndTick <= 0
    || !Number.isSafeInteger(input.scopeStartTick) || input.scopeStartTick < 0
    || !Number.isSafeInteger(input.scopeEndTick) || input.scopeEndTick < input.scopeStartTick
    || input.scopeEndTick > input.timelineEndTick || !input.tempoPlan?.segments.length) {
    throw new Error('Invalid resolved metronome timing.');
  }
  const meterSegments = input.meterSegments;
  if (!meterSegments.length || meterSegments[0].startTick !== 0) throw new Error('Admitted initial meter timing required.');
  let previousTick = -Infinity;
  for (const segment of meterSegments) {
    if (!Number.isSafeInteger(segment.startTick) || segment.startTick < 0 || segment.startTick <= previousTick) {
      throw new Error('Invalid metronome meter chronology.');
    }
    measureDurationTicks(segment, input.ticksPerQuarter);
    previousTick = segment.startTick;
  }
  freeze(input.tempoPlan);
  return Object.freeze({ ...input, meterSegments: Object.freeze(meterSegments.map(segment => Object.freeze({ ...segment }))) });
}
function freeze(value: object): void {
  for (const child of Object.values(value)) if (child && typeof child === 'object') freeze(child);
  Object.freeze(value);
}
