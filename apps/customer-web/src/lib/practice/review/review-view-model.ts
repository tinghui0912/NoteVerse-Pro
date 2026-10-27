import type { ContinuousPerformanceResult } from '@/lib/practice/result/continuous-performance-result';

export function reviewViewModel(result: ContinuousPerformanceResult) {
  const totalSeconds = Math.max(0, Math.floor(result.activeElapsedMs / 1000));
  return {
    durationText: `${Math.floor(totalSeconds / 60).toString().padStart(2, '0')}:${(totalSeconds % 60).toString().padStart(2, '0')}`,
    tempo: result.tempoPlan.selection.mode === 'CUSTOM_FIXED_BPM'
      ? { kind: 'CUSTOM_FIXED_BPM' as const, bpm: result.tempoPlan.selection.bpm }
      : { kind: 'SCORE' as const },
    scope: {
      label: result.scope.kind === 'RANGE' ? 'scopeSection' as const : 'scopeFull' as const,
      startBeat: result.scope.startBeat,
      terminalBeat: result.scope.terminalBeat,
    },
    inputSourceLabel: result.inputSource === 'MICROPHONE' ? 'inputSourceMic' as const : 'inputSourceMidi' as const,
  };
}
