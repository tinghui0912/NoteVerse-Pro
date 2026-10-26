import type { ContinuousPerformanceResult } from '@/lib/practice/result/continuous-performance-result';

type TargetCard = Readonly<{ label: 'targetStrikes' | 'confirmedCorrectStrikes' | 'wrongStrikeCount' | 'missingStrikes'
  | 'detectedTargetNotes' | 'unconfirmedTargetNotes' | 'notReachedStrikes'; value: number;
  tone: 'target' | 'supported' | 'wrong' | 'neutral' }>;

export function reviewViewModel(result: ContinuousPerformanceResult) {
  const metrics = result.metrics;
  const targetCards: TargetCard[] = [{ label: 'targetStrikes', value: metrics.targetStrikeCount, tone: 'target' }];
  if (metrics.status === 'COMPLETE') {
    if (metrics.inputSource === 'MIDI') targetCards.push(
      { label: 'confirmedCorrectStrikes', value: metrics.correctStrikeCount, tone: 'supported' },
      { label: 'wrongStrikeCount', value: metrics.wrongStrikeCount, tone: 'wrong' },
      { label: 'missingStrikes', value: metrics.missingStrikeCount, tone: 'neutral' });
    else targetCards.push(
      { label: 'detectedTargetNotes', value: metrics.supportedStrikeCount, tone: 'supported' },
      { label: 'unconfirmedTargetNotes', value: metrics.unconfirmedStrikeCount, tone: 'neutral' });
    targetCards.push({ label: 'notReachedStrikes', value: metrics.notReachedStrikeCount, tone: 'neutral' });
  }
  const totalSeconds = Math.max(0, Math.floor(result.activeElapsedMs / 1000));
  return {
    metrics, targetCards,
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
