import { PracticeTempoTimeline, type ResolvedPracticeTempoPlan } from '@/lib/practice/planning/tempo';

export type ScopeTiming = {
  scopeStartMs: number;
  scopeTerminalMs: number;
  nominalDurationMs: number;
};

export function resolveScopeTiming(
  scope: Pick<{ startTick: number; terminalTick: number }, 'startTick' | 'terminalTick'>,
  tempoPlan: ResolvedPracticeTempoPlan,
  scoreEndTick: number, ticksPerQuarter: number
): ScopeTiming {
  const timeline = new PracticeTempoTimeline(tempoPlan, scoreEndTick, ticksPerQuarter);
  const scopeStartMs = timeline.tickToTimeMs(scope.startTick);
  const scopeTerminalMs = timeline.tickToTimeMs(scope.terminalTick);
  return {
    scopeStartMs,
    scopeTerminalMs,
    nominalDurationMs: Math.max(0, scopeTerminalMs - scopeStartMs),
  };
}
