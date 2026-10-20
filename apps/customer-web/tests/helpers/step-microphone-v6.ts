import { expect } from 'vitest';
import fixture from '../../src/lib/practice/local-core/__fixtures__/canonical-practice-score-artifact.json';
import type { PracticeScoreArtifact } from '../../src/lib/practice/local-core/artifact';
import { StepPracticeRuntime } from '../../src/lib/practice/local-core/step-runtime';
import { ManualClock } from '../../src/lib/practice/local-core/timebase';

/** Current domain port for sealed, score-blind historical assembly fixtures, not their old scoring adapters. */
export function microphoneV6(expected: readonly string[], initialBoundaryMs: number) {
  const base = fixture as PracticeScoreArtifact;
  const artifact: PracticeScoreArtifact = { ...base,
    expectedPracticeGroups: base.expectedPracticeGroups.map(group => ({ ...group, pitches: [...expected],
      strikeTargets: expected.map(pitch => ({ ...group.strikeTargets[0], pitch })) })),
    practiceAttackSteps: base.practiceAttackSteps.map(step => ({ ...step,
      attackTargets: expected.map(pitch => ({ ...step.attackTargets[0], pitch })) })) };
  const domainId = 'current-v6-fixture', clock = new ManualClock(0);
  const time = (ms: number) => ({ domainId, ms });
  const runtime = new StepPracticeRuntime({ artifact, scope: { kind: 'FULL' }, inputSource: 'MICROPHONE',
    localSessionId: domainId, clock, metadataClock: { nowEpochMs: () => 0 } });
  runtime.setInputUnavailable();
  expect(runtime.openAttempt(time(initialBoundaryMs + 1))).toBeNull();
  runtime.acceptInputAfter(time(initialBoundaryMs));
  expect(runtime.canAcceptAttempt).toBe(true);

  function complete(seal: { anchorMs: number; endMs: number; pitches: readonly string[]; confidence: number }, capturedMs: number) {
    const identity = runtime.openAttempt(time(seal.anchorMs));
    expect(identity).not.toBeNull();
    expect(runtime.openAttempt(time(seal.anchorMs + 1))).toBeNull();
    expect(runtime.analyzeAttempt(identity!)).toBe(true);
    expect(runtime.openAttempt(time(seal.endMs + 1))).toBeNull();
    const result = runtime.completeAttempt(identity!, { kind: 'EVIDENCE', observedAttackPitches: seal.pitches,
      confidence: seal.confidence, captureEndSessionTime: time(seal.endMs) });
    expect(result.kind).toBe('FINALIZED');
    if (result.kind !== 'FINALIZED') throw new Error('CURRENT_V6_REJECTED_SEAL');
    expect(runtime.snapshot().step.attemptState).toBe('POST_VERDICT');
    expect(runtime.currentStepIndex).toBe(0);
    expect(runtime.openAttempt(time(capturedMs + 1))).toBeNull();
    runtime.rearm(time(capturedMs));
    expect(runtime.canAcceptAttempt).toBe(true);
    expect(runtime.openAttempt(time(capturedMs))).toBeNull();
    return result.record;
  }
  return { runtime, time, complete };
}
