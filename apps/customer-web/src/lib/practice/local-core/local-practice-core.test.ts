import { describe, expect, it } from 'vitest';

import canonicalArtifactJson from './__fixtures__/canonical-practice-score-artifact.json';
import {
  ManualClock,
  ContinuousPracticeSession,
  PracticeTimebase,
  StepEvidenceSession,
  StepPracticeRuntime,
  countInContractAt,
  entryGroupEndBeat,
  resolvePracticeTempoPlan,
  resolvePracticeScope,
  effectiveScoreTempoAtBeat,
  type PracticeScoreArtifact,
  type SessionTime,
  type StepVerifierObservation,
} from './index';
import type { AcousticNoteEvent } from '../acoustic-inference';

const artifact = canonicalArtifactJson as PracticeScoreArtifact;
const defaultTempoPlan = resolvePracticeTempoPlan(artifact, { mode: 'SCORE' });
const testTargetVerificationPolicy = {
  gestureCoherenceMs: 170,
  requiredGestureLookbackMs: 170,
};

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
  source: 'ACOUSTIC' | 'MIDI' = 'MIDI',
  overrides: Record<string, unknown> = {}
) {
  return {
    captureTime: sessionTime(domainId, ms),
    pitch: pitches[0] ?? 'C4',
    confidence: 1,
    source,
    ...overrides,
  };
}

function acousticEvent(domainId: string, ms: number, pitch: string): AcousticNoteEvent {
  return {
    pitch,
    midiPitch: 60,
    onsetTime: sessionTime(domainId, ms),
    confidence: 0.95,
    onsetScore: 0.9,
    frameScore: 0.9,
    source: 'ACOUSTIC',
  };
}

describe('canonical PracticeScoreArtifact parity foundation', () => {
  it('uses the backend-produced artifact for STEP and CONTINUOUS from the same score domain', () => {
    expect(artifact.schemaVersion).toBe(1);
    expect(artifact.artifactId).toBe('practice-score-artifact:ec2262af8d689ffb');
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
    const runtime = new StepPracticeRuntime({ artifact, scope: { kind: 'FULL' },
      clock: new ManualClock() });

    const result = runtime.observe(observation(runtime));

    expect(result.kind).toBe('MATCH');
    expect(runtime.currentTarget()?.attackPitches).toEqual(['C4']);
    expect(runtime.currentTarget()?.stepId).toBe(artifact.practiceAttackSteps[1].stepId);
    expect(runtime.attemptHistory).toHaveLength(1);
  });

  it('uses accepted evidence time for MATCH attempts and next activation boundaries', () => {
    const clock = new ManualClock(10_000);
    const runtime = new StepPracticeRuntime({
      artifact,
      scope: { kind: 'FULL' },
      clock,
      localSessionId: 'event-time-step',
    });

    expect(runtime.observe(observation(runtime, ['C4'], {
      attackOnsetTime: sessionTime('event-time-step', 1_000),
      captureTime: sessionTime('event-time-step', 1_000),
    }))).toMatchObject({ kind: 'MATCH' });

    expect(runtime.attemptHistory[0].sessionTime).toEqual(sessionTime('event-time-step', 1_000));
    expect(runtime.currentTarget()?.activationBoundary).toEqual(sessionTime('event-time-step', 1_000));
  });

  it('lets the user wait arbitrarily before a correct STEP microphone event', () => {
    const clock = new ManualClock(0);
    const runtime = new StepPracticeRuntime({
      artifact,
      scope: { kind: 'FULL' },
      clock,
      localSessionId: 'long-wait-step',
    });
    const evidence = new StepEvidenceSession(runtime, testTargetVerificationPolicy);
    clock.advance(10_000);

    const result = evidence.publishAcousticEvents({
      sessionDomainId: 'long-wait-step',
      events: [acousticEvent('long-wait-step', 10_000, 'C4')],
      analyzedThroughSessionTimeMs: 10_200,
    });

    expect(result.decisions).toHaveLength(1);
    expect(result.decisions[0]).toMatchObject({ kind: 'MATCH' });
    expect(runtime.currentTarget()?.stepId).toBe(artifact.practiceAttackSteps[1].stepId);
  });

  it('advances multiple STEP targets from one delayed acoustic publication by event time', () => {
    const runtime = new StepPracticeRuntime({
      artifact,
      scope: { kind: 'FULL' },
      clock: new ManualClock(50_000),
      localSessionId: 'delayed-step-events',
    });
    const evidence = new StepEvidenceSession(runtime, testTargetVerificationPolicy);

    const result = evidence.publishAcousticEvents({
      sessionDomainId: 'delayed-step-events',
      events: [
        acousticEvent('delayed-step-events', 1_000, 'C4'),
        acousticEvent('delayed-step-events', 1_300, 'C4'),
        acousticEvent('delayed-step-events', 1_600, 'G4'),
      ],
      analyzedThroughSessionTimeMs: 1_800,
    });

    expect(result.decisions.map((decision) => decision.kind)).toEqual(['MATCH', 'MATCH', 'MATCH']);
    expect(runtime.currentTarget()?.attackPitches).toEqual(['A4', 'C5']);
    expect(runtime.attemptHistory.map((attempt) => attempt.sessionTime.ms)).toEqual([1_000, 1_300, 1_600]);
  });

  it('recognizes same-note retrigger across consecutive STEP targets before earlier inference would complete', () => {
    const runtime = new StepPracticeRuntime({
      artifact,
      scope: { kind: 'FULL' },
      clock: new ManualClock(2_100),
      localSessionId: 'same-note-retrigger-step',
    });
    const evidence = new StepEvidenceSession(runtime, testTargetVerificationPolicy);

    const result = evidence.publishAcousticEvents({
      sessionDomainId: 'same-note-retrigger-step',
      events: [
        acousticEvent('same-note-retrigger-step', 1_000, 'C4'),
        acousticEvent('same-note-retrigger-step', 1_400, 'C4'),
      ],
      analyzedThroughSessionTimeMs: 1_600,
    });

    expect(result.decisions.map((decision) => decision.kind)).toEqual(['MATCH', 'MATCH']);
    expect(runtime.currentTarget()?.attackPitches).toEqual(['G4']);
  });

  it('rejects STEP acoustic publications atomically when any event uses the wrong domain', () => {
    const runtime = new StepPracticeRuntime({
      artifact,
      scope: { kind: 'FULL' },
      clock: new ManualClock(0),
      localSessionId: 'atomic-step-domain',
    });
    const evidence = new StepEvidenceSession(runtime, testTargetVerificationPolicy);
    const beforeAttempts = runtime.attemptHistory.length;
    const beforeTarget = runtime.currentTarget();

    expect(() => evidence.publishAcousticEvents({
      sessionDomainId: 'atomic-step-domain',
      events: [
        acousticEvent('atomic-step-domain', 100, 'C4'),
        acousticEvent('other-step-domain', 120, 'C4'),
      ],
      analyzedThroughSessionTimeMs: 200,
    })).toThrow(/different session domain/);

    expect(runtime.attemptHistory).toHaveLength(beforeAttempts);
    expect(runtime.currentTarget()).toEqual(beforeTarget);
    expect(evidence.publishAcousticEvents({
      sessionDomainId: 'atomic-step-domain',
      events: [acousticEvent('atomic-step-domain', 100, 'C4')],
      analyzedThroughSessionTimeMs: 200,
    }).decisions.map((decision) => decision.kind)).toEqual(['MATCH']);
  });

  it('rejects STEP acoustic publications atomically when any event is after the analyzed frontier', () => {
    const runtime = new StepPracticeRuntime({
      artifact,
      scope: { kind: 'FULL' },
      clock: new ManualClock(0),
      localSessionId: 'atomic-step-frontier',
    });
    const evidence = new StepEvidenceSession(runtime, testTargetVerificationPolicy);
    const beforeAttempts = runtime.attemptHistory.length;
    const beforeTarget = runtime.currentTarget();

    expect(() => evidence.publishAcousticEvents({
      sessionDomainId: 'atomic-step-frontier',
      events: [
        acousticEvent('atomic-step-frontier', 100, 'C4'),
        acousticEvent('atomic-step-frontier', 250, 'C4'),
      ],
      analyzedThroughSessionTimeMs: 200,
    })).toThrow(/after the analyzed frontier/);

    expect(runtime.attemptHistory).toHaveLength(beforeAttempts);
    expect(runtime.currentTarget()).toEqual(beforeTarget);
    expect(evidence.publishAcousticEvents({
      sessionDomainId: 'atomic-step-frontier',
      events: [acousticEvent('atomic-step-frontier', 100, 'C4')],
      analyzedThroughSessionTimeMs: 200,
    }).decisions.map((decision) => decision.kind)).toEqual(['MATCH']);
  });

  it('prunes impossible unmatched STEP evidence by analysis frontier without dropping viable partial chords', () => {
    const runtime = new StepPracticeRuntime({
      artifact,
      clock: new ManualClock(0),
      localSessionId: 'frontier-step-domain',
      scope: {
        kind: 'RANGE',
        startGroupId: artifact.expectedPracticeGroups[3].groupId,
        endGroupId: artifact.expectedPracticeGroups[3].groupId,
      },
    });
    const evidence = new StepEvidenceSession(runtime, testTargetVerificationPolicy);

    const early = evidence.publishAcousticEvents({
      sessionDomainId: 'frontier-step-domain',
      events: [
        acousticEvent('frontier-step-domain', 100, 'F#4'),
        acousticEvent('frontier-step-domain', 250, 'A4'),
      ],
      analyzedThroughSessionTimeMs: 300,
    });
    expect(early.decisions).toEqual([]);
    expect(early.pendingEventCount).toBe(1);

    const later = evidence.publishAcousticEvents({
      sessionDomainId: 'frontier-step-domain',
      events: [],
      analyzedThroughSessionTimeMs: 500,
    });
    expect(later.pendingEventCount).toBe(0);
    expect(later.prunedEventCount).toBe(1);
  });

  it('rejects previous-generation delayed evidence after pause and resume', () => {
    const runtime = new StepPracticeRuntime({
      artifact,
      scope: { kind: 'FULL' },
      clock: new ManualClock(0),
      localSessionId: 'pause-generation-step',
    });
    const staleTarget = runtime.currentTarget();

    runtime.pause();
    runtime.resume();

    expect(runtime.observe({
      stepId: staleTarget?.stepId ?? '',
      activationGeneration: staleTarget?.activationGeneration ?? 1,
      attackOnsetTime: sessionTime('pause-generation-step', 100),
      captureTime: sessionTime('pause-generation-step', 100),
      observedAttackPitches: staleTarget?.attackPitches ?? ['C4'],
      confidence: 1,
      source: 'ACOUSTIC',
    })).toMatchObject({ kind: 'WAIT', reason: 'stale_activation' });
  });

  it('keeps repeated-pitch stale attacks from satisfying the next activation', () => {
    const clock = new ManualClock(0);
    const runtime = new StepPracticeRuntime({ artifact, scope: { kind: 'FULL' },
      clock });
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
        kind: 'RANGE',
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
    const runtime = new StepPracticeRuntime({ artifact, scope: { kind: 'FULL' },
      clock: new ManualClock() });
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
    const runtime = new StepPracticeRuntime({ artifact, scope: { kind: 'FULL' },
      clock: new ManualClock() });
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
      kind: 'RANGE' as const,
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

    const restored = new StepPracticeRuntime({
      artifact,
      scope: scoped,
      clock,
      inputSource: 'MIDI',
      snapshot,
    });
    expect(restored.currentTarget()?.stepId).toBe(artifact.practiceAttackSteps[3].stepId);
    expect(restored.snapshot().practiceScope).toEqual(scoped);
    expect(restored.snapshot().inputSource).toBe('MIDI');

    expect(() => new StepPracticeRuntime({
      artifact: cloneArtifact({ revisionId: 'other-revision' }),
      scope: { kind: 'FULL' },
      clock,
      snapshot,
    })).toThrow(/snapshot does not belong/);
    expect(() => new StepPracticeRuntime({
      artifact,
      scope: { kind: 'FULL' },
      clock,
      snapshot: {
        ...snapshot,
        version: { schemaVersion: 1, runtimeVersion: 'future-runtime' },
      },
    })).toThrow(/Unsupported/);
  });

  it('re-establishes STEP activation after restore under a new monotonic clock origin', () => {
    const oldClock = new ManualClock(100_000);
    const runtime = new StepPracticeRuntime({ artifact, scope: { kind: 'FULL' },
      clock: oldClock });
    const firstTarget = runtime.currentTarget();
    runtime.observe(observation(runtime, ['C4'], {
      attackOnsetTime: { ...(firstTarget?.activationBoundary ?? sessionTime('', 0)), ms: 100_010 },
      captureTime: { ...(firstTarget?.activationBoundary ?? sessionTime('', 0)), ms: 100_010 },
    }));
    const snapshot = runtime.snapshot();
    expect(snapshot.step.activationGeneration).toBe(2);

    const restored = new StepPracticeRuntime({ artifact, scope: { kind: 'FULL' },
      clock: new ManualClock(0), snapshot });
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
  it('keeps clock state separate from continuous evaluation state', () => {
    const clock = new ManualClock(0);
    const session = new ContinuousPracticeSession({
      artifact,
      tempoPlan: defaultTempoPlan,
      scope: { kind: 'FULL' },
      clock,
      inputSource: 'MIDI',
      countInBeats: 0,
      localSessionId: 'continuous-clock-separate',
    });

    expect(session.snapshot().state).toBe('READY');
    expect(session.evaluationSnapshot.strikes).toHaveLength(
      artifact.expectedPracticeGroups.reduce((sum, group) => sum + group.strikeTargets.length, 0)
    );
    expect(session.evaluationSnapshot.strikes.every((strike) => strike.verdict === 'PENDING')).toBe(true);

    session.start();
    clock.advance(500);
    const before = session.snapshot();
    expect(session.observeCapturedAttack(performanceEvidence('continuous-clock-separate', 0, ['C4'], 'MIDI'))).toBe(true);
    expect(session.snapshot().performanceTimeMs).toBe(before.performanceTimeMs);
    expect(session.evaluationSnapshot.strikes[0]).toMatchObject({ verdict: 'PENDING' });
    clock.advance(1_000);
    session.snapshot();
    expect(session.evaluationSnapshot.strikes[0]).toMatchObject({ verdict: 'MATCHED' });
  });

  it('advances MIDI analysis from performance clock time', () => {
    const clock = new ManualClock(0);
    const session = new ContinuousPracticeSession({
      artifact,
      tempoPlan: defaultTempoPlan,
      scope: { kind: 'FULL' },
      clock,
      inputSource: 'MIDI',
      countInBeats: 0,
      localSessionId: 'continuous-midi-frontier',
    });

    session.start();
    clock.advance(1_000);
    expect(session.snapshot().state).toBe('RUNNING');
    expect(session.evaluationSnapshot.strikes[0]).toMatchObject({ verdict: 'MISSING' });
  });

  it('does not advance MIDI frontier while paused', () => {
    const clock = new ManualClock(0);
    const session = new ContinuousPracticeSession({
      artifact,
      tempoPlan: defaultTempoPlan,
      scope: { kind: 'FULL' },
      clock,
      inputSource: 'MIDI',
      countInBeats: 0,
      localSessionId: 'continuous-midi-pause',
    });

    session.start();
    clock.advance(100);
    session.pause();
    clock.advance(5_000);
    expect(session.evaluationSnapshot.strikes[1]).toMatchObject({ verdict: 'PENDING' });
  });

  it('keeps extra attacks globally unique', () => {
    const twoGroupArtifact = {
      ...artifact,
      expectedPracticeGroups: artifact.expectedPracticeGroups.slice(0, 2).map((group, index) => ({
        ...group,
        onsetBeat: index === 0 ? 0 : 0.6,
      })),
      practiceAttackSteps: artifact.practiceAttackSteps.slice(0, 2).map((step, index) => ({
        ...step,
        onsetBeat: index === 0 ? 0 : 0.6,
      })),
    };
    const extraClock = new ManualClock(0);
    const session = new ContinuousPracticeSession({
      artifact: twoGroupArtifact,
      tempoPlan: defaultTempoPlan,
      scope: { kind: 'FULL' },
      clock: extraClock,
      inputSource: 'MIDI',
      countInBeats: 0,
      localSessionId: 'continuous-global-extra',
    });

    session.start();
    extraClock.advance(150);
    expect(session.observeCapturedAttack(performanceEvidence(session.timebase.domainId, 150, ['F#4'], 'MIDI'))).toBe(true);
    expect(session.evaluationSnapshot.extras).toHaveLength(0);
    extraClock.advance(500);
    session.snapshot();
    expect(session.evaluationSnapshot.extras).toHaveLength(1);
  });

  it('syncs natural clock auto-end into final continuous evaluation without explicit end', () => {
    const naturalClock = new ManualClock(0);
    const natural = new ContinuousPracticeSession({
      artifact,
      tempoPlan: defaultTempoPlan,
      scope: { kind: 'FULL' },
      clock: naturalClock,
      inputSource: 'MIDI',
      countInBeats: 0,
    });
    natural.start();
    naturalClock.advance(20_000);
    const snapshot = natural.snapshot();
    expect(snapshot.state).toBe('ENDED');
    expect(snapshot.completionReason).toBe('SCOPE_COMPLETED');
    const naturalEvaluation = natural.completedEvaluation();
    expect(naturalEvaluation.status).toBe('COMPLETE');
    if (naturalEvaluation.status === 'COMPLETE') {
      expect(naturalEvaluation.strikes.some((strike) => strike.result === 'NOT_REACHED')).toBe(false);
      expect(naturalEvaluation.strikes.some((strike) => strike.result === 'MISSING')).toBe(true);
    }
  });

  it('uses NOT_REACHED only for manual stop tails', () => {
    const manualClock = new ManualClock(0);
    const manual = new ContinuousPracticeSession({
      artifact,
      tempoPlan: defaultTempoPlan,
      scope: { kind: 'FULL' },
      clock: manualClock,
      inputSource: 'MIDI',
      countInBeats: 0,
    });
    manual.start();
    manualClock.advance(100);
    manual.end('STOPPED_BY_USER');
    const manualEvaluation = manual.completedEvaluation();
    expect(manualEvaluation).toEqual({
      status: 'UNAVAILABLE',
      reason: 'INCOMPLETE_ANALYSIS',
    });
  });

  it('fails closed when final evaluation still contains pending strikes', () => {
    const clock = new ManualClock(0);
    const session = new ContinuousPracticeSession({
      artifact,
      tempoPlan: defaultTempoPlan,
      scope: { kind: 'FULL' },
      clock,
      inputSource: 'MICROPHONE',
      countInBeats: 0,
    });
    session.start();
    clock.advance(1000);
    session.end('STOPPED_BY_USER');

    expect(session.completedEvaluation()).toEqual({
      status: 'UNAVAILABLE',
      reason: 'INCOMPLETE_ANALYSIS',
    });
  });

  it('keeps completion separate from future asynchronous analysis frontier', () => {
    const clock = new ManualClock(0);
    const session = new ContinuousPracticeSession({
      artifact,
      tempoPlan: defaultTempoPlan,
      scope: { kind: 'FULL' },
      clock,
      inputSource: 'MICROPHONE',
      countInBeats: 0,
    });
    session.start();
    clock.advance(1000);
    session.end('STOPPED_BY_USER');
    expect(session.evaluationSnapshot.strikes.some((strike) => strike.verdict === 'PENDING')).toBe(true);

    session.publishAnalysis({
      sessionDomainId: session.timebase.domainId,
      attacks: [],
      analyzedThroughPerformanceMs: 1000,
    });
    expect(session.evaluationSnapshot.strikes.some((strike) => strike.verdict === 'MISSING')).toBe(true);
  });

  it('rejects post-terminal analysis publication that moves the performance frontier backwards', () => {
    const clock = new ManualClock(0);
    const session = new ContinuousPracticeSession({
      artifact,
      tempoPlan: defaultTempoPlan,
      scope: { kind: 'FULL' },
      clock,
      inputSource: 'MICROPHONE',
      countInBeats: 0,
    });
    session.start();
    clock.advance(1000);
    session.end('STOPPED_BY_USER');

    session.publishAnalysis({
      sessionDomainId: session.timebase.domainId,
      attacks: [],
      analyzedThroughPerformanceMs: 1000,
    });
    const afterForward = session.evaluationSnapshot;
    expect(() => session.publishAnalysis({
      sessionDomainId: session.timebase.domainId,
      attacks: [],
      analyzedThroughPerformanceMs: 100,
    })).toThrow(/monotonic/);

    expect(session.evaluationSnapshot).toEqual(afterForward);
  });

  it('rejects cross-session analysis publication without mutating evaluation', () => {
    const clockA = new ManualClock(0);
    const sessionA = new ContinuousPracticeSession({
      artifact,
      tempoPlan: defaultTempoPlan,
      scope: { kind: 'FULL' },
      clock: clockA,
      inputSource: 'MICROPHONE',
      countInBeats: 0,
      localSessionId: 'analysis-session-a',
    });
    const clockB = new ManualClock(0);
    const sessionB = new ContinuousPracticeSession({
      artifact,
      tempoPlan: defaultTempoPlan,
      scope: { kind: 'FULL' },
      clock: clockB,
      inputSource: 'MICROPHONE',
      countInBeats: 0,
      localSessionId: 'analysis-session-b',
    });
    sessionA.start();
    sessionB.start();
    clockB.advance(1000);
    const before = sessionB.evaluationSnapshot;

    expect(() => sessionB.publishAnalysis({
      sessionDomainId: sessionA.timebase.domainId,
      attacks: [{
        captureTime: sessionA.timebase.atSessionMs(100),
        pitch: 'C4',
        confidence: 1,
        source: 'ACOUSTIC',
      }],
      analyzedThroughPerformanceMs: 1000,
    })).toThrow(/different session domain/);

    expect(sessionB.evaluationSnapshot).toEqual(before);
  });

  it('rejects attacks from the wrong capture domain before advancing analysis', () => {
    const clock = new ManualClock(0);
    const session = new ContinuousPracticeSession({
      artifact,
      tempoPlan: defaultTempoPlan,
      scope: { kind: 'FULL' },
      clock,
      inputSource: 'MICROPHONE',
      countInBeats: 0,
      localSessionId: 'analysis-session',
    });
    session.start();
    clock.advance(1000);
    const before = session.evaluationSnapshot;

    expect(() => session.publishAnalysis({
      sessionDomainId: session.timebase.domainId,
      attacks: [{
        captureTime: { domainId: 'wrong-domain', ms: 100 },
        pitch: 'C4',
        confidence: 1,
        source: 'ACOUSTIC',
      }],
      analyzedThroughPerformanceMs: 1000,
    })).toThrow(/different session domain/);

    expect(session.evaluationSnapshot).toEqual(before);
  });

  it('rejects mixed-domain analysis publications atomically before observing valid attacks', () => {
    const clock = new ManualClock(0);
    const session = new ContinuousPracticeSession({
      artifact,
      tempoPlan: defaultTempoPlan,
      scope: { kind: 'FULL' },
      clock,
      inputSource: 'MICROPHONE',
      countInBeats: 0,
      localSessionId: 'analysis-session',
    });
    session.start();
    clock.advance(1000);
    const before = session.evaluationSnapshot;

    expect(() => session.publishAnalysis({
      sessionDomainId: session.timebase.domainId,
      attacks: [
        {
          captureTime: session.timebase.atSessionMs(100),
          pitch: 'C4',
          confidence: 1,
          source: 'ACOUSTIC',
        },
        {
          captureTime: session.timebase.atSessionMs(200),
          pitch: 'E4',
          confidence: 1,
          source: 'ACOUSTIC',
        },
        {
          captureTime: { domainId: 'wrong-domain', ms: 300 },
          pitch: 'G4',
          confidence: 1,
          source: 'ACOUSTIC',
        },
      ],
      analyzedThroughPerformanceMs: 1000,
    })).toThrow(/different session domain/);

    expect(session.evaluationSnapshot).toEqual(before);
  });

  it('rejects invalid analysis frontiers atomically before observing attacks', () => {
    const clock = new ManualClock(0);
    const session = new ContinuousPracticeSession({
      artifact,
      tempoPlan: defaultTempoPlan,
      scope: { kind: 'FULL' },
      clock,
      inputSource: 'MICROPHONE',
      countInBeats: 0,
      localSessionId: 'analysis-session',
    });
    session.start();
    clock.advance(1000);
    const before = session.evaluationSnapshot;

    expect(() => session.publishAnalysis({
      sessionDomainId: session.timebase.domainId,
      attacks: [{
        captureTime: session.timebase.atSessionMs(100),
        pitch: 'C4',
        confidence: 1,
        source: 'ACOUSTIC',
      }],
      analyzedThroughPerformanceMs: Number.POSITIVE_INFINITY,
    })).toThrow(/analysis frontier/);

    expect(session.evaluationSnapshot).toEqual(before);
  });
});
describe('local session foundation', () => {
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
      scope: { kind: 'FULL' },
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
      scope: { kind: 'FULL' },
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
    const performanceClock = new ManualClock(0);
    const performance = new ContinuousPracticeSession({
      artifact,
      tempoPlan: defaultTempoPlan,
      scope: { kind: 'FULL' },
      clock: performanceClock,
      countInBeats: 0,
      localSessionId: 'normalized-midi',
      inputSource: 'MIDI',
      timebase: midiTimebase,
    });
    performance.start();
    performanceClock.advance(100);
    const evaluated = performance.observeCapturedAttack({
      captureTime: midiTimebase.midiEventToSessionTime(0),
      pitch: 'C4',
      confidence: 1,
      source: 'MIDI',
      inferenceCompletedAtMs: 5_000,
    });
    expect(evaluated).toBe(true);
    expect(performance.evaluationSnapshot.strikes[0]).toMatchObject({ verdict: 'PENDING' });
    performanceClock.advance(1_000);
    performance.snapshot();
    expect(performance.evaluationSnapshot.strikes[0]).toMatchObject({
      verdict: 'MATCHED',
      timingOffsetMs: 0,
    });
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
    expect(() => new StepPracticeRuntime({ artifact: empty, scope: { kind: 'FULL' },
      clock: new ManualClock() })).toThrow(/at least one expected group/);
    expect(() => new ContinuousPracticeSession({ artifact: empty, tempoPlan: resolvePracticeTempoPlan(empty, { mode: 'SCORE' }), scope: { kind: 'FULL' }, clock: new ManualClock() })).toThrow(/at least one expected group/);
  });

  it('supports STEP pause, resume, and explicit user end with strict completion semantics', () => {
    const clock = new ManualClock(100);
    const runtime = new StepPracticeRuntime({ artifact, scope: { kind: 'FULL' },
      clock });
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
        kind: 'RANGE',
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
    const runtime = new ContinuousPracticeSession({ artifact, tempoPlan, scope: { kind: 'FULL' }, clock, countInBeats: 0 });
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
    const rangeClock = new ManualClock(0);
    const naturalRuntime = new ContinuousPracticeSession({
      artifact,
      tempoPlan,
      clock: rangeClock,
      countInBeats: 0,
      scope: {
        kind: 'RANGE',
        startGroupId: artifact.expectedPracticeGroups[0].groupId,
        endGroupId: artifact.expectedPracticeGroups[0].groupId,
      },
    });
    naturalRuntime.start();
    rangeClock.advance(10_000);
    const naturalSnapshot = naturalRuntime.snapshot();
    expect(naturalSnapshot.state).toBe('ENDED');
    expect(naturalSnapshot.scopeCompleted).toBe(true);
    expect(naturalSnapshot.completionReason).toBe('SCOPE_COMPLETED');
  });

  it('uses capture-time performance membership and rejects evidence behind finalized truth', () => {
    const clock = new ManualClock(0);
    const tempoPlan = resolvePracticeTempoPlan(artifact, { mode: 'SCORE' });
    const runtime = new ContinuousPracticeSession({
      artifact,
      tempoPlan,
      scope: {
        kind: 'RANGE',
        startGroupId: artifact.expectedPracticeGroups[0].groupId,
        endGroupId: artifact.expectedPracticeGroups[0].groupId,
      },
      clock,
      countInBeats: 3,
      inputSource: 'MIDI',
    });
    // Before start: state is READY
    const evidence = performanceEvidence(runtime.timebase.domainId, 100, ['C4']);
    expect(runtime.observeCapturedAttack(evidence)).toBe(false);

    // Start with count-in: state is COUNT_IN
    runtime.start();
    expect(runtime.snapshot().state).toBe('COUNT_IN');
    expect(runtime.observeCapturedAttack(evidence)).toBe(false);

    // Advance past count-in into RUNNING
    const countInTotalMs = runtime.snapshot().countInTotalMs;
    clock.advance(countInTotalMs + 10);
    expect(runtime.snapshot().state).toBe('RUNNING');
    clock.advance(90);
    const runningEvidence = performanceEvidence(runtime.timebase.domainId, countInTotalMs + 100, ['C4']);
    expect(runtime.observeCapturedAttack(runningEvidence)).toBe(true);

    // Pause: state is PAUSED
    runtime.pause();
    expect(runtime.snapshot().state).toBe('PAUSED');
    expect(runtime.observeCapturedAttack(performanceEvidence(runtime.timebase.domainId, countInTotalMs + 200, ['C4']))).toBe(false);
    runtime.resume();
    clock.advance(500);
    const lateRunningEvidence = performanceEvidence(runtime.timebase.domainId, countInTotalMs + 250, ['C4']);

    // End: state is ENDED
    runtime.end('STOPPED_BY_USER');
    expect(runtime.snapshot().state).toBe('ENDED');
    expect(() => runtime.observeCapturedAttack(lateRunningEvidence)).toThrow(/finalized analysis frontier/);
    expect(runtime.observeCapturedAttack(performanceEvidence(runtime.timebase.domainId, clock.nowMs() + 100, ['C4']))).toBe(false);
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
    const runtime = new ContinuousPracticeSession({
      artifact: multiTempoArtifact,
      tempoPlan,
      scope: { kind: 'FULL' },
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

  it('allows live metronome toggle on StepPracticeRuntime and ContinuousPracticeSession snapshots', () => {
    const art = cloneArtifact();
    const clock = new ManualClock(100);

    const stepRuntime = new StepPracticeRuntime({
      artifact: art,
      clock,
      scope: { kind: 'FULL' },
      metronomeEnabled: false,
    });
    expect(stepRuntime.snapshot().metronomeEnabled).toBe(false);
    expect(stepRuntime.currentOnsetBeat).toBe(0);

    stepRuntime.setMetronomeEnabled(true);
    expect(stepRuntime.snapshot().metronomeEnabled).toBe(true);

    const perfRuntime = new ContinuousPracticeSession({
      artifact: art,
      clock,
      scope: { kind: 'FULL' },
      metronomeEnabled: false,
    });
    expect(perfRuntime.snapshotSession().metronomeEnabled).toBe(false);

    perfRuntime.setMetronomeEnabled(true);
    expect(perfRuntime.snapshotSession().metronomeEnabled).toBe(true);
  });

  it('handles full-piece with leading rest starting practice at first expected note onset with resolved tempo', () => {
    // Piece has leading rest: beat 0.0 to 2.0 is rest. First playable note is at beat 2.0.
    // Meter is 4/4.
    // Score tempo segments: 0.0 -> 80 BPM (score tempo), 2.0 -> 100 BPM (score tempo at first note).
    const firstGroup = {
      ...artifact.expectedPracticeGroups[0],
      groupId: 'g-rest-1',
      onsetBeat: 2.0,
      canonicalEndBeat: 3.0,
    };
    const firstStep = {
      ...artifact.practiceAttackSteps[0],
      stepId: 's-rest-1',
      groupId: 'g-rest-1',
      onsetBeat: 2.0,
    };
    const leadingRestArtifact = cloneArtifact({
      meterSegments: [
        {
          startBeat: 0.0,
          numerator: 4,
          denominator: 4,
          measureDurationBeats: 4.0,
          countInPulses: 4,
          source: 'MUSICXML',
        },
      ],
      scoreTempoSegments: [
        { startBeat: 0.0, bpm: 80 },
        { startBeat: 2.0, bpm: 100 },
      ],
      expectedPracticeGroups: [firstGroup],
      practiceAttackSteps: [firstStep],
    });

    // Unconditional resolvePracticeScope:
    const resolvedScope = resolvePracticeScope(leadingRestArtifact, { kind: 'FULL' });
    expect(resolvedScope.startBeat).toBe(2.0);
    expect(resolvedScope.startIndex).toBe(0);
    expect(leadingRestArtifact.expectedPracticeGroups[resolvedScope.startIndex].groupId).toBe('g-rest-1');

    // Effective tempo at start of practice (beat 2.0)
    const tempoInfo = effectiveScoreTempoAtBeat(leadingRestArtifact, resolvedScope.startBeat);
    expect(tempoInfo.bpm).toBe(100);
    expect(tempoInfo.source).toBe('MUSICXML');

    // StepPracticeRuntime initialized without explicit scope (full piece):
    const clock = new ManualClock(0);
    const stepRuntime = new StepPracticeRuntime({
      artifact: leadingRestArtifact,
      scope: { kind: 'FULL' },
      clock,
    });
    expect(stepRuntime.currentOnsetBeat).toBe(2.0);
    expect(stepRuntime.currentTarget()?.stepId).toBe('s-rest-1');

    // ContinuousPracticeSession initialized with resolved scope:
    const tempoPlan = resolvePracticeTempoPlan(leadingRestArtifact, { mode: 'SCORE' });
    const perfRuntime = new ContinuousPracticeSession({
      artifact: leadingRestArtifact,
      tempoPlan,
      scope: { kind: 'FULL' },
      clock,
      countInBeats: 4,
    });
    perfRuntime.start();
    const snap = perfRuntime.snapshot();
    expect(snap.state).toBe('COUNT_IN');
    expect(snap.scopeStartBeat).toBe(2.0);
    // At beat 2.0, tempo is 100 BPM. 4 beats at 100 BPM = 2400ms.
    expect(snap.countInTotalMs).toBe(2400);

    // Complete count-in:
    clock.advance(2401);
    expect(perfRuntime.snapshot().state).toBe('RUNNING');
    expect(perfRuntime.snapshot().musicalBeat).toBeCloseTo(2.0, 1);
  });

  it('persists setMetronomeEnabled across session state changes and final snapshot', () => {
    const art = cloneArtifact();
    const clock = new ManualClock(0);

    // Test A: start OFF -> ACTIVE -> toggle ON -> finish -> snapshot.metronomeEnabled === true
    const stepA = new StepPracticeRuntime({
      artifact: art,
      clock,
      scope: { kind: 'FULL' },
      metronomeEnabled: false,
    });
    expect(stepA.snapshot().metronomeEnabled).toBe(false);
    stepA.setMetronomeEnabled(true);
    expect(stepA.snapshot().metronomeEnabled).toBe(true);
    stepA.end('STOPPED_BY_USER');
    const finalStepA = stepA.snapshot();
    expect(finalStepA.lifecycleState).toBe('ENDED');
    expect(finalStepA.metronomeEnabled).toBe(true);

    const perfA = new ContinuousPracticeSession({
      artifact: art,
      clock,
      scope: { kind: 'FULL' },
      metronomeEnabled: false,
    });
    perfA.start();
    expect(perfA.snapshotSession().metronomeEnabled).toBe(false);
    perfA.setMetronomeEnabled(true);
    expect(perfA.snapshotSession().metronomeEnabled).toBe(true);
    perfA.end('STOPPED_BY_USER');
    const finalPerfA = perfA.snapshotSession();
    expect(finalPerfA.lifecycleState).toBe('ENDED');
    expect(finalPerfA.metronomeEnabled).toBe(true);

    // Test B: start ON -> ACTIVE -> toggle OFF -> finish -> snapshot.metronomeEnabled === false
    const stepB = new StepPracticeRuntime({
      artifact: art,
      clock,
      scope: { kind: 'FULL' },
      metronomeEnabled: true,
    });
    expect(stepB.snapshot().metronomeEnabled).toBe(true);
    stepB.setMetronomeEnabled(false);
    stepB.end('SCOPE_COMPLETED');
    const finalStepB = stepB.snapshot();
    expect(finalStepB.lifecycleState).toBe('ENDED');
    expect(finalStepB.metronomeEnabled).toBe(false);

    const perfB = new ContinuousPracticeSession({
      artifact: art,
      clock,
      scope: { kind: 'FULL' },
      metronomeEnabled: true,
    });
    perfB.start();
    expect(perfB.snapshotSession().metronomeEnabled).toBe(true);
    perfB.setMetronomeEnabled(false);
    perfB.end('STOPPED_BY_USER');
    const finalPerfB = perfB.snapshotSession();
    expect(finalPerfB.lifecycleState).toBe('ENDED');
    expect(finalPerfB.metronomeEnabled).toBe(false);
  });
});

