import { CONTINUOUS_ASSIGNMENT_POLICY_ID } from '@/lib/practice/continuous/domain/evaluation/finalization-policy';
import canonicalArtifactJson from '@/lib/practice/__fixtures__/canonical-practice-score-artifact.json';
import { ContinuousPracticeSession } from '@/lib/practice/continuous/domain/practice-session';
import { ContinuousMidiEvidence } from '@/lib/practice/continuous/input/midi-evidence';
import { type PracticeScoreArtifact } from '@/lib/practice/kernel/artifact';
import { resolvePracticeTempoPlan } from '@/lib/practice/kernel/tempo';
import { ManualClock, PracticeTimebase, type SessionTime } from '@/lib/practice/kernel/timebase';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { ContinuousEvaluationSession } from '@/lib/practice/continuous/domain/evaluation/session';
import type { ContinuousPracticeSessionOptions } from './practice-session';
const artifact = canonicalArtifactJson as PracticeScoreArtifact;
const defaultTempoPlan = resolvePracticeTempoPlan(artifact, { mode: 'SCORE' });
function cloneArtifact(overrides: Partial<PracticeScoreArtifact> = {}): PracticeScoreArtifact {
  return structuredClone({ ...artifact, ...overrides });
}
function sessionTime(domainId: string, ms: number, sampleIndex?: number): SessionTime {
  return sampleIndex === undefined ? { domainId, ms } : { domainId, ms, sampleIndex };
}
function midiAttack(domainId: string, ms: number, pitches: string[]) {
  return { captureTime: sessionTime(domainId, ms), pitch: pitches[0] ?? 'C4', confidence: 1 };
}

describe('Continuous session composition and record ownership', () => {
  it('requires MIDI evidence in the type contract and excludes it from microphone options', () => {
    type Midi = Extract<ContinuousPracticeSessionOptions, { inputSource: 'MIDI' }>;
    type Microphone = Extract<ContinuousPracticeSessionOptions, { inputSource: 'MICROPHONE' }>;
    expectTypeOf<Pick<Midi, 'inputSource'>>().not.toExtend<Pick<Midi, 'inputSource' | 'createClockEvidence'>>();
    expectTypeOf<Microphone['createClockEvidence']>().toEqualTypeOf<undefined>();
    expectTypeOf<keyof Parameters<ContinuousPracticeSession['observeMidiAttack']>[0]>()
      .toEqualTypeOf<'captureTime' | 'pitch' | 'confidence'>();
  });

  it('fails closed on an untyped MIDI configuration with no evidence owner', () => {
    const options: unknown = { artifact, scope: { kind: 'FULL' }, clock: new ManualClock(), inputSource: 'MIDI' };
    expect(() => new ContinuousPracticeSession(options as ContinuousPracticeSessionOptions))
      .toThrow('MIDI sessions require a clock evidence input.');
  });

  it('rejects an untyped microphone configuration carrying a MIDI factory without constructing it', () => {
    const createClockEvidence = vi.fn();
    const options: unknown = {
      artifact, scope: { kind: 'FULL' }, clock: new ManualClock(), inputSource: 'MICROPHONE', createClockEvidence,
    };
    expect(() => new ContinuousPracticeSession(options as ContinuousPracticeSessionOptions))
      .toThrow('Microphone sessions do not accept MIDI evidence ownership.');
    expect(createClockEvidence).not.toHaveBeenCalled();
  });

  it('owns durable session metadata independently of the injected transport timebase', () => {
    let epochMs = 10_000;
    const clock = new ManualClock(100);
    const timebase = new PracticeTimebase({ domainId: 'capture-clock', runtimeOriginMs: 100 });
    const version = { schemaVersion: 1, runtimeVersion: 'session-contract' };
    const session = new ContinuousPracticeSession({
      artifact, scope: { kind: 'FULL' }, inputSource: 'MICROPHONE', clock, timebase,
      metadataClock: { nowEpochMs: () => epochMs }, version, localSessionId: 'product-session', countInBeats: 0,
    });
    expect(session.localSessionId).toBe('product-session');
    expect(session.timebase).toBe(timebase);
    expect(session.snapshotSession()).toMatchObject({
      localSessionId: 'product-session', inputSource: 'MICROPHONE', createdAtMs: 10_000, updatedAtMs: 10_000, version,
      performance: { state: 'READY', activeElapsedMs: 0 },
    });
    session.start();
    clock.advance(250);
    session.pause();
    epochMs = 20_000;
    clock.advance(5000);
    expect(session.snapshotSession()).toMatchObject({
      createdAtMs: 10_000, updatedAtMs: 20_000, lifecycleState: 'PAUSED',
      performance: { state: 'PAUSED', stateBeforePause: 'RUNNING', activeElapsedMs: 250 },
    });
  });

  it('reads session record timing without driving a transport transition', () => {
    const clock = new ManualClock();
    const session = new ContinuousPracticeSession({
      artifact, scope: { kind: 'FULL' }, inputSource: 'MICROPHONE', clock, countInBeats: 0,
    });
    session.start();
    clock.advance(20_000);
    expect(session.snapshotSession()).toMatchObject({
      completionReason: null, performance: { state: 'RUNNING', activeElapsedMs: 20_000 },
    });
    expect(session.snapshot().completionReason).toBe('SCOPE_COMPLETED');
    expect(session.snapshotSession()).toMatchObject({
      lifecycleState: 'ENDED', completionReason: 'SCOPE_COMPLETED', performance: { state: 'ENDED' },
    });
  });
});
describe('Continuous clock and evaluation composition', () => {
  it('keeps clock state separate from continuous evaluation state', () => {
    const clock = new ManualClock(0);
    const session = new ContinuousPracticeSession({
      createClockEvidence: domainId => new ContinuousMidiEvidence(domainId),
      artifact,
      tempoPlan: defaultTempoPlan,
      scope: { kind: 'FULL' },
      clock,
      inputSource: 'MIDI',
      countInBeats: 0,
      localSessionId: 'continuous-clock-separate'
    });

    expect(session.snapshot().state).toBe('READY');
    expect(session.evaluationSnapshot.assignment.groups.flatMap(group => group.strikes)).toHaveLength(
      artifact.expectedPracticeGroups.reduce((sum, group) => sum + group.strikeTargets.length, 0)
    );
    expect(session.evaluationSnapshot.assignment.groups.flatMap(group => group.strikes).every((strike) => strike.state === 'PENDING')).toBe(true);

    session.start();
    const before = session.snapshot();
    expect(session.observeMidiAttack(midiAttack('continuous-clock-separate', 0, ['C4']))).toBe(true);
    expect(session.snapshot().performanceTimeMs).toBe(before.performanceTimeMs);
    expect(session.evaluationSnapshot.assignment.groups.flatMap(group => group.strikes)[0]).toMatchObject({ state: 'PENDING' });
    clock.advance(1_500);
    session.snapshot();
    expect(session.evaluationSnapshot.assignment.groups.flatMap(group => group.strikes)[0]).toMatchObject({ state: 'MATCHED' });
  });

  it('MIDI produces all five product verdicts through the sole accumulated evaluator', () => {
    const clock = new ManualClock(0);
    const session = new ContinuousPracticeSession({
      createClockEvidence: domainId => new ContinuousMidiEvidence(domainId),
      artifact,
      scope: { kind: 'FULL' },
      clock,
      tempoSelection: { mode: 'CUSTOM_FIXED_BPM', bpm: 60 },
      inputSource: 'MIDI',
      countInBeats: 0,
      localSessionId: 'five-verdicts'
    });
    session.start();
    let now = 0;
    for (const [time, pitch] of [[0, 'C4'], [2000, 'F#4'], [3000, 'A4'], [3900, 'F#4'], [4500, 'D5']] as const) {
      clock.advance(time - now); now = time;
      const before = session.clock.snapshot();
      session.observeMidiAttack(midiAttack(session.timebase.domainId, time, [pitch]));
      expect(session.clock.snapshot().performanceTimeMs).toBe(before.performanceTimeMs);
    }
    clock.advance(2500); session.snapshot();
    const completed = session.completedEvaluation();
    if (completed.status !== 'COMPLETE') throw new Error('incomplete MIDI truth');
    expect(completed.interpretation.groups.map(group => group.verdict)).toEqual(['CORRECT', 'MISSING', 'WRONG', 'INCOMPLETE_CHORD', 'CORRECT']);
    expect(completed.assignment.unattributedObservations).toHaveLength(1);
    expect(completed.assignment.observationAssignments.map(owner => owner.kind).sort()).toEqual(['GROUP_RESIDUAL', 'STRIKE_MATCH', 'STRIKE_MATCH', 'STRIKE_MATCH', 'UNATTRIBUTED']);
    expect(completed.assignment.groups).toEqual(session.evaluationSnapshot.assignment.groups);
  });

  it('does not advance MIDI frontier while paused', () => {
    const clock = new ManualClock(0);
    const session = new ContinuousPracticeSession({
      createClockEvidence: domainId => new ContinuousMidiEvidence(domainId),
      artifact,
      tempoPlan: defaultTempoPlan,
      scope: { kind: 'FULL' },
      clock,
      inputSource: 'MIDI',
      countInBeats: 0,
      localSessionId: 'continuous-midi-pause'
    });

    session.start();
    clock.advance(100);
    session.pause();
    clock.advance(5_000);
    expect(session.evaluationSnapshot.assignment.groups.flatMap(group => group.strikes)[1]).toMatchObject({ state: 'PENDING' });
  });

  it('assigns an incompatible attack once as WRONG, not also EXTRA', () => {
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
      createClockEvidence: domainId => new ContinuousMidiEvidence(domainId),
      artifact: twoGroupArtifact,
      tempoPlan: defaultTempoPlan,
      scope: { kind: 'FULL' },
      clock: extraClock,
      inputSource: 'MIDI',
      countInBeats: 0,
      localSessionId: 'continuous-global-extra'
    });

    session.start();
    extraClock.advance(150);
    expect(session.observeMidiAttack(midiAttack(session.timebase.domainId, 150, ['F#4']))).toBe(true);
    expect(session.evaluationSnapshot.assignment.unattributedObservations).toHaveLength(0);
    extraClock.advance(500);
    session.snapshot();
    extraClock.advance(1500);
    session.snapshot();
    expect(session.evaluationSnapshot.assignment.unattributedObservations).toHaveLength(0);
    expect(session.evaluationSnapshot.assignment.observationAssignments.filter(owner => owner.kind === 'GROUP_RESIDUAL')).toHaveLength(1);
  });

  it('syncs natural clock auto-end into final continuous evaluation without explicit end', () => {
    const naturalClock = new ManualClock(0);
    const natural = new ContinuousPracticeSession({
      createClockEvidence: domainId => new ContinuousMidiEvidence(domainId),
      artifact,
      tempoPlan: defaultTempoPlan,
      scope: { kind: 'FULL' },
      clock: naturalClock,
      inputSource: 'MIDI',
      countInBeats: 0
    });
    natural.start();
    naturalClock.advance(20_000);
    const snapshot = natural.snapshot();
    expect(snapshot.state).toBe('ENDED');
    expect(snapshot.completionReason).toBe('SCOPE_COMPLETED');
    const naturalEvaluation = natural.completedEvaluation();
    expect(naturalEvaluation.status).toBe('COMPLETE');
    if (naturalEvaluation.status === 'COMPLETE') {
      expect(naturalEvaluation.assignment.groups.flatMap(group => group.strikes).some((strike) => strike.state === 'NOT_REACHED')).toBe(false);
      expect(naturalEvaluation.assignment.groups.flatMap(group => group.strikes).some((strike) => strike.state === 'UNMATCHED')).toBe(true);
    }
  });

  it('uses NOT_REACHED only for manual stop tails', () => {
    const manualClock = new ManualClock(0);
    const manual = new ContinuousPracticeSession({
      createClockEvidence: domainId => new ContinuousMidiEvidence(domainId),
      artifact,
      tempoPlan: defaultTempoPlan,
      scope: { kind: 'FULL' },
      clock: manualClock,
      inputSource: 'MIDI',
      countInBeats: 0
    });
    manual.start();
    manualClock.advance(100);
    manual.end('STOPPED_BY_USER');
    const manualEvaluation = manual.completedEvaluation();
    expect(manualEvaluation.status).toBe('COMPLETE');
    if (manualEvaluation.status === 'COMPLETE') {
      expect(manualEvaluation.assignment.groups.flatMap(group => group.strikes).some((strike) => strike.state === 'NOT_REACHED')).toBe(true);
    }
  });

  it('drains MIDI completion through stop time while preserving missing and not-reached semantics', () => {
    const manualClock = new ManualClock(0);
    const manual = new ContinuousPracticeSession({
      createClockEvidence: domainId => new ContinuousMidiEvidence(domainId),
      artifact,
      tempoPlan: defaultTempoPlan,
      scope: { kind: 'FULL' },
      clock: manualClock,
      inputSource: 'MIDI',
      countInBeats: 0
    });
    manual.start();
    manualClock.advance(1000);
    manual.end('STOPPED_BY_USER');

    const evaluation = manual.completedEvaluation();
    expect(evaluation.status).toBe('COMPLETE');
    if (evaluation.status === 'COMPLETE') {
      expect(evaluation.assignment.groups.flatMap(group => group.strikes)[0]).toMatchObject({ state: 'UNMATCHED' });
      expect(evaluation.assignment.groups.flatMap(group => group.strikes).some((strike) => strike.state === 'NOT_REACHED')).toBe(true);
    }
  });

  it('keeps matched MIDI evidence immediately before Stop after completion drain', () => {
    const manualClock = new ManualClock(0);
    const manual = new ContinuousPracticeSession({
      createClockEvidence: domainId => new ContinuousMidiEvidence(domainId),
      artifact,
      tempoPlan: defaultTempoPlan,
      scope: { kind: 'FULL' },
      clock: manualClock,
      inputSource: 'MIDI',
      countInBeats: 0,
      localSessionId: 'midi-stop-match'
    });
    manual.start();
    manualClock.advance(100);
    expect(manual.observeMidiAttack(midiAttack(manual.timebase.domainId, 0, ['C4']))).toBe(true);
    manual.end('STOPPED_BY_USER');

    const evaluation = manual.completedEvaluation();
    expect(evaluation.status).toBe('COMPLETE');
    if (evaluation.status === 'COMPLETE') {
      expect(evaluation.assignment.groups.flatMap(group => group.strikes)[0]).toMatchObject({
        state: 'MATCHED',
        match: { observation: { observationId: `${manual.timebase.domainId}:midi:0` } },
      });
    }
  });

  it('keeps an active browser-local Continuous session running after network loss', () => {
    const originalFetch = globalThis.fetch;
    const originalEventSource = (globalThis as typeof globalThis & { EventSource?: unknown }).EventSource;
    const unavailableFetch = vi.fn(() => Promise.reject(new Error('network unavailable')));
    const UnavailableEventSource = class extends EventTarget {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSED = 2;
      readonly CONNECTING = 0;
      readonly OPEN = 1;
      readonly CLOSED = 2;
      url = '';
      withCredentials = false;
      readyState = 2;
      onerror: ((this: EventSource, event: Event) => unknown) | null = null;
      onmessage: ((this: EventSource, event: MessageEvent) => unknown) | null = null;
      onopen: ((this: EventSource, event: Event) => unknown) | null = null;

      constructor() {
        super();
        throw new Error('SSE unavailable');
      }
      close(): void { }
    } as unknown as typeof EventSource;
    globalThis.fetch = unavailableFetch as unknown as typeof fetch;
    (globalThis as typeof globalThis & { EventSource?: unknown }).EventSource = UnavailableEventSource;

    try {
      const offlineClock = new ManualClock(0);
      const session = new ContinuousPracticeSession({
        createClockEvidence: domainId => new ContinuousMidiEvidence(domainId),
        artifact,
        tempoPlan: defaultTempoPlan,
        scope: { kind: 'FULL' },
        clock: offlineClock,
        inputSource: 'MIDI',
        countInBeats: 0,
        localSessionId: 'active-session-network-loss'
      });

      expect(session.start()).toMatchObject({ state: 'RUNNING', performanceTimeMs: 0 });
      expect(session.observeMidiAttack(midiAttack(session.timebase.domainId, 0, ['C4']))).toBe(true);
      offlineClock.advance(500);
      expect(session.snapshot()).toMatchObject({ state: 'RUNNING', performanceTimeMs: 500 });
      session.pause();
      offlineClock.advance(1_000);
      expect(session.snapshot()).toMatchObject({ state: 'PAUSED', performanceTimeMs: 500 });
      session.resume();
      offlineClock.advance(600);
      expect(session.snapshot()).toMatchObject({ state: 'RUNNING', performanceTimeMs: 1100 });
      session.end('STOPPED_BY_USER');

      const evaluation = session.completedEvaluation();
      expect(evaluation.status).toBe('COMPLETE');
      if (evaluation.status === 'COMPLETE') {
        expect(evaluation.assignment.groups.flatMap(group => group.strikes)[0]).toMatchObject({ state: 'MATCHED' });
        expect(evaluation.assignment.groups.flatMap(group => group.strikes).some((strike) => strike.state === 'NOT_REACHED')).toBe(true);
      }
      expect(unavailableFetch).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
      (globalThis as typeof globalThis & { EventSource?: unknown }).EventSource = originalEventSource;
    }
  });

  it('fails closed when final evaluation still contains pending strikes', () => {
    const clock = new ManualClock(0);
    const session = new ContinuousPracticeSession({
      artifact,
      tempoPlan: defaultTempoPlan,
      scope: { kind: 'FULL' },
      clock,
      inputSource: 'MICROPHONE',
      countInBeats: 0
    });
    session.start();
    clock.advance(1000);
    session.end('STOPPED_BY_USER');

    expect(session.completedEvaluation()).toEqual({
      status: 'UNAVAILABLE', inputSource: 'MICROPHONE', assignmentPolicyId: CONTINUOUS_ASSIGNMENT_POLICY_ID, interpretationPolicyId: 'ACOUSTIC_CONSERVATIVE_SUPPORT_V1', reason: 'INCOMPLETE_ANALYSIS',
    });
  });

  it('uses capture-time performance membership and closes ordinary MIDI evidence after completion', () => {
    const clock = new ManualClock(0);
    const tempoPlan = resolvePracticeTempoPlan(artifact, { mode: 'SCORE' });
    const runtime = new ContinuousPracticeSession({
      createClockEvidence: domainId => new ContinuousMidiEvidence(domainId),
      artifact,
      tempoPlan,
      scope: {
        kind: 'RANGE',
        startGroupId: artifact.expectedPracticeGroups[0].groupId,
        endGroupId: artifact.expectedPracticeGroups[0].groupId,
      },
      clock,
      countInBeats: 3,
      inputSource: 'MIDI'
    });
    // Before start: state is READY
    const evidence = midiAttack(runtime.timebase.domainId, 100, ['C4']);
    expect(runtime.observeMidiAttack(evidence)).toBe(false);

    // Start with count-in: state is COUNT_IN
    runtime.start();
    expect(runtime.snapshot().state).toBe('COUNT_IN');
    expect(runtime.observeMidiAttack(evidence)).toBe(false);

    // Advance past count-in into RUNNING
    const countInTotalMs = runtime.snapshot().countInTotalMs;
    clock.advance(countInTotalMs + 10);
    expect(runtime.snapshot().state).toBe('RUNNING');
    clock.advance(90);
    const runningEvidence = midiAttack(runtime.timebase.domainId, countInTotalMs + 100, ['C4']);
    expect(runtime.observeMidiAttack(runningEvidence)).toBe(true);

    // Pause: state is PAUSED
    runtime.pause();
    expect(runtime.snapshot().state).toBe('PAUSED');
    expect(runtime.observeMidiAttack(midiAttack(runtime.timebase.domainId, countInTotalMs + 200, ['C4']))).toBe(false);
    runtime.resume();
    clock.advance(500);
    const lateRunningEvidence = midiAttack(runtime.timebase.domainId, countInTotalMs + 250, ['C4']);

    // End: state is ENDED
    runtime.end('STOPPED_BY_USER');
    expect(runtime.snapshot().state).toBe('ENDED');
    expect(runtime.observeMidiAttack(lateRunningEvidence)).toBe(false);
    expect(runtime.observeMidiAttack(midiAttack(runtime.timebase.domainId, clock.nowMs() + 100, ['C4']))).toBe(false);
  });

  it("uses native MIDI capture time rather than callback availability", () => {
    const midiTimebase = new PracticeTimebase({ domainId: 'normalized-midi' });
    const performanceClock = new ManualClock(0);
    const performance = new ContinuousPracticeSession({
      createClockEvidence: domainId => new ContinuousMidiEvidence(domainId),
      artifact,
      tempoPlan: defaultTempoPlan,
      scope: { kind: 'FULL' },
      clock: performanceClock,
      countInBeats: 0,
      localSessionId: 'normalized-midi',
      inputSource: 'MIDI',
      timebase: midiTimebase
    });
    performance.start();
    performanceClock.advance(100);
    const evaluated = performance.observeMidiAttack({
      captureTime: midiTimebase.midiEventToSessionTime(0),
      pitch: 'C4',
      confidence: 1,


    });
    expect(evaluated).toBe(true);
    expect(performance.evaluationSnapshot.assignment.groups.flatMap(group => group.strikes)[0]).toMatchObject({ state: 'PENDING' });
    performanceClock.advance(1_000);
    performance.snapshot();
    expect(performance.evaluationSnapshot.assignment.groups.flatMap(group => group.strikes)[0]).toMatchObject({
      state: 'MATCHED',
      match: { timingOffsetMs: 0 },
    });

  });

  it("rejects a scope with no playable target", () => {

    const empty = cloneArtifact({
      artifactId: 'empty-artifact',
      firstPlayableBeat: null,
      scoreEndBeat: 0,
      playableEvents: [],
      expectedPracticeGroups: [],
      practiceAttackSteps: [],
    });
    expect(() => new ContinuousPracticeSession({
      artifact: empty,
      tempoPlan: resolvePracticeTempoPlan(empty, { mode: 'SCORE' }),
      scope: { kind: 'FULL' },
      clock: new ManualClock(),
      inputSource: 'MICROPHONE'
    })).toThrow(/at least one expected group/);

  });

  it("owns live metronome selection in Continuous session snapshots", () => {

    const art = cloneArtifact();
    const clock = new ManualClock(100);

    const perfRuntime = new ContinuousPracticeSession({
      artifact: art,
      clock,
      scope: { kind: 'FULL' },
      metronomeEnabled: false,
      inputSource: 'MICROPHONE'
    });
    expect(perfRuntime.snapshotSession().metronomeEnabled).toBe(false);

    perfRuntime.setMetronomeEnabled(true);
    expect(perfRuntime.snapshotSession().metronomeEnabled).toBe(true);

  });

  it("persists enabled and disabled metronome selection through Continuous completion", () => {

    const art = cloneArtifact();
    const clock = new ManualClock(0);

    const perfA = new ContinuousPracticeSession({
      artifact: art,
      clock,
      scope: { kind: 'FULL' },
      metronomeEnabled: false,
      inputSource: 'MICROPHONE'
    });
    perfA.start();
    expect(perfA.snapshotSession().metronomeEnabled).toBe(false);
    perfA.setMetronomeEnabled(true);
    expect(perfA.snapshotSession().metronomeEnabled).toBe(true);
    perfA.end('STOPPED_BY_USER');
    const finalPerfA = perfA.snapshotSession();
    expect(finalPerfA.lifecycleState).toBe('ENDED');
    expect(finalPerfA.metronomeEnabled).toBe(true);


    const perfB = new ContinuousPracticeSession({
      artifact: art,
      clock,
      scope: { kind: 'FULL' },
      metronomeEnabled: true,
      inputSource: 'MICROPHONE'
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

it('publishes terminal MIDI coverage before completing evaluation, exactly once', () => {
  const events: string[] = [];
  const clock = new ManualClock();
  const originalComplete = ContinuousEvaluationSession.prototype.complete;
  const completion = vi.spyOn(ContinuousEvaluationSession.prototype, 'complete').mockImplementation(function (this: ContinuousEvaluationSession, ...args) {
    events.push('evaluation');
    return originalComplete.apply(this, args);
  });
  try {
    const session = new ContinuousPracticeSession({
      artifact,
      scope: { kind: 'FULL' },
      clock,
      inputSource: 'MIDI',
      countInBeats: 0,
      createClockEvidence: domainId => {
        const evidence = new ContinuousMidiEvidence(domainId);
        return {
          observe: (...args) => evidence.observe(...args),
          advance: snapshot => evidence.advance(snapshot),
          complete: snapshot => {
            events.push('coverage');
            return evidence.complete(snapshot);
          },
        };
      }
    });
    session.start();
    clock.advance(100);
    session.observeMidiAttack({
      pitch: 'C4', confidence: 1, captureTime: session.timebase.atSessionMs(0),
    });
    session.end();
    session.snapshot();
    session.evaluationSnapshot;
    expect(events).toEqual(['coverage', 'evaluation']);
    const evaluation = session.completedEvaluation();
    expect(evaluation.status).toBe('COMPLETE');
    if (evaluation.status === 'COMPLETE') {
      expect(evaluation.assignment.groups[0].strikes[0]).toMatchObject({ state: 'MATCHED' });
    }
  } finally {
    completion.mockRestore();
  }
});

it('advances MIDI analysis from performance clock time', () => {
  const clock = new ManualClock(0);
  const session = new ContinuousPracticeSession({
    createClockEvidence: domainId => new ContinuousMidiEvidence(domainId),
    artifact,
    tempoPlan: defaultTempoPlan,
    scope: { kind: 'FULL' },
    clock,
    inputSource: 'MIDI',
    countInBeats: 0,
    localSessionId: 'continuous-midi-frontier'
  });

  session.start();
  clock.advance(1_000);
  expect(session.snapshot().state).toBe('RUNNING');
  expect(session.evaluationSnapshot.assignment.groups.flatMap(group => group.strikes)[0]).toMatchObject({ state: 'UNMATCHED' });
});
