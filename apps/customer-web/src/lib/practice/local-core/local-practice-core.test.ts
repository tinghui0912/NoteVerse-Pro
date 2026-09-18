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
  resolvePracticeTempoPlan,
  type PracticeScoreArtifact,
  type SessionTime,
  type StepVerifierObservation,
} from './index';

const artifact = canonicalArtifactJson as PracticeScoreArtifact;
const defaultTempoPlan = resolvePracticeTempoPlan(artifact, { mode: 'SCORE' });

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
  const attackOnsetTime = overrides.attackOnsetTime ?? {
    ...target.activationBoundary,
    ms: target.activationBoundary.ms + 1,
  };
  return {
    stepId: target.stepId,
    activationGeneration: target.activationGeneration,
    attackOnsetTime,
    observedAttackPitches: pitches ?? target.attackPitches,
    confidence: 0.97,
    captureTime: attackOnsetTime,
    source: 'FAKE',
    ...overrides,
  };
}

function sessionTime(domainId: string, ms: number, sampleIndex?: number): SessionTime {
  return sampleIndex === undefined ? { domainId, ms } : { domainId, ms, sampleIndex };
}

function withMs(time: SessionTime | undefined, ms: number): SessionTime {
  return { ...(time ?? sessionTime('', 0)), ms };
}

function performanceEvidence(
  domainId: string,
  ms: number,
  pitches: string[],
  source: 'ACOUSTIC' | 'MIDI' | 'FAKE' = 'MIDI',
  overrides: Record<string, unknown> = {}
) {
  return {
    captureTime: sessionTime(domainId, ms),
    pitches,
    confidence: 1,
    source,
    ...overrides,
  };
}

describe('canonical PracticeScoreArtifact parity foundation', () => {
  it('uses the backend-produced artifact for STEP and CONTINUOUS from the same score domain', () => {
    expect(artifact.schemaVersion).toBe(2);
    expect(artifact.artifactId).toBe('practice-score-artifact-v2:a6e6c1b2d2e277e3');
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

    expect(runtime.observe(observation(runtime, ['C4'], {
      attackOnsetTime: withMs(first?.activationBoundary, 0),
      captureTime: withMs(first?.activationBoundary, 0),
    }))).toMatchObject({
      kind: 'MATCH',
    });
    const second = runtime.currentTarget();
    expect(second?.attackPitches).toEqual(['C4']);
    expect(second?.activationBoundary.ms).toBe(0);

    expect(runtime.observe({
      stepId: second?.stepId ?? '',
      activationGeneration: second?.activationGeneration ?? 1,
      attackOnsetTime: second?.activationBoundary ?? sessionTime('', 0),
      captureTime: { ...(second?.activationBoundary ?? sessionTime('', 0)), ms: 50 },
      observedAttackPitches: first?.attackPitches ?? ['C4'],
      confidence: 0.99,
      source: 'FAKE',
    })).toMatchObject({ kind: 'WAIT', reason: 'stale_attack' });

    clock.advance(10);
    expect(runtime.observe(observation(runtime, ['C4'], {
      attackOnsetTime: withMs(second?.activationBoundary, 10),
      captureTime: withMs(second?.activationBoundary, 10),
    }))).toMatchObject({
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
      attackOnsetTime: { ...(first?.activationBoundary ?? sessionTime('', 0)), ms: 100 },
      observedAttackPitches: ['C4'],
      confidence: 0.99,
      captureTime: { ...(first?.activationBoundary ?? sessionTime('', 0)), ms: 100 },
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
      attackOnsetTime: { ...(skipped?.activationBoundary ?? sessionTime('', 0)), ms: 10 },
      observedAttackPitches: skipped?.attackPitches ?? [],
      confidence: 1,
      captureTime: { ...(skipped?.activationBoundary ?? sessionTime('', 0)), ms: 10 },
      source: 'FAKE',
    })).toMatchObject({ kind: 'WAIT', reason: 'stale_step' });

    const beforeReset = runtime.currentTarget();
    runtime.reset();
    expect(runtime.currentTarget()?.stepId).toBe(artifact.practiceAttackSteps[0].stepId);
    expect(runtime.observe({
      stepId: beforeReset?.stepId ?? '',
      activationGeneration: beforeReset?.activationGeneration ?? 1,
      attackOnsetTime: { ...(beforeReset?.activationBoundary ?? sessionTime('', 0)), ms: 20 },
      observedAttackPitches: beforeReset?.attackPitches ?? [],
      confidence: 1,
      captureTime: { ...(beforeReset?.activationBoundary ?? sessionTime('', 0)), ms: 20 },
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
    const firstTarget = runtime.currentTarget();
    runtime.observe(observation(runtime, ['C4'], {
      attackOnsetTime: { ...(firstTarget?.activationBoundary ?? sessionTime('', 0)), ms: 100_010 },
      captureTime: { ...(firstTarget?.activationBoundary ?? sessionTime('', 0)), ms: 100_010 },
    }));
    const snapshot = runtime.snapshot();
    expect(snapshot.step.activationGeneration).toBe(2);

    const restored = new StepPracticeRuntime({ artifact, clock: new ManualClock(0), snapshot });
    const restoredTarget = restored.currentTarget();
    expect(restoredTarget).toMatchObject({
      stepId: artifact.practiceAttackSteps[1].stepId,
      activationGeneration: 3,
      activationBoundary: { domainId: runtime.localSessionId, ms: 0 },
    });

    expect(restored.observe({
      stepId: restoredTarget?.stepId ?? '',
      activationGeneration: snapshot.step.activationGeneration,
      attackOnsetTime: sessionTime(runtime.localSessionId, 100_020),
      observedAttackPitches: ['C4'],
      confidence: 1,
      captureTime: sessionTime(runtime.localSessionId, 100_020),
      source: 'FAKE',
    })).toMatchObject({ kind: 'WAIT', reason: 'stale_activation' });

    expect(restored.observe(observation(restored, ['C4'], {
      attackOnsetTime: sessionTime(runtime.localSessionId, 200),
      captureTime: sessionTime(runtime.localSessionId, 200),
    }))).toMatchObject({
      kind: 'MATCH',
    });
  });
});

describe('local CONTINUOUS practice runtime', () => {
  it('runs READY -> COUNT_IN -> RUNNING and supports explicit zero count-in', () => {
    const clock = new ManualClock(0);
    const runtime = new PerformancePracticeRuntime({ artifact, tempoPlan: defaultTempoPlan, clock });

    expect(runtime.snapshot().state).toBe('READY');
    expect(runtime.start()).toMatchObject({
      state: 'COUNT_IN',
      countInBeats: 3,
      countInPulses: 3,
      countInRemainingMs: 1500,
    });
    clock.advance(1_500);
    expect(runtime.snapshot().state).toBe('RUNNING');

    const zero = new PerformancePracticeRuntime({ artifact, tempoPlan: defaultTempoPlan, clock: new ManualClock(0), countInBeats: 0 });
    expect(zero.start().state).toBe('RUNNING');
  });

  it('converts beat/time across tempo changes and ends at tied scope terminal beats', () => {
    const clock = new ManualClock(0);
    const runtime = new PerformancePracticeRuntime({
      artifact,
      tempoPlan: defaultTempoPlan,
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
    const runtime = new PerformancePracticeRuntime({
      artifact,
      tempoPlan: defaultTempoPlan,
      clock,
      countInBeats: 0,
      localSessionId: 'performance-delayed',
    });
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
      captureTime: sessionTime('performance-delayed', capturedAt),
      inferenceCompletedAtMs: clock.nowMs(),
      pitches: ['C4'],
      confidence: 1,
      source: 'FAKE',
    });
    expect(evaluated).not.toBeNull();
    expect(evaluated!.performanceTimeMs).toBe(200);
    expect(evaluated!.musicalBeat).toBe(0.4);
    expect(runtime.snapshot().musicalBeat).toBeGreaterThan(evaluated!.musicalBeat);
  });

  it('evaluates single notes, chords, missing notes, extra notes, partial chords, and timing offsets downstream of the clock', () => {
    const clock = new ManualClock(0);
    const runtime = new PerformancePracticeRuntime({
      artifact,
      tempoPlan: defaultTempoPlan,
      clock,
      countInBeats: 0,
      localSessionId: 'performance-eval',
    });
    runtime.start();
    runtime.observeEvidence(performanceEvidence('performance-eval', 0, ['C4']));
    runtime.observeEvidence(performanceEvidence('performance-eval', 500, ['C4']));
    runtime.observeEvidence(performanceEvidence('performance-eval', 1_000, ['G4']));
    runtime.observeEvidence(performanceEvidence('performance-eval', 1_500, ['A4'], 'MIDI', { confidence: 0.8 }));
    runtime.observeEvidence(performanceEvidence('performance-eval', 1_700, ['D#5'], 'MIDI', { confidence: 0.7 }));

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

    const partial = new PerformancePracticeRuntime({
      artifact,
      tempoPlan: defaultTempoPlan,
      clock: new ManualClock(0),
      countInBeats: 0,
      localSessionId: 'performance-partial',
    });
    partial.start();
    partial.observeEvidence(performanceEvidence('performance-partial', 1_500, ['A4']));
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
      tempoPlan: defaultTempoPlan,
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
    const countIn = new PerformancePracticeRuntime({ artifact, tempoPlan: defaultTempoPlan, clock: countInClock });
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
    const ready = new PerformancePracticeRuntime({ artifact, tempoPlan: defaultTempoPlan, clock: new ManualClock(0) });
    expect(new PerformancePracticeRuntime({
      artifact,
      clock: new ManualClock(5_000),
      snapshot: ready.snapshotSession(),
    }).snapshot().state).toBe('READY');

    const pausedClock = new ManualClock(0);
    const paused = new PerformancePracticeRuntime({ artifact, tempoPlan: defaultTempoPlan, clock: pausedClock, countInBeats: 0 });
    paused.start();
    pausedClock.advance(100);
    paused.pause();
    expect(new PerformancePracticeRuntime({
      artifact,
      clock: new ManualClock(10_000),
      snapshot: paused.snapshotSession(),
    }).snapshot()).toMatchObject({ state: 'PAUSED', performanceTimeMs: 100 });

    const endedClock = new ManualClock(0);
    const ended = new PerformancePracticeRuntime({ artifact, tempoPlan: defaultTempoPlan, clock: endedClock, countInBeats: 0 });
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
      tempoPlan: defaultTempoPlan,
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
      tempoPlan: defaultTempoPlan,
      clock,
      inputSource: 'MIDI',
      countInBeats: 0,
      localSessionId: 'performance-persist-midi',
    });
    runtime.start();
    runtime.observeEvidence(performanceEvidence('performance-persist-midi', 0, ['C4']));
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
    restored.observeEvidence(performanceEvidence('performance-persist-midi', 10_500, ['C4']));
    expect(restored.evaluationObservations.map((item) => item.source)).toEqual(['MIDI', 'MIDI']);
  });

  it('rejects incompatible performance snapshots', () => {
    const runtime = new PerformancePracticeRuntime({ artifact, tempoPlan: defaultTempoPlan, clock: new ManualClock(), inputSource: 'MIDI' });
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
    const timebase = new PracticeTimebase({
      domainId: 'session-domain',
      runtimeOriginMs: 1_000,
      sampleRateHz: 16_000,
      anchorSampleIndex: 8_000,
      anchorSessionTimeMs: 250,
    });

    expect(timebase.runtimeToSessionTime(1_250)).toEqual({ domainId: 'session-domain', ms: 250 });
    expect(timebase.sampleIndexToSessionTime(8_000)).toEqual({
      domainId: 'session-domain',
      ms: 250,
      sampleIndex: 8_000,
    });
    expect(timebase.sampleIndexToSessionTime(9_600)).toEqual({
      domainId: 'session-domain',
      ms: 350,
      sampleIndex: 9_600,
    });
    expect(timebase.sampleIndexToSessionTime(6_400)).toEqual({
      domainId: 'session-domain',
      ms: 150,
      sampleIndex: 6_400,
    });
    expect(() => timebase.assertSameSessionTimeDomain(
      timebase.runtimeToSessionTime(1_250),
      timebase.sampleIndexToSessionTime(8_000)
    )).not.toThrow();
    expect(() => timebase.assertSameSessionTimeDomain(
      timebase.runtimeToSessionTime(1_250),
      sessionTime('other-domain', 250)
    )).toThrow(/different practice time domains/);
  });

  it('rejects STEP evidence from the wrong session time domain even with the same numeric timestamp', () => {
    const runtime = new StepPracticeRuntime({
      artifact,
      clock: new ManualClock(0),
      localSessionId: 'step-domain-a',
    });
    const target = runtime.currentTarget();
    expect(target?.activationBoundary.ms).toBe(-1);

    expect(runtime.observe(observation(runtime, ['C4'], {
      attackOnsetTime: sessionTime('step-domain-b', 100),
      captureTime: sessionTime('step-domain-b', 100),
    }))).toMatchObject({ kind: 'WAIT', reason: 'stale_attack' });

    expect(runtime.observe(observation(runtime, ['C4'], {
      attackOnsetTime: sessionTime('step-domain-a', 100),
      captureTime: sessionTime('step-domain-a', 100),
    }))).toMatchObject({ kind: 'MATCH' });
  });

  it('normalizes acoustic sample timing and MIDI timing before local runtime consumption', () => {
    const acousticTimebase = new PracticeTimebase({
      domainId: 'normalized-acoustic',
      sampleRateHz: 16_000,
      anchorSampleIndex: 16_000,
      anchorSessionTimeMs: 500,
    });
    const runtime = new StepPracticeRuntime({
      artifact,
      clock: new ManualClock(0),
      localSessionId: 'normalized-acoustic',
      timebase: acousticTimebase,
    });
    const onset = acousticTimebase.sampleIndexToSessionTime(16_800);

    expect(runtime.observe(observation(runtime, ['C4'], {
      attackOnsetTime: onset,
      captureTime: onset,
      source: 'ACOUSTIC',
    }))).toMatchObject({ kind: 'MATCH' });

    const midiTimebase = new PracticeTimebase({ domainId: 'normalized-midi' });
    const performance = new PerformancePracticeRuntime({
      artifact,
      tempoPlan: defaultTempoPlan,
      clock: new ManualClock(0),
      countInBeats: 0,
      localSessionId: 'normalized-midi',
      inputSource: 'MIDI',
      timebase: midiTimebase,
    });
    performance.start();
    const evaluated = performance.observeEvidence({
      captureTime: midiTimebase.midiEventToSessionTime(500),
      pitches: ['C4'],
      confidence: 1,
      source: 'MIDI',
      inferenceCompletedAtMs: 5_000,
    });
    expect(evaluated).not.toBeNull();
    expect(evaluated!.performanceTimeMs).toBe(500);
    expect(evaluated!.source).toBe('MIDI');
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
    expect(() => new PerformancePracticeRuntime({ artifact: empty, tempoPlan: resolvePracticeTempoPlan(empty, { mode: 'SCORE' }), clock: new ManualClock() })).toThrow(/at least one expected group/);
  });

  it('supports STEP pause, resume, and explicit user end with strict completion semantics', () => {
    const clock = new ManualClock(100);
    const runtime = new StepPracticeRuntime({ artifact, clock });
    const target1 = runtime.currentTarget();
    expect(target1).not.toBeNull();
    expect(runtime.state).toBe('ACTIVE');
    expect(runtime.sessionCompletionReason).toBeNull();

    // Pause
    runtime.pause();
    expect(runtime.state).toBe('PAUSED');
    expect(runtime.currentTarget()).toBeNull();
    // Evidence during pause returns WAIT: stale_activation
    expect(runtime.observe({
      stepId: target1!.stepId,
      activationGeneration: target1!.activationGeneration,
      attackOnsetTime: { domainId: runtime.localSessionId, ms: 120 },
      observedAttackPitches: target1!.attackPitches,
      confidence: 1,
      captureTime: { domainId: runtime.localSessionId, ms: 120 },
      source: 'FAKE',
    })).toMatchObject({ kind: 'WAIT', reason: 'stale_activation' });

    // Resume
    clock.advance(50); // now 150
    runtime.resume();
    expect(runtime.state).toBe('ACTIVE');
    const target2 = runtime.currentTarget();
    expect(target2).not.toBeNull();
    expect(target2!.activationGeneration).toBeGreaterThan(target1!.activationGeneration);
    expect(target2!.activationBoundary.ms).toBe(150);

    // Old evidence prior to resume boundary cannot match
    expect(runtime.observe({
      stepId: target2!.stepId,
      activationGeneration: target2!.activationGeneration,
      attackOnsetTime: { domainId: runtime.localSessionId, ms: 140 },
      observedAttackPitches: target2!.attackPitches,
      confidence: 1,
      captureTime: { domainId: runtime.localSessionId, ms: 140 },
      source: 'FAKE',
    })).toMatchObject({ kind: 'WAIT', reason: 'stale_attack' });

    // User end()
    runtime.end();
    expect(runtime.state).toBe('ENDED');
    expect(runtime.sessionCompletionReason).toBe('STOPPED_BY_USER');
    expect(runtime.isCompleted).toBe(false);
    expect(runtime.currentTarget()).toBeNull();
  });

  it('sets SCOPE_COMPLETED on natural STEP completion', () => {
    const runtime = new StepPracticeRuntime({
      artifact,
      clock: new ManualClock(),
      scope: {
        startGroupId: artifact.expectedPracticeGroups[4].groupId,
        endGroupId: artifact.expectedPracticeGroups[4].groupId,
      },
    });
    expect(runtime.state).toBe('ACTIVE');
    const decision = runtime.observe(observation(runtime, ['D5']));
    expect(decision.kind).toBe('MATCH');
    expect(runtime.isCompleted).toBe(true);
    expect(runtime.state).toBe('ENDED');
    expect(runtime.sessionCompletionReason).toBe('SCOPE_COMPLETED');
    expect(runtime.snapshot().completionReason).toBe('SCOPE_COMPLETED');
  });

  it('supports CONTINUOUS user end vs SCOPE_COMPLETED natural completion', () => {
    const clock = new ManualClock(0);
    const tempoPlan = resolvePracticeTempoPlan(artifact, { mode: 'SCORE' });
    const runtime = new PerformancePracticeRuntime({ artifact, tempoPlan, clock, countInBeats: 0 });
    runtime.start();
    expect(runtime.snapshot().state).toBe('RUNNING');
    expect(runtime.snapshot().scopeCompleted).toBe(false);
    expect(runtime.sessionCompletionReason).toBeNull();

    // User end
    const endedSnapshot = runtime.end('STOPPED_BY_USER');
    expect(endedSnapshot.state).toBe('ENDED');
    expect(endedSnapshot.scopeCompleted).toBe(false);
    expect(endedSnapshot.completionReason).toBe('STOPPED_BY_USER');
    expect(runtime.sessionCompletionReason).toBe('STOPPED_BY_USER');

    // Natural scope completion
    const naturalRuntime = new PerformancePracticeRuntime({
      artifact,
      tempoPlan,
      clock: new ManualClock(0),
      countInBeats: 0,
      scope: {
        startGroupId: artifact.expectedPracticeGroups[0].groupId,
        endGroupId: artifact.expectedPracticeGroups[0].groupId,
      },
    });
    naturalRuntime.start();
    const naturalClock = (naturalRuntime as unknown as { clock: ManualClock }).clock;
    naturalClock.advance(10_000);
    const naturalSnapshot = naturalRuntime.snapshot();
    expect(naturalSnapshot.state).toBe('ENDED');
    expect(naturalSnapshot.scopeCompleted).toBe(true);
    expect(naturalSnapshot.completionReason).toBe('SCOPE_COMPLETED');
  });

  it('rejects observeEvidence when performance runtime is not RUNNING', () => {
    const clock = new ManualClock(0);
    const tempoPlan = resolvePracticeTempoPlan(artifact, { mode: 'SCORE' });
    const runtime = new PerformancePracticeRuntime({ artifact, tempoPlan, clock, countInBeats: 3 });
    // Before start: state is READY
    const evidence = performanceEvidence(runtime.timebase.domainId, 100, ['C4']);
    expect(runtime.observeEvidence(evidence)).toBeNull();

    // Start with count-in: state is COUNT_IN
    runtime.start();
    expect(runtime.snapshot().state).toBe('COUNT_IN');
    expect(runtime.observeEvidence(evidence)).toBeNull();

    // Advance past count-in into RUNNING
    clock.advance(runtime.snapshot().countInTotalMs + 10);
    expect(runtime.snapshot().state).toBe('RUNNING');
    expect(runtime.observeEvidence(evidence)).not.toBeNull();

    // Pause: state is PAUSED
    runtime.pause();
    expect(runtime.snapshot().state).toBe('PAUSED');
    expect(runtime.observeEvidence(evidence)).toBeNull();

    // End: state is ENDED
    runtime.end('STOPPED_BY_USER');
    expect(runtime.snapshot().state).toBe('ENDED');
    expect(runtime.observeEvidence(evidence)).toBeNull();
  });

  it('provides deterministic countInPulse and handles multi-tempo segments correctly', () => {
    const multiTempoArtifact = cloneArtifact({
      scoreTempoSegments: [
        { startBeat: 0, bpm: 120 },
        { startBeat: 4, bpm: 60 },
      ],
    });

    const clock = new ManualClock(0);
    const tempoPlan = resolvePracticeTempoPlan(multiTempoArtifact, { mode: 'SCORE' });
    const runtime = new PerformancePracticeRuntime({
      artifact: multiTempoArtifact,
      tempoPlan,
      clock,
      countInBeats: 3,
    });

    runtime.start();
    let snapshot = runtime.snapshot();
    expect(snapshot.state).toBe('COUNT_IN');
    expect(snapshot.countInPulses).toBe(3);
    expect(snapshot.countInPulse).toBe(1);

    // Advance through count-in pulses (at 120 bpm, quarter note is 500ms)
    clock.advance(550);
    snapshot = runtime.snapshot();
    expect(snapshot.countInPulse).toBe(2);

    clock.advance(500);
    snapshot = runtime.snapshot();
    expect(snapshot.countInPulse).toBe(3);

    // Complete count-in (total count-in = 1500ms for 3 beats at 120 bpm)
    clock.advance(500);
    snapshot = runtime.snapshot();
    expect(snapshot.state).toBe('RUNNING');
    expect(snapshot.performanceTimeMs).toBe(50);

    // From beat 0 to 4 is at 120 BPM (500ms/beat). 4 beats = 2000ms performance time.
    // Advance to performance time 2000ms (clock advances another 1950ms)
    clock.advance(1950);
    snapshot = runtime.snapshot();
    expect(snapshot.performanceTimeMs).toBe(2000);
    expect(snapshot.musicalBeat).toBeCloseTo(4.0, 2);

    // After beat 4, tempo is 60 BPM (1000ms/beat).
    // Advancing performance time by 1000ms should advance beat by 1.0 (to beat 5.0).
    clock.advance(1000);
    snapshot = runtime.snapshot();
    expect(snapshot.performanceTimeMs).toBe(3000);
    expect(snapshot.musicalBeat).toBeCloseTo(5.0, 2);
  });

  it('allows live metronome toggle on StepPracticeRuntime and PerformancePracticeRuntime snapshots', () => {
    const art = cloneArtifact();
    const clock = new ManualClock(100);

    const stepRuntime = new StepPracticeRuntime({
      artifact: art,
      clock,
      metronomeEnabled: false,
    });
    expect(stepRuntime.snapshot().metronomeEnabled).toBe(false);
    expect(stepRuntime.currentOnsetBeat).toBe(0);

    stepRuntime.setMetronomeEnabled(true);
    expect(stepRuntime.snapshot().metronomeEnabled).toBe(true);

    const perfRuntime = new PerformancePracticeRuntime({
      artifact: art,
      clock,
      metronomeEnabled: false,
    });
    expect(perfRuntime.snapshotSession().metronomeEnabled).toBe(false);

    perfRuntime.setMetronomeEnabled(true);
    expect(perfRuntime.snapshotSession().metronomeEnabled).toBe(true);
  });
});
