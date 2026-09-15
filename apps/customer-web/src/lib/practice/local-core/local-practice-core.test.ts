import { describe, expect, it } from 'vitest';

import {
  InMemoryPracticeSessionStore,
  ManualClock,
  PerformancePracticeRuntime,
  PRACTICE_SCORE_ARTIFACT_SCHEMA_VERSION,
  StepPracticeRuntime,
  type PracticeScoreArtifact,
  type StepVerifierObservation,
} from './index';

function note(eventId: string, onsetBeat: number, pitch: string, renderNoteId: string) {
  return {
    eventId,
    onsetBeat,
    durationBeats: 1,
    pitches: [pitch],
    renderNoteIds: [renderNoteId],
    measureNumbers: ['1'],
    staffIds: ['1'],
    voiceIds: ['1'],
    tieTypes: [],
    playable: true,
    entryCandidate: true,
  };
}

function stepNote(eventId: string, pitch: string, renderNoteId: string) {
  return {
    stepNoteId: `step-note:${eventId}`,
    eventId,
    pitch,
    renderNoteId,
    measureNumbers: ['1'],
    staffIds: ['1'],
    voiceIds: ['1'],
  };
}

function attackTarget(stepId: string, eventId: string, pitch: string, renderNoteId: string) {
  const step = stepNote(eventId, pitch, renderNoteId);
  return {
    attackId: `${stepId}:attack:${pitch}`,
    pitch,
    notes: [step],
    eventIds: [eventId],
    renderNoteIds: [renderNoteId],
    measureNumbers: ['1'],
  };
}

function expectedGroup(
  groupId: string,
  onsetBeat: number,
  eventIds: string[],
  renderNoteIds: string[],
  pitches: string[]
) {
  return {
    groupId,
    onsetBeat,
    eventIds,
    renderNoteIds,
    pitches,
    measureNumbers: ['1'],
    staffIds: ['1'],
    voiceIds: ['1'],
  };
}

function fixtureArtifact(): PracticeScoreArtifact {
  const cTie = {
    ...note('event-c-tie', 3, 'C4', 'n4'),
    tieTypes: ['stop'],
    entryCandidate: false,
  };
  return {
    schemaVersion: PRACTICE_SCORE_ARTIFACT_SCHEMA_VERSION,
    scoreId: 'score-1',
    revisionId: 'revision-1',
    artifactId: 'artifact-v1',
    firstPlayableBeat: 1,
    scoreEndBeat: 6,
    playableEvents: [
      note('event-c1', 1, 'C4', 'n1'),
      note('event-c2', 2, 'C4', 'n2'),
      note('event-e2', 2, 'E4', 'n3'),
      note('event-g2', 2, 'G4', 'n4'),
      cTie,
      note('event-f3', 3, 'F4', 'n5'),
      note('event-a3', 3, 'A4', 'n6'),
      note('event-c4', 4, 'C4', 'n7'),
    ],
    expectedPracticeGroups: [
      expectedGroup('group-c1', 1, ['event-c1'], ['n1'], ['C4']),
      expectedGroup(
        'group-chord',
        2,
        ['event-c2', 'event-e2', 'event-g2'],
        ['n2', 'n3', 'n4'],
        ['C4', 'E4', 'G4']
      ),
      expectedGroup('group-mixed', 3, ['event-f3', 'event-a3'], ['n5', 'n6'], ['F4', 'A4']),
      expectedGroup('group-c4', 4, ['event-c4'], ['n7'], ['C4']),
    ],
    practiceAttackSteps: [
      {
        stepId: 'step-c1',
        onsetBeat: 1,
        eventIds: ['event-c1'],
        attackTargets: [attackTarget('step-c1', 'event-c1', 'C4', 'n1')],
        continuation: [],
        renderNoteIds: ['n1'],
        measureNumbers: ['1'],
        staffIds: ['1'],
        voiceIds: ['1'],
      },
      {
        stepId: 'step-chord',
        onsetBeat: 2,
        eventIds: ['event-c2', 'event-e2', 'event-g2'],
        attackTargets: [
          attackTarget('step-chord', 'event-c2', 'C4', 'n2'),
          attackTarget('step-chord', 'event-e2', 'E4', 'n3'),
          attackTarget('step-chord', 'event-g2', 'G4', 'n4'),
        ],
        continuation: [],
        renderNoteIds: ['n2', 'n3', 'n4'],
        measureNumbers: ['1'],
        staffIds: ['1'],
        voiceIds: ['1'],
      },
      {
        stepId: 'step-mixed',
        onsetBeat: 3,
        eventIds: ['event-f3', 'event-a3'],
        attackTargets: [
          attackTarget('step-mixed', 'event-f3', 'F4', 'n5'),
          attackTarget('step-mixed', 'event-a3', 'A4', 'n6'),
        ],
        continuation: [stepNote('event-c-tie', 'C4', 'n4')],
        renderNoteIds: ['n5', 'n6'],
        measureNumbers: ['1'],
        staffIds: ['1'],
        voiceIds: ['1'],
      },
      {
        stepId: 'step-c4',
        onsetBeat: 4,
        eventIds: ['event-c4'],
        attackTargets: [attackTarget('step-c4', 'event-c4', 'C4', 'n7')],
        continuation: [],
        renderNoteIds: ['n7'],
        measureNumbers: ['1'],
        staffIds: ['1'],
        voiceIds: ['1'],
      },
    ],
    meterSegments: [{ startBeat: 0, numerator: 4, denominator: 4 }],
    tempoSegments: [
      { startBeat: 0, bpm: 120 },
      { startBeat: 4, bpm: 60 },
    ],
  };
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
  return {
    stepId: target.stepId,
    activationGeneration: target.activationGeneration,
    observedAttackPitches: pitches ?? target.attackPitches,
    confidence: 0.97,
    captureTimeMs: 123,
    source: 'FAKE',
    ...overrides,
  };
}

describe('local STEP practice runtime', () => {
  it('matches single notes and advances exactly once', () => {
    const runtime = new StepPracticeRuntime({ artifact: fixtureArtifact(), clock: new ManualClock() });

    const first = runtime.currentTarget();
    const result = runtime.observe(observation(runtime));

    expect(result.kind).toBe('MATCH');
    expect(runtime.currentTarget()?.attackPitches).toEqual(['C4', 'E4', 'G4']);
    expect(runtime.attemptHistory).toHaveLength(1);

    const late = runtime.observe({
      ...observation(runtime),
      stepId: first?.stepId ?? '',
      activationGeneration: first?.activationGeneration ?? 1,
      observedAttackPitches: first?.attackPitches ?? [],
    });
    expect(late.kind).toBe('WAIT');
    expect(runtime.currentTarget()?.stepId).toBe('step-chord');
  });

  it('matches chords only when the complete physical attack set is observed', () => {
    const runtime = new StepPracticeRuntime({ artifact: fixtureArtifact(), clock: new ManualClock() });
    runtime.observe(observation(runtime));

    expect(runtime.observe(observation(runtime, ['C4', 'E4']))).toMatchObject({
      kind: 'WAIT',
      reason: 'wrong_or_partial_attack_set',
    });
    expect(runtime.currentTarget()?.stepId).toBe('step-chord');

    expect(runtime.observe(observation(runtime, ['G4', 'C4', 'E4']))).toMatchObject({
      kind: 'MATCH',
    });
    expect(runtime.currentTarget()?.stepId).toBe('step-mixed');
  });

  it('waits on wrong note, no evidence, stale activation, and stale previous step', () => {
    const runtime = new StepPracticeRuntime({ artifact: fixtureArtifact(), clock: new ManualClock() });
    const target = runtime.currentTarget();

    expect(runtime.observe(null)).toMatchObject({ kind: 'WAIT', reason: 'no_observation' });
    expect(runtime.observe(observation(runtime, ['D4']))).toMatchObject({
      kind: 'WAIT',
      reason: 'wrong_or_partial_attack_set',
    });
    expect(runtime.observe(observation(runtime, undefined, { activationGeneration: 999 }))).toMatchObject({
      kind: 'WAIT',
      reason: 'stale_activation',
    });
    expect(runtime.observe(observation(runtime))).toMatchObject({ kind: 'MATCH' });
    expect(
      runtime.observe({
        stepId: target?.stepId ?? '',
        activationGeneration: target?.activationGeneration ?? 1,
        observedAttackPitches: ['C4'],
        confidence: 0.99,
        captureTimeMs: 200,
        source: 'FAKE',
      })
    ).toMatchObject({ kind: 'WAIT', reason: 'stale_step' });
  });

  it('does not let continuation or sustain substitute for a fresh attack', () => {
    const runtime = new StepPracticeRuntime({ artifact: fixtureArtifact(), clock: new ManualClock() });
    runtime.observe(observation(runtime));
    runtime.observe(observation(runtime, ['C4', 'E4', 'G4']));

    const target = runtime.currentTarget();
    expect(target).toMatchObject({
      attackPitches: ['F4', 'A4'],
      continuationPitches: ['C4'],
    });
    expect(runtime.observe(observation(runtime, ['C4']))).toMatchObject({
      kind: 'WAIT',
      reason: 'wrong_or_partial_attack_set',
    });
    expect(runtime.observe(observation(runtime, ['F4', 'A4']))).toMatchObject({
      kind: 'MATCH',
    });
  });

  it('skip advances once and invalidates late evidence', () => {
    const runtime = new StepPracticeRuntime({ artifact: fixtureArtifact(), clock: new ManualClock() });
    const skipped = runtime.currentTarget();
    const skip = runtime.skip();

    expect(skip.kind).toBe('SKIP');
    expect(runtime.currentTarget()?.stepId).toBe('step-chord');
    expect(
      runtime.observe({
        stepId: skipped?.stepId ?? '',
        activationGeneration: skipped?.activationGeneration ?? 1,
        observedAttackPitches: skipped?.attackPitches ?? [],
        confidence: 1,
        captureTimeMs: 300,
        source: 'FAKE',
      })
    ).toMatchObject({ kind: 'WAIT' });
    expect(runtime.currentTarget()?.stepId).toBe('step-chord');
  });

  it('reset restores scope start and invalidates old evidence', () => {
    const runtime = new StepPracticeRuntime({
      artifact: fixtureArtifact(),
      clock: new ManualClock(),
      scope: { startGroupId: 'group-chord', endGroupId: 'group-mixed' },
    });
    const beforeReset = runtime.currentTarget();

    runtime.observe(observation(runtime, ['C4', 'E4', 'G4']));
    runtime.reset();

    expect(runtime.currentTarget()?.stepId).toBe('step-chord');
    expect(
      runtime.observe({
        stepId: beforeReset?.stepId ?? '',
        activationGeneration: beforeReset?.activationGeneration ?? 1,
        observedAttackPitches: beforeReset?.attackPitches ?? [],
        confidence: 1,
        captureTimeMs: 400,
        source: 'FAKE',
      })
    ).toMatchObject({ kind: 'WAIT', reason: 'stale_activation' });
  });

  it('completes scope after the final scoped target', () => {
    const runtime = new StepPracticeRuntime({
      artifact: fixtureArtifact(),
      clock: new ManualClock(),
      scope: { startGroupId: 'group-mixed', endGroupId: 'group-mixed' },
    });

    expect(runtime.observe(observation(runtime, ['F4', 'A4']))).toMatchObject({ kind: 'MATCH' });
    expect(runtime.isCompleted).toBe(true);
    expect(runtime.currentTarget()).toBeNull();
  });
});

describe('local CONTINUOUS practice runtime', () => {
  it('runs READY -> COUNT_IN -> RUNNING and supports zero count-in', () => {
    const clock = new ManualClock(0);
    const runtime = new PerformancePracticeRuntime({ artifact: fixtureArtifact(), clock });

    expect(runtime.snapshot().state).toBe('READY');
    expect(runtime.start().state).toBe('COUNT_IN');
    clock.advance(2_000);
    expect(runtime.snapshot().state).toBe('RUNNING');

    const zero = new PerformancePracticeRuntime({
      artifact: fixtureArtifact(),
      clock: new ManualClock(0),
      countInBeats: 0,
    });
    expect(zero.start().state).toBe('RUNNING');
  });

  it('converts beat/time across tempo changes', () => {
    const clock = new ManualClock(0);
    const runtime = new PerformancePracticeRuntime({
      artifact: fixtureArtifact(),
      clock,
      countInBeats: 0,
    });
    runtime.start();

    expect(runtime.snapshot().musicalBeat).toBe(1);
    clock.advance(1_500);
    expect(runtime.snapshot().musicalBeat).toBe(4);
    clock.advance(1_000);
    expect(runtime.snapshot().musicalBeat).toBe(5);
  });

  it('pauses and resumes without advancing while paused', () => {
    const clock = new ManualClock(0);
    const runtime = new PerformancePracticeRuntime({
      artifact: fixtureArtifact(),
      clock,
      countInBeats: 0,
    });
    runtime.start();
    clock.advance(500);
    const paused = runtime.pause();
    clock.advance(5_000);

    expect(runtime.snapshot().musicalBeat).toBe(paused.musicalBeat);

    runtime.resume();
    clock.advance(500);
    expect(runtime.snapshot().musicalBeat).toBeGreaterThan(paused.musicalBeat);
  });

  it('honors scope and ends at the scope terminal beat', () => {
    const clock = new ManualClock(0);
    const runtime = new PerformancePracticeRuntime({
      artifact: fixtureArtifact(),
      clock,
      countInBeats: 0,
      scope: { startGroupId: 'group-chord', endGroupId: 'group-mixed' },
    });

    expect(runtime.start()).toMatchObject({
      scopeStartBeat: 2,
      scopeTerminalBeat: 4,
    });
    clock.advance(1_100);
    expect(runtime.snapshot()).toMatchObject({
      state: 'ENDED',
      scopeCompleted: true,
      musicalBeat: 4,
    });
  });

  it('applies speed ratio without using correctness evidence as clock authority', () => {
    const clock = new ManualClock(0);
    const runtime = new PerformancePracticeRuntime({
      artifact: fixtureArtifact(),
      clock,
      countInBeats: 0,
      speedRatio: 2,
    });
    runtime.start();
    clock.advance(500);
    const before = runtime.snapshot();

    runtime.observeEvidence({
      captureTimeMs: 100,
      inferenceCompletedAtMs: 10_000,
      pitches: ['C4'],
      confidence: 0.99,
      source: 'FAKE',
    });
    runtime.observeEvidence({
      captureTimeMs: 200,
      inferenceCompletedAtMs: 10_500,
      pitches: [],
      confidence: 0,
      source: 'FAKE',
    });

    const after = runtime.snapshot();
    expect(after.performanceTimeMs).toBe(before.performanceTimeMs);
    expect(after.musicalBeat).toBe(before.musicalBeat);
    expect(runtime.evaluationObservations[0]).toMatchObject({
      performanceTimeMs: 200,
      musicalBeat: 1.4,
    });
  });
});

describe('shared artifact and local session foundation', () => {
  it('uses one PracticeScoreArtifact for STEP target selection and CONTINUOUS scope', () => {
    const artifact = fixtureArtifact();
    const clock = new ManualClock(0);
    const step = new StepPracticeRuntime({ artifact, clock });
    const continuous = new PerformancePracticeRuntime({ artifact, clock, countInBeats: 0 });

    expect(step.currentTarget()).toMatchObject({
      stepId: 'step-c1',
      attackPitches: ['C4'],
    });
    expect(continuous.start()).toMatchObject({
      scopeStartBeat: 1,
      scopeTerminalBeat: 6,
    });
  });

  it('persists and restores local session snapshots without a backend session', () => {
    const store = new InMemoryPracticeSessionStore();
    const clock = new ManualClock(42);
    const runtime = new StepPracticeRuntime({
      artifact: fixtureArtifact(),
      clock,
      localSessionId: 'local-session-1',
    });

    runtime.observe(observation(runtime));
    store.save(runtime.snapshot());

    const saved = store.load('local-session-1');
    expect(saved?.mode).toBe('STEP_BY_STEP');

    const restored = new StepPracticeRuntime({
      artifact: fixtureArtifact(),
      clock,
      snapshot: saved && saved.mode === 'STEP_BY_STEP' ? saved : undefined,
    });
    expect(restored.currentTarget()?.stepId).toBe('step-chord');
  });
});
