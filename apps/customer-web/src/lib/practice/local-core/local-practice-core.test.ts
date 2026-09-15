import { describe, expect, it } from 'vitest';

import canonicalArtifactJson from './__fixtures__/canonical-practice-score-artifact.json';
import {
  InMemoryPracticeSessionStore,
  ManualClock,
  ManualDurableClock,
  PerformancePracticeRuntime,
  PracticeTimebase,
  StepPracticeRuntime,
  countInContractAt,
  entryGroupEndBeat,
  type PracticeScoreArtifact,
  type StepVerifierObservation,
} from './index';

const artifact = canonicalArtifactJson as PracticeScoreArtifact;

function cloneArtifact(overrides: Partial<PracticeScoreArtifact> = {}): PracticeScoreArtifact {
  return structuredClone({ ...artifact, ...overrides });
}

function observation(
  runtime: StepPracticeRuntime,
  pitches?: string[],
  overrides: Partial<StepVerifierObservation> = {}
): StepVerifierObservation {
  const target = runtime.currentTarget();
  if (!target) {
    throw new Error('No current target.');
  }
  const attackOnsetTimeMs = overrides.attackOnsetTimeMs ?? target.activationBoundaryMs + 1;
  return {
    stepId: target.stepId,
    activationGeneration: target.activationGeneration,
    attackOnsetTimeMs,
    observedAttackPitches: pitches ?? target.attackPitches,
    confidence: 0.97,
    captureTimeMs: attackOnsetTimeMs,
    source: 'FAKE',
    ...overrides,
  };
}

describe('canonical PracticeScoreArtifact parity foundation', () => {
  it('uses the backend-produced artifact for STEP and CONTINUOUS from the same score domain', () => {
    expect(artifact.artifactId).toBe('practice-score-artifact-v1:0529eb0f2b5dfe1a');
    expect(artifact.expectedPracticeGroups.map((group) => group.pitches)).toEqual([
      ['C4'],
      ['C4'],
      ['G4'],
      ['A4', 'C5'],
      ['D5'],
    ]);
    expect(entryGroupEndBeat(artifact, artifact.expectedPracticeGroups[2].groupId)).toBe(4.5);
    expect(artifact.practiceAttackSteps[3]).toMatchObject({
      attackTargets: [{ pitch: 'A4' }, { pitch: 'C5' }],
      continuation: [{ pitch: 'G4' }],
    });
  });

  it('derives count-in from active meter rather than a hardcoded four beats', () => {
    expect(countInContractAt(artifact, 0)).toEqual({
      durationBeats: 3,
      pulses: 3,
      numerator: 3,
      denominator: 4,
    });
    expect(countInContractAt(artifact, 3)).toEqual({
      durationBeats: 3,
      pulses: 6,
      numerator: 6,
      denominator: 8,
    });
    expect(countInContractAt(cloneArtifact({ meterSegments: [] }), 0)).toMatchObject({
      durationBeats: 4,
      pulses: 4,
      numerator: 4,
      denominator: 4,
    });
  });
});

describe('local STEP practice runtime', () => {
  it('matches single notes and advances exactly once', () => {
    const runtime = new StepPracticeRuntime({ artifact, clock: new ManualClock() });

    const result = runtime.observe(observation(runtime));

    expect(result.kind).toBe('MATCH');
    expect(runtime.currentTarget()?.attackPitches).toEqual(['C4']);
    expect(runtime.currentTarget()?.stepId).toBe(artifact.practiceAttackSteps[1].stepId);
    expect(runtime.attemptHistory).toHaveLength(1);
  });

  it('keeps repeated-pitch stale attacks from satisfying the next activation', () => {
    const clock = new ManualClock(0);
    const runtime = new StepPracticeRuntime({ artifact, clock });
    const first = runtime.currentTarget();

    expect(runtime.observe(observation(runtime, ['C4'], { attackOnsetTimeMs: 0, captureTimeMs: 0 }))).toMatchObject({
      kind: 'MATCH',
    });
    const second = runtime.currentTarget();
    expect(second?.attackPitches).toEqual(['C4']);
    expect(second?.activationBoundaryMs).toBe(0);

    expect(runtime.observe({
      stepId: second?.stepId ?? '',
      activationGeneration: second?.activationGeneration ?? 1,
      attackOnsetTimeMs: 0,
      captureTimeMs: 50,
      observedAttackPitches: first?.attackPitches ?? ['C4'],
      confidence: 0.99,
      source: 'FAKE',
    })).toMatchObject({ kind: 'WAIT', reason: 'stale_attack' });

    clock.advance(10);
    expect(runtime.observe(observation(runtime, ['C4'], { attackOnsetTimeMs: 10, captureTimeMs: 10 }))).toMatchObject({
      kind: 'MATCH',
    });
  });

  it('matches chords only when the complete physical attack set is observed', () => {
    const runtime = new StepPracticeRuntime({
      artifact,
      clock: new ManualClock(),
      scope: {
        startGroupId: artifact.expectedPracticeGroups[3].groupId,
        endGroupId: artifact.expectedPracticeGroups[3].groupId,
      },
    });

    expect(runtime.observe(observation(runtime, ['A4']))).toMatchObject({
      kind: 'WAIT',
      reason: 'wrong_or_partial_attack_set',
    });
    expect(runtime.observe(observation(runtime, ['C5', 'A4']))).toMatchObject({ kind: 'MATCH' });
    expect(runtime.isCompleted).toBe(true);
  });

  it('waits on wrong note, no evidence, stale activation, stale step, and continuation-only evidence', () => {
    const runtime = new StepPracticeRuntime({ artifact, clock: new ManualClock() });
    const first = runtime.currentTarget();

    expect(runtime.observe(null)).toMatchObject({ kind: 'WAIT', reason: 'no_observation' });
    expect(runtime.observe(observation(runtime, ['D4']))).toMatchObject({
      kind: 'WAIT',
      reason: 'wrong_or_partial_attack_set',
    });
    expect(runtime.observe(observation(runtime, undefined, { activationGeneration: 999 }))).toMatchObject({
      kind: 'WAIT',
      reason: 'stale_activation',
    });
    runtime.observe(observation(runtime));
    expect(runtime.observe({
      stepId: first?.stepId ?? '',
      activationGeneration: first?.activationGeneration ?? 1,
      attackOnsetTimeMs: 100,
      observedAttackPitches: ['C4'],
      confidence: 0.99,
      captureTimeMs: 100,
      source: 'FAKE',
    })).toMatchObject({ kind: 'WAIT', reason: 'stale_step' });

    runtime.observe(observation(runtime));
    runtime.observe(observation(runtime, ['G4']));
    expect(runtime.currentTarget()?.continuationPitches).toEqual(['G4']);
    expect(runtime.observe(observation(runtime, ['G4']))).toMatchObject({
      kind: 'WAIT',
      reason: 'wrong_or_partial_attack_set',
    });
  });

  it('skip and reset invalidate previous asynchronous evidence', () => {
    const runtime = new StepPracticeRuntime({ artifact, clock: new ManualClock() });
    const skipped = runtime.currentTarget();

    expect(runtime.skip()).toMatchObject({ kind: 'SKIP' });
    expect(runtime.observe({
      stepId: skipped?.stepId ?? '',
      activationGeneration: skipped?.activationGeneration ?? 1,
      attackOnsetTimeMs: 10,
      observedAttackPitches: skipped?.attackPitches ?? [],
      confidence: 1,
      captureTimeMs: 10,
      source: 'FAKE',
    })).toMatchObject({ kind: 'WAIT', reason: 'stale_step' });

    const beforeReset = runtime.currentTarget();
    runtime.reset();
    expect(runtime.currentTarget()?.stepId).toBe(artifact.practiceAttackSteps[0].stepId);
    expect(runtime.observe({
      stepId: beforeReset?.stepId ?? '',
      activationGeneration: beforeReset?.activationGeneration ?? 1,
      attackOnsetTimeMs: 20,
      observedAttackPitches: beforeReset?.attackPitches ?? [],
      confidence: 1,
      captureTimeMs: 20,
      source: 'FAKE',
    })).toMatchObject({ kind: 'WAIT' });
  });

  it('restores scoped STEP snapshots with input source and validates artifact compatibility', () => {
    const clock = new ManualClock(42);
    const scoped = {
      startGroupId: artifact.expectedPracticeGroups[2].groupId,
      endGroupId: artifact.expectedPracticeGroups[3].groupId,
    };
    const runtime = new StepPracticeRuntime({
      artifact,
      clock,
      inputSource: 'MIDI',
      scope: scoped,
      localSessionId: 'local-step',
    });
    runtime.observe(observation(runtime, ['G4']));
    const snapshot = runtime.snapshot();

    const restored = new StepPracticeRuntime({ artifact, clock, inputSource: 'MIDI', snapshot });
    expect(restored.currentTarget()?.stepId).toBe(artifact.practiceAttackSteps[3].stepId);
    expect(restored.snapshot().practiceScope).toEqual(scoped);
    expect(restored.snapshot().inputSource).toBe('MIDI');

    expect(() => new StepPracticeRuntime({
      artifact: cloneArtifact({ revisionId: 'other-revision' }),
      clock,
      snapshot,
    })).toThrow(/snapshot does not belong/);
    expect(() => new StepPracticeRuntime({
      artifact,
      clock,
      snapshot: {
        ...snapshot,
        version: { schemaVersion: 1, runtimeVersion: 'future-runtime' },
      },
    })).toThrow(/Unsupported/);
  });

  it('re-establishes STEP activation after restore under a new monotonic clock origin', () => {
    const oldClock = new ManualClock(100_000);
    const runtime = new StepPracticeRuntime({ artifact, clock: oldClock });
    runtime.observe(observation(runtime, ['C4'], { attackOnsetTimeMs: 100_010, captureTimeMs: 100_010 }));
    const snapshot = runtime.snapshot();
    expect(snapshot.step.activationGeneration).toBe(2);

    const restored = new StepPracticeRuntime({ artifact, clock: new ManualClock(0), snapshot });
    const restoredTarget = restored.currentTarget();
    expect(restoredTarget).toMatchObject({
      stepId: artifact.practiceAttackSteps[1].stepId,
      activationGeneration: 3,
      activationBoundaryMs: 0,
    });

    expect(restored.observe({
      stepId: restoredTarget?.stepId ?? '',
      activationGeneration: snapshot.step.activationGeneration,
      attackOnsetTimeMs: 100_020,
      observedAttackPitches: ['C4'],
      confidence: 1,
      captureTimeMs: 100_020,
      source: 'FAKE',
    })).toMatchObject({ kind: 'WAIT', reason: 'stale_activation' });

    expect(restored.observe(observation(restored, ['C4'], { attackOnsetTimeMs: 200, captureTimeMs: 200 }))).toMatchObject({
      kind: 'MATCH',
    });
  });
});

describe('local CONTINUOUS practice runtime', () => {
  it('runs READY -> COUNT_IN -> RUNNING and supports explicit zero count-in', () => {
    const clock = new ManualClock(0);
    const runtime = new PerformancePracticeRuntime({ artifact, clock });

    expect(runtime.snapshot().state).toBe('READY');
    expect(runtime.start()).toMatchObject({
      state: 'COUNT_IN',
      countInBeats: 3,
      countInPulses: 3,
      countInRemainingMs: 1500,
    });
    clock.advance(1_500);
    expect(runtime.snapshot().state).toBe('RUNNING');

    const zero = new PerformancePracticeRuntime({ artifact, clock: new ManualClock(0), countInBeats: 0 });
    expect(zero.start().state).toBe('RUNNING');
  });

  it('converts beat/time across tempo changes and ends at tied scope terminal beats', () => {
    const clock = new ManualClock(0);
    const runtime = new PerformancePracticeRuntime({
      artifact,
      clock,
      countInBeats: 0,
      scope: {
        startGroupId: artifact.expectedPracticeGroups[2].groupId,
        endGroupId: artifact.expectedPracticeGroups[2].groupId,
      },
    });

    expect(runtime.start()).toMatchObject({
      scopeStartBeat: 2,
      scopeTerminalBeat: 4.5,
    });
    clock.advance(500);
    expect(runtime.snapshot().musicalBeat).toBe(3);
    clock.advance(1_000);
    expect(runtime.snapshot()).toMatchObject({ state: 'ENDED', musicalBeat: 4.5 });
  });

  it('pauses, resumes, and maps delayed pre-pause evidence to original capture position', () => {
    const clock = new ManualClock(0);
    const runtime = new PerformancePracticeRuntime({ artifact, clock, countInBeats: 0 });
    runtime.start();
    clock.advance(200);
    const capturedAt = clock.nowMs();
    clock.advance(100);
    const paused = runtime.pause();
    clock.advance(5_000);
    expect(runtime.snapshot().musicalBeat).toBe(paused.musicalBeat);
    runtime.resume();
    clock.advance(500);

    const evaluated = runtime.observeEvidence({
      captureTimeMs: capturedAt,
      inferenceCompletedAtMs: clock.nowMs(),
      pitches: ['C4'],
      confidence: 1,
      source: 'FAKE',
    });
    expect(evaluated.performanceTimeMs).toBe(200);
    expect(evaluated.musicalBeat).toBe(0.4);
    expect(runtime.snapshot().musicalBeat).toBeGreaterThan(evaluated.musicalBeat);
  });

  it('evaluates single notes, chords, missing notes, extra notes, partial chords, and timing offsets downstream of the clock', () => {
    const clock = new ManualClock(0);
    const runtime = new PerformancePracticeRuntime({ artifact, clock, countInBeats: 0 });
    runtime.start();
    runtime.observeEvidence({ captureTimeMs: 0, pitches: ['C4'], confidence: 1, source: 'MIDI' });
    runtime.observeEvidence({ captureTimeMs: 500, pitches: ['C4'], confidence: 1, source: 'MIDI' });
    runtime.observeEvidence({ captureTimeMs: 1_000, pitches: ['G4'], confidence: 1, source: 'MIDI' });
    runtime.observeEvidence({ captureTimeMs: 1_500, pitches: ['A4'], confidence: 0.8, source: 'MIDI' });
    runtime.observeEvidence({ captureTimeMs: 1_700, pitches: ['D#5'], confidence: 0.7, source: 'MIDI' });

    const outcomes = runtime.evaluationOutcomes;
    expect(outcomes.map((outcome) => outcome.result)).toEqual([
      'MATCH',
      'MATCH',
      'MATCH',
      'MISMATCH',
      'NOT_OBSERVED',
    ]);
    expect(outcomes[3]).toMatchObject({
      unexpectedPitches: ['D#5'],
      timingOffsetMs: 0,
    });
    expect(runtime.snapshot().state).toBe('RUNNING');

    const partial = new PerformancePracticeRuntime({ artifact, clock: new ManualClock(0), countInBeats: 0 });
    partial.start();
    partial.observeEvidence({ captureTimeMs: 1_500, pitches: ['A4'], confidence: 1, source: 'MIDI' });
    expect(partial.evaluationOutcomes[3]).toMatchObject({
      result: 'PARTIAL',
      expectedStrikeOutcomes: [
        { pitch: 'A4', result: 'MATCHED' },
        { pitch: 'C5', result: 'MISSING' },
      ],
      timingOffsetMs: 0,
    });
  });

  it('restores running/count-in sessions as paused logical state under a new clock origin', () => {
    const runningClock = new ManualClock(0);
    const running = new PerformancePracticeRuntime({
      artifact,
      clock: runningClock,
      inputSource: 'MIDI',
      countInBeats: 0,
      scope: {
        startGroupId: artifact.expectedPracticeGroups[1].groupId,
        endGroupId: artifact.expectedPracticeGroups[3].groupId,
      },
    });
    running.start();
    runningClock.advance(500);
    const snapshot = running.snapshotSession();

    const restored = new PerformancePracticeRuntime({
      artifact,
      clock: new ManualClock(100_000),
      inputSource: 'MIDI',
      snapshot,
    });
    expect(restored.snapshot()).toMatchObject({
      state: 'PAUSED',
      performanceTimeMs: 500,
      scopeStartBeat: 1,
      scopeTerminalBeat: 4.5,
    });
    expect(restored.snapshotSession().inputSource).toBe('MIDI');
    restored.resume();
    expect(restored.snapshot().state).toBe('RUNNING');

    const countInClock = new ManualClock(0);
    const countIn = new PerformancePracticeRuntime({ artifact, clock: countInClock });
    countIn.start();
    countInClock.advance(250);
    const restoredCountIn = new PerformancePracticeRuntime({
      artifact,
      clock: new ManualClock(5_000),
      snapshot: countIn.snapshotSession(),
    });
    expect(restoredCountIn.snapshot()).toMatchObject({
      state: 'PAUSED',
      countInRemainingMs: 1250,
    });
  });

  it('preserves READY PAUSED and ENDED restore states explicitly', () => {
    const ready = new PerformancePracticeRuntime({ artifact, clock: new ManualClock(0) });
    expect(new PerformancePracticeRuntime({
      artifact,
      clock: new ManualClock(5_000),
      snapshot: ready.snapshotSession(),
    }).snapshot().state).toBe('READY');

    const pausedClock = new ManualClock(0);
    const paused = new PerformancePracticeRuntime({ artifact, clock: pausedClock, countInBeats: 0 });
    paused.start();
    pausedClock.advance(100);
    paused.pause();
    expect(new PerformancePracticeRuntime({
      artifact,
      clock: new ManualClock(10_000),
      snapshot: paused.snapshotSession(),
    }).snapshot()).toMatchObject({ state: 'PAUSED', performanceTimeMs: 100 });

    const endedClock = new ManualClock(0);
    const ended = new PerformancePracticeRuntime({ artifact, clock: endedClock, countInBeats: 0 });
    ended.start();
    endedClock.advance(10_000);
    ended.snapshot();
    expect(new PerformancePracticeRuntime({
      artifact,
      clock: new ManualClock(20_000),
      snapshot: ended.snapshotSession(),
    }).snapshot().state).toBe('ENDED');
  });

  it('keeps durable metadata time separate from runtime monotonic time', () => {
    const runtimeClock = new ManualClock(10_000);
    const metadataClock = new ManualDurableClock(1_000_000);
    const runtime = new PerformancePracticeRuntime({
      artifact,
      clock: runtimeClock,
      metadataClock,
      countInBeats: 0,
    });
    const first = runtime.snapshotSession();
    metadataClock.advance(5_000);
    runtimeClock.advance(100);
    const second = runtime.snapshotSession();

    expect(second.createdAtMs).toBe(first.createdAtMs);
    expect(second.updatedAtMs).toBe(1_005_000);
    expect(second.performance.activeElapsedMs).toBe(0);
  });

  it('preserves observation source and outcomes across persistence', () => {
    const clock = new ManualClock(0);
    const runtime = new PerformancePracticeRuntime({
      artifact,
      clock,
      inputSource: 'MIDI',
      countInBeats: 0,
    });
    runtime.start();
    runtime.observeEvidence({ captureTimeMs: 0, pitches: ['C4'], confidence: 1, source: 'MIDI' });
    const uninterruptedOutcomes = runtime.evaluationOutcomes;

    const restored = new PerformancePracticeRuntime({
      artifact,
      clock: new ManualClock(10_000),
      inputSource: 'MIDI',
      snapshot: runtime.snapshotSession(),
    });
    expect(restored.evaluationObservations[0]?.source).toBe('MIDI');
    expect(restored.evaluationOutcomes).toEqual(uninterruptedOutcomes);
    restored.resume();
    restored.observeEvidence({ captureTimeMs: 10_500, pitches: ['C4'], confidence: 1, source: 'MIDI' });
    expect(restored.evaluationObservations.map((item) => item.source)).toEqual(['MIDI', 'MIDI']);
  });

  it('rejects incompatible performance snapshots', () => {
    const runtime = new PerformancePracticeRuntime({ artifact, clock: new ManualClock(), inputSource: 'MIDI' });
    const snapshot = runtime.snapshotSession();

    expect(() => new PerformancePracticeRuntime({
      artifact: cloneArtifact({ artifactId: 'other-artifact' }),
      clock: new ManualClock(),
      snapshot,
    })).toThrow(/snapshot does not belong/);
    expect(() => new PerformancePracticeRuntime({
      artifact,
      clock: new ManualClock(),
      inputSource: 'MICROPHONE',
      snapshot,
    })).toThrow(/input source mismatch/);
  });
});

describe('local session foundation', () => {
  it('persists and restores local session snapshots without backend sessions or WebSockets', () => {
    const store = new InMemoryPracticeSessionStore();
    const runtime = new StepPracticeRuntime({
      artifact,
      clock: new ManualClock(42),
      localSessionId: 'local-session-1',
    });

    runtime.observe(observation(runtime));
    store.save(runtime.snapshot());

    const saved = store.load('local-session-1');
    const restored = new StepPracticeRuntime({
      artifact,
      clock: new ManualClock(100),
      snapshot: saved && saved.mode === 'STEP_BY_STEP' ? saved : undefined,
    });
    expect(restored.currentTarget()?.stepId).toBe(artifact.practiceAttackSteps[1].stepId);
  });

  it('defines one comparable local session timebase for runtime and sample-index evidence', () => {
    const timebase = new PracticeTimebase(1_000, 16_000);

    expect(timebase.runtimeToSessionTime(1_250)).toEqual({ sessionTimeMs: 250 });
    expect(timebase.sampleIndexToSessionTime(3_200)).toEqual({
      sessionTimeMs: 200,
      sampleIndex: 3_200,
    });
    expect(() => timebase.assertSameSessionTimeDomain(
      timebase.runtimeToSessionTime(1_250),
      timebase.sampleIndexToSessionTime(3_200)
    )).not.toThrow();
  });

  it('rejects empty artifacts before local practice instead of inventing playable state', () => {
    const empty = cloneArtifact({
      artifactId: 'empty-artifact',
      firstPlayableBeat: null,
      scoreEndBeat: 0,
      playableEvents: [],
      expectedPracticeGroups: [],
      practiceAttackSteps: [],
    });
    expect(() => new StepPracticeRuntime({ artifact: empty, clock: new ManualClock() })).toThrow(/at least one expected group/);
    expect(() => new PerformancePracticeRuntime({ artifact: empty, clock: new ManualClock() })).toThrow(/at least one expected group/);
  });
});
