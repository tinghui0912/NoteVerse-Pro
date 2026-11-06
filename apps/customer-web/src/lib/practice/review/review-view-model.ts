import type { ContinuousPerformanceResult } from '@/lib/practice/result/continuous-performance-result';

export function reviewViewModel(result: ContinuousPerformanceResult) {
  const totalSeconds = Math.max(0, Math.floor(result.activeElapsedMs / 1000));
  return {
    durationText: `${Math.floor(totalSeconds / 60)
      .toString()
      .padStart(2, '0')}:${(totalSeconds % 60).toString().padStart(2, '0')}`,
    tempo:
      result.executed.tempoPlan.selection.mode === 'CUSTOM_FIXED_BPM'
        ? {
            kind: 'CUSTOM_FIXED_BPM' as const,
            bpm: result.executed.tempoPlan.selection.bpm,
          }
        : { kind: 'SCORE' as const },
    scope: {
      label:
        result.executed.scope.kind === 'RANGE'
          ? ('scopeSection' as const)
          : ('scopeFull' as const),
      startTick: result.executed.scope.startTick,
      terminalTick: result.executed.scope.terminalTick,
    },
    inputSourceLabel:
      result.inputKind === 'MICROPHONE'
        ? ('inputSourceMic' as const)
        : ('inputSourceMidi' as const),
  };
}
