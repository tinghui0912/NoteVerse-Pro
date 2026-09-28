import { PracticeTempoTimeline, type ResolvedPracticeTempoPlan } from './local-core/practice-tempo';

export type ScopeTiming = {
  scopeStartMs: number;
  scopeTerminalMs: number;
  nominalDurationMs: number;
};

export function resolveScopeTiming(
  scope: Pick<{ startBeat: number; terminalBeat: number }, 'startBeat' | 'terminalBeat'>,
  tempoPlan: ResolvedPracticeTempoPlan,
  scoreEndBeat: number
): ScopeTiming {
  const timeline = new PracticeTempoTimeline(tempoPlan, scoreEndBeat);
  const scopeStartMs = timeline.beatToTimeMs(scope.startBeat);
  const scopeTerminalMs = timeline.beatToTimeMs(scope.terminalBeat);
  return {
    scopeStartMs,
    scopeTerminalMs,
    nominalDurationMs: Math.max(0, scopeTerminalMs - scopeStartMs),
  };
}
