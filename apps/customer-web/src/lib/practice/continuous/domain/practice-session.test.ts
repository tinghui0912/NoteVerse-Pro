import { continuousSessionPlan } from '@/lib/practice/__fixtures__/session-plan';
import { artifactWithKeys } from '../../__fixtures__/piano-key-artifact';
import type { PracticePianoKey } from '@/lib/practice/kernel/piano-key';
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
import type { ContinuousEvidencePublication } from './evaluation/evidence-types';
import { createContinuousPerformanceResult } from '@/lib/practice/result/continuous-performance-result';
import { midiEvidenceProvenance } from '@/lib/practice/result/continuous-result-provenance';
const artifact = canonicalArtifactJson as PracticeScoreArtifact;
const defaultTempoPlan = resolvePracticeTempoPlan(artifact, { mode: 'SCORE' });

function deadlineSession(score = artifact, countInBeats = 0) {
  const clock = new ManualClock(), evidence = new ContinuousMidiEvidence('deadline-session');
  const publications: ContinuousEvidencePublication[] = [];
  const cover = evidence.cover.bind(evidence);
  vi.spyOn(evidence, 'cover').mockImplementation((...args) => {
    const publication = cover(...args); if (publication) publications.push(publication); return publication;
  });
  const tempoPlan = resolvePracticeTempoPlan(score, { mode: 'CUSTOM_FIXED_BPM', bpm: 120 });
  const session = new ContinuousPracticeSession({ ...continuousSessionPlan(score, { scope: { kind: 'FULL' }, inputSource: 'MIDI' }), clock, localSessionId: 'deadline-session', metadataClock: { nowEpochMs: () => 1000 }, countInBeats, tempoPlan, createClockEvidence: () => evidence });
  session.start();
  return { clock, evidence, publications, session, tempoPlan };
}

describe('explicit semantic MIDI progression', () => {
  it('session/evaluation/clock reads never publish, finalize or latch completion', () => {
    const { clock, session, publications } = deadlineSession();
    const before = session.evaluationSnapshot;
    clock.set(20000);
    for (let i = 0; i < 100; i++) {
      session.snapshot(); session.clock.snapshot(); session.snapshotSession(); session.evaluationSnapshot;
    }
    expect(publications).toHaveLength(0);
    expect(session.clock.terminationReason).toBeNull();
    expect(session.evaluationSnapshot).toEqual(before);
    expect(session.completedEvaluation().status).toBe('UNAVAILABLE');
    session.advanceToNow();
    expect(session.clock.terminationReason).toBe('SCOPE_COMPLETED');
    expect(session.completedEvaluation().status).toBe('COMPLETE');
  });
  it('publishes an attack at its inclusive maturity exactly once, not when sampled', () => {
    const { clock, session, publications } = deadlineSession();
    clock.set(100); session.observeMidiAttack(midiAttack(session.timebase.domainId, 100, [60]));
    clock.set(349); session.advanceToNow();
    expect(publications).toHaveLength(0); expect(session.evaluationSnapshot.assignment.observations).toHaveLength(0);
    clock.set(350); session.snapshot(); expect(publications).toHaveLength(0);
    session.advanceToNow();
    expect(publications).toHaveLength(1);
    expect(publications[0]).toMatchObject({ analyzedThroughPerformanceMs: 100, availabilitySessionTimeMs: 350 });
    for (let i = 0; i < 100; i++) { session.advanceToNow(); session.snapshot(); session.evaluationSnapshot; }
    expect(publications).toHaveLength(1);
  });
  it('finalizes silent targets before terminal and deduplicates same-frontier cohort needs', () => {
    const { clock, session, publications } = deadlineSession();
    clock.set(999); session.advanceToNow(); expect(publications).toHaveLength(0);
    clock.set(1000); session.advanceToNow();
    expect(publications).toHaveLength(1);
    expect(publications[0]).toMatchObject({ analyzedThroughPerformanceMs: 750, availabilitySessionTimeMs: 1000 });
    expect(session.evaluationSnapshot.assignment.groups.slice(0, 2).every(group => group.state === 'FINALIZED')).toBe(true);
    expect(session.clock.terminationReason).toBeNull();
  });
  it('freezes an unmatured attack through Pause and Resume Count-In, then maps canonical session availability', () => {
    const { clock, session, publications } = deadlineSession(artifact, 1);
    clock.set(1500); session.observeMidiAttack(midiAttack(session.timebase.domainId, 1500, [67]));
    clock.set(1600); expect(session.pause().performanceTimeMs).toBe(1100);
    const before = session.evaluationSnapshot, count = publications.length;
    clock.set(11600); session.advanceToNow(); expect(session.evaluationSnapshot).toEqual(before);
    const resumed = session.resume();
    clock.set(11600 + resumed.countInTotalMs - 1); session.advanceToNow();
    expect(session.snapshot().performanceTimeMs).toBe(1100); expect(publications).toHaveLength(count);
    clock.set(11600 + resumed.countInTotalMs + 149); session.advanceToNow();
    expect(publications).toHaveLength(count);
    clock.advance(1); session.advanceToNow();
    expect(publications.at(-1)).toMatchObject({ analyzedThroughPerformanceMs: 1000,
      availabilitySessionTimeMs: 11600 + resumed.countInTotalMs + 150,
      observations: [{ performanceTimeMs: 1000 }] });
  });
  const cadences = { dense: Array.from({ length: 1511 }, (_, i) => i * 10),
    sparse: Array.from({ length: 111 }, (_, i) => i * 137), irregular: [7, 499, 820, 11601, 13099, 14999] };
  function performance(calls: readonly number[], reason: 'SCOPE_COMPLETED' | 'STOPPED_BY_USER', firstDelivery = 620) {
    const h = deadlineSession(artifact, 1), { clock, session, publications } = h;
    const terminalCall = reason === 'SCOPE_COMPLETED' ? 15100 : 14500;
    const attacks = [{ delivery: firstDelivery, capture: 600, pianoKey: 60 }, { delivery: 1500, capture: 1500, pianoKey: 67 },
      { delivery: 13650, capture: 13650, pianoKey: 71 }, { delivery: 14000, capture: 14000, pianoKey: 74 }];
    const times = new Set([...calls.filter(t => t <= terminalCall), ...attacks.map(a => a.delivery), 1600, 11600, terminalCall]);
    let callCount = 0;
    for (const t of [...times].sort((a, b) => a - b)) {
      clock.set(t);
      if (calls.includes(t)) { session.advanceToNow(); callCount++; }
      for (const a of attacks.filter(a => a.delivery === t)) expect(session.observeMidiAttack(midiAttack(session.timebase.domainId, a.capture, [a.pianoKey]))).toBe(true);
      if (t === 1600) session.pause();
      if (t === 11600) session.resume();
      if (t === terminalCall) {
        if (reason === 'STOPPED_BY_USER') session.end(reason); else session.advanceToNow();
      }
    }
    const evaluation = session.completedEvaluation(); if (evaluation.status !== 'COMPLETE') throw new Error('incomplete');
    const result = reason === 'SCOPE_COMPLETED' ? createContinuousPerformanceResult({ artifact, localSessionId: session.localSessionId, inputSource: 'MIDI', scope: continuousSessionPlan(artifact, { scope: { kind: 'FULL' } }).scope, tempoPlan: h.tempoPlan, activeElapsedMs: session.snapshotSession().performance.activeElapsedMs, evaluation, evidenceProvenance: midiEvidenceProvenance(h.evidence.evidencePolicyId), completedAt: '2026-10-27T00:00:00.000Z' }) : null;
    return { publications, evaluation, result, callCount };
  }
  it.each(['SCOPE_COMPLETED', 'STOPPED_BY_USER'] as const)('%s dense/sparse/irregular advancement has identical publications, finalities and completed assignment', reason => {
    const dense = performance(cadences.dense, reason);
    for (const calls of [cadences.sparse, cadences.irregular]) {
      const other = performance(calls, reason);
      expect(other.publications).toEqual(dense.publications);
      expect(other.evaluation).toEqual(dense.evaluation);
      expect(other.result).toEqual(dense.result);
      expect(other.callCount).toBeLessThan(dense.callCount);
    }
    expect(dense.publications).toHaveLength(reason === 'SCOPE_COMPLETED' ? 9 : 8);
    expect(dense.evaluation.assignment.completion.availabilitySessionTimeMs).toBe(reason === 'SCOPE_COMPLETED' ? 15000 : 14500);
  });
  it('callback delay below grace changes neither native event coordinates nor canonical knowledge availability', () => {
    const early = performance(cadences.dense, 'SCOPE_COMPLETED', 600);
    const delayed = performance(cadences.irregular, 'SCOPE_COMPLETED', 800);
    expect(delayed.publications).toEqual(early.publications);
    expect(delayed.result).toEqual(early.result);
  });
  it('terminal catch-up drains every reached deadline before exact terminal coverage', () => {
    const dense = performance(cadences.dense, 'SCOPE_COMPLETED');
    const eventOnly = performance([], 'SCOPE_COMPLETED');
    expect(eventOnly.publications).toEqual(dense.publications);
    expect(eventOnly.result).toEqual(dense.result);
    expect(eventOnly.publications.slice(-3).map(p => [p.analyzedThroughPerformanceMs, p.availabilitySessionTimeMs]))
      .toEqual([[2000, 14250], [2500, 14750], [3000, 15000]]);
  });
  it('generic completion catches up an unsampled Resume Count-In before terminal coverage', () => {
    const run = (dense: boolean) => {
      const { clock, session, publications } = deadlineSession(artifact, 1);
      clock.set(1600); session.pause(); clock.set(11600); session.resume();
      if (dense) for (let t = 11600; t < 14500; t += 10) { clock.set(t); session.advanceToNow(); }
      clock.set(14500); session.end('STOPPED_BY_USER');
      return { publications, evaluation: session.completedEvaluation() };
    };
    const coarse = run(false);
    expect(coarse).toEqual(run(true));
    expect(coarse.evaluation.status).toBe('COMPLETE');
    if (coarse.evaluation.status === 'COMPLETE') expect(coarse.evaluation.assignment.completion)
      .toEqual({ reason: 'STOPPED_BY_USER', performanceTimeMs: 2500, availabilitySessionTimeMs: 14500 });
  });
  it.each([999, 1000, 1001])('delivery at %i is independent of a prior refresh closing that exact frontier', delivery => {
    const run = (dense: boolean) => {
      const { clock, session, publications } = deadlineSession();
      if (dense) for (let t = 0; t <= delivery; t += 10) { clock.set(t); session.advanceToNow(); }
      clock.set(delivery);
      const attack = midiAttack(session.timebase.domainId, 750, [60]);
      if (delivery === 999) expect(session.observeMidiAttack(attack)).toBe(true);
      else expect(() => session.observeMidiAttack(attack)).toThrow('MIDI_EVIDENCE_AFTER_COVERAGE');
      clock.set(1100); session.advanceToNow();
      return { publications, evaluation: session.evaluationSnapshot };
    };
    expect(run(true)).toEqual(run(false));
  });
  it.each([349, 350, 351])('late/eligible delivery at %i is independent of whether prior refreshes ran', delivery => {
    const outcomes = [false, true].map(dense => {
      const { clock, session, publications } = deadlineSession();
      if (dense) for (let t = 0; t <= delivery; t += 10) { clock.set(t); session.advanceToNow(); }
      clock.set(delivery);
      if (delivery < 350) expect(session.observeMidiAttack(midiAttack(session.timebase.domainId, 100, [60]))).toBe(true);
      else expect(() => session.observeMidiAttack(midiAttack(session.timebase.domainId, 100, [60]))).toThrow('MIDI_EVIDENCE_AFTER_COVERAGE');
      clock.set(400); session.advanceToNow();
      return { publications, assignment: session.evaluationSnapshot.assignment };
    });
    expect(outcomes[0]).toEqual(outcomes[1]);
  });
  it('120 seconds of silence produces four target frontiers plus terminal, not 12,000 refresh publications', () => {
    const score = structuredClone(artifact);
    score.scoreEndBeat = 240; score.events.at(-1)!.durationBeats = 240 - score.events.at(-1)!.onsetBeat;
    score.moments.at(-1)!.canonicalEndBeat = 240;
    const run = (step: number) => {
      const { clock, session, publications } = deadlineSession(score);
      let calls = 0;
      for (let t = step; t < 120000; t += step) { clock.set(t); session.advanceToNow(); calls++; }
      clock.set(120100); session.advanceToNow(); calls++;
      return { publications, evaluation: session.completedEvaluation(), calls };
    };
    const dense = run(10), sparse = run(137000);
    expect(dense.calls).toBe(12000); expect(sparse.calls).toBe(1);
    expect(dense.publications.map(p => p.analyzedThroughPerformanceMs)).toEqual([750, 1250, 1750, 2500, 120000]);
    expect(sparse.publications).toEqual(dense.publications);
    expect(sparse.evaluation).toEqual(dense.evaluation);
  });
});
function cloneArtifact(overrides: Partial<PracticeScoreArtifact> = {}): PracticeScoreArtifact {
  return structuredClone({ ...artifact, ...overrides });
}
function sessionTime(domainId: string, ms: number, sampleIndex?: number): SessionTime {
  return sampleIndex === undefined ? { domainId, ms } : { domainId, ms, sampleIndex };
}
function midiAttack(domainId: string, ms: number, pianoKeys: PracticePianoKey[]) {
  return { captureTime: sessionTime(domainId, ms), pianoKey: pianoKeys[0] ?? 60, confidence: 1 };
}

describe('Continuous session composition and record ownership', () => {
  it('MIDI events exclude a 5-second pause and Resume Count-In while availability and completion use session time', () => {
    const clock = new ManualClock(), evidence = new ContinuousMidiEvidence('timing');
    const publications: ReturnType<ContinuousMidiEvidence['cover']>[] = [];
    const cover = evidence.cover.bind(evidence);
    vi.spyOn(evidence, 'cover').mockImplementation((...args) => { const p = cover(...args); if (p) publications.push(p); return p; });
    const session = new ContinuousPracticeSession({ ...continuousSessionPlan(artifact, { scope: { kind: 'FULL' }, inputSource: 'MIDI' }), clock, localSessionId: 'timing', countInBeats: 4, createClockEvidence: () => evidence });
    const start = session.start();
    clock.advance(100); expect(session.observeMidiAttack(midiAttack('timing', clock.nowMs(), [60]))).toBe(false);
    clock.set(start.countInTotalMs + 1000); expect(session.pause().performanceTimeMs).toBe(1000);
    clock.advance(5000); const resumed = session.resume();
    expect(resumed.countInKind).toBe('RESUME');
    clock.advance(100); expect(session.observeMidiAttack(midiAttack('timing', clock.nowMs(), [60]))).toBe(false);
    expect(session.advanceToNow().performanceTimeMs).toBe(1000);
    clock.advance(resumed.countInRemainingMs - 100); session.advanceToNow();
    clock.advance(100); expect(session.observeMidiAttack(midiAttack('timing', clock.nowMs(), [60]))).toBe(true);
    clock.advance(300); const snapshot = session.advanceToNow();
    const publication = publications.find(p => p?.observations.length)!;
    expect(publication?.observations[0].performanceTimeMs).toBe(1100);
    expect(publication?.availabilitySessionTimeMs).toBe(session.clock.sessionTimeAtReachedPerformance(1350)!.ms);
    expect(publication?.availabilitySessionTimeMs).toBe(snapshot.nowMs - 50);
    expect(publication?.availabilitySessionTimeMs).toBeGreaterThan(snapshot.performanceTimeMs + 5000);
    const terminal = session.end('STOPPED_BY_USER');
    expect(session.evaluationSnapshot.assignment.completion).toMatchObject({ performanceTimeMs: terminal.performanceTimeMs,
      availabilitySessionTimeMs: terminal.nowMs });
  });
  it('requires MIDI evidence in the type contract and excludes it from microphone options', () => {
    type Midi = Extract<ContinuousPracticeSessionOptions, { inputSource: 'MIDI' }>;
    type Microphone = Extract<ContinuousPracticeSessionOptions, { inputSource: 'MICROPHONE' }>;
    expectTypeOf<Pick<Midi, 'inputSource'>>().not.toExtend<Pick<Midi, 'inputSource' | 'createClockEvidence'>>();
    expectTypeOf<Microphone['createClockEvidence']>().toEqualTypeOf<undefined>();
    expectTypeOf<keyof Parameters<ContinuousPracticeSession['observeMidiAttack']>[0]>()
      .toEqualTypeOf<'captureTime' | 'pianoKey' | 'confidence'>();
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
    const session = new ContinuousPracticeSession({ ...continuousSessionPlan(artifact, { scope: { kind: 'FULL' }, inputSource: 'MICROPHONE' }), clock, timebase, metadataClock: { nowEpochMs: () => epochMs }, version, localSessionId: 'product-session', countInBeats: 0 });
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
    const session = new ContinuousPracticeSession({ ...continuousSessionPlan(artifact, { scope: { kind: 'FULL' }, inputSource: 'MICROPHONE' }), clock, countInBeats: 0 });
    session.start();
    clock.advance(20_000);
    expect(session.snapshotSession()).toMatchObject({
      completionReason: null, performance: { state: 'RUNNING', activeElapsedMs: 20_000 },
    });
    expect(session.advanceToNow().completionReason).toBe('SCOPE_COMPLETED');
    expect(session.snapshotSession()).toMatchObject({
      lifecycleState: 'ENDED', completionReason: 'SCOPE_COMPLETED', performance: { state: 'ENDED' },
    });
  });
});
describe('Continuous clock and evaluation composition', () => {
  it('keeps clock state separate from continuous evaluation state', () => {
    const clock = new ManualClock(0);
    const session = new ContinuousPracticeSession({ ...continuousSessionPlan(artifact, { scope: { kind: 'FULL' }, inputSource: 'MIDI' }), createClockEvidence: domainId => new ContinuousMidiEvidence(domainId), tempoPlan: defaultTempoPlan, clock, countInBeats: 0, localSessionId: 'continuous-clock-separate' });

    expect(session.advanceToNow().state).toBe('READY');
    expect(session.evaluationSnapshot.assignment.groups.flatMap(group => group.strikes)).toHaveLength(
      artifact.moments.reduce((sum, group) => sum + group.attacks.length, 0)
    );
    expect(session.evaluationSnapshot.assignment.groups.flatMap(group => group.strikes).every((strike) => strike.state === 'PENDING')).toBe(true);

    session.start();
    const before = session.advanceToNow();
    expect(session.observeMidiAttack(midiAttack('continuous-clock-separate', 0, [60]))).toBe(true);
    expect(session.advanceToNow().performanceTimeMs).toBe(before.performanceTimeMs);
    expect(session.evaluationSnapshot.assignment.groups.flatMap(group => group.strikes)[0]).toMatchObject({ state: 'PENDING' });
    clock.advance(1_500);
    session.advanceToNow();
    expect(session.evaluationSnapshot.assignment.groups.flatMap(group => group.strikes)[0]).toMatchObject({ state: 'MATCHED' });
  });

  it('MIDI produces canonical target assignment states through the sole accumulated evaluator', () => {
    const clock = new ManualClock(0);
    const session = new ContinuousPracticeSession({ ...continuousSessionPlan(artifact, { scope: { kind: 'FULL' }, inputSource: 'MIDI', tempoSelection: { mode: 'CUSTOM_FIXED_BPM', bpm: 60 } }), createClockEvidence: domainId => new ContinuousMidiEvidence(domainId), clock, countInBeats: 0, localSessionId: 'target-states' });
    session.start();
    let now = 0;
    for (const [time, pianoKey] of [[0, 60], [2000, 66], [3000, 69], [3900, 66], [4500, 74]] as const) {
      clock.advance(time - now); now = time;
      const before = session.clock.snapshot();
      session.observeMidiAttack(midiAttack(session.timebase.domainId, time, [pianoKey]));
      expect(session.clock.snapshot().performanceTimeMs).toBe(before.performanceTimeMs);
    }
    clock.advance(2500); session.advanceToNow();
    const completed = session.completedEvaluation();
    if (completed.status !== 'COMPLETE') throw new Error('incomplete MIDI truth');
    expect(completed.assignment.groups.map(group => group.strikes.map(strike => strike.state))).toEqual([['MATCHED'], ['UNMATCHED'], ['UNMATCHED'], ['MATCHED', 'UNMATCHED'], ['MATCHED']]);
    expect(completed.assignment.unattributedObservations).toHaveLength(2);
    expect(completed.assignment.observationAssignments.map(owner => owner.kind).sort()).toEqual(['STRIKE_MATCH', 'STRIKE_MATCH', 'STRIKE_MATCH', 'UNATTRIBUTED', 'UNATTRIBUTED']);
    expect(completed.assignment.groups).toEqual(session.evaluationSnapshot.assignment.groups);
  });

  it('does not advance MIDI frontier while paused', () => {
    const clock = new ManualClock(0);
    const session = new ContinuousPracticeSession({ ...continuousSessionPlan(artifact, { scope: { kind: 'FULL' }, inputSource: 'MIDI' }), createClockEvidence: domainId => new ContinuousMidiEvidence(domainId), tempoPlan: defaultTempoPlan, clock, countInBeats: 0, localSessionId: 'continuous-midi-pause' });

    session.start();
    clock.advance(100);
    session.pause();
    clock.advance(5_000);
    expect(session.evaluationSnapshot.assignment.groups.flatMap(group => group.strikes)[1]).toMatchObject({ state: 'PENDING' });
  });

  it('retains an incompatible physical attack once as UNATTRIBUTED, never a target match', () => {
    const twoGroupArtifact = artifactWithKeys([[60], [60]]);
    twoGroupArtifact.events[1].onsetBeat = 0.6;
    twoGroupArtifact.moments[1].onsetBeat = 0.6;
    twoGroupArtifact.moments[1].canonicalEndBeat = 1.6;
    twoGroupArtifact.scoreEndBeat = 1.6;
    const extraClock = new ManualClock(0);
    const session = new ContinuousPracticeSession({ ...continuousSessionPlan(twoGroupArtifact, { scope: { kind: 'FULL' }, inputSource: 'MIDI' }), createClockEvidence: domainId => new ContinuousMidiEvidence(domainId), tempoPlan: defaultTempoPlan, clock: extraClock, countInBeats: 0, localSessionId: 'continuous-global-extra' });

    session.start();
    extraClock.advance(150);
    expect(session.observeMidiAttack(midiAttack(session.timebase.domainId, 150, [66]))).toBe(true);
    expect(session.evaluationSnapshot.assignment.unattributedObservations).toHaveLength(0);
    extraClock.advance(500);
    session.advanceToNow();
    extraClock.advance(1500);
    session.advanceToNow();
    expect(session.evaluationSnapshot.assignment.unattributedObservations).toHaveLength(1);
    expect(session.evaluationSnapshot.assignment.observationAssignments.filter(owner => owner.kind === 'UNATTRIBUTED')).toHaveLength(1);
  });

  it('syncs natural clock auto-end into final continuous evaluation without explicit end', () => {
    const naturalClock = new ManualClock(0);
    const natural = new ContinuousPracticeSession({ ...continuousSessionPlan(artifact, { scope: { kind: 'FULL' }, inputSource: 'MIDI' }), createClockEvidence: domainId => new ContinuousMidiEvidence(domainId), tempoPlan: defaultTempoPlan, clock: naturalClock, countInBeats: 0 });
    natural.start();
    naturalClock.advance(20_000);
    const snapshot = natural.advanceToNow();
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
    const manual = new ContinuousPracticeSession({ ...continuousSessionPlan(artifact, { scope: { kind: 'FULL' }, inputSource: 'MIDI' }), createClockEvidence: domainId => new ContinuousMidiEvidence(domainId), tempoPlan: defaultTempoPlan, clock: manualClock, countInBeats: 0 });
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
    const manual = new ContinuousPracticeSession({ ...continuousSessionPlan(artifact, { scope: { kind: 'FULL' }, inputSource: 'MIDI' }), createClockEvidence: domainId => new ContinuousMidiEvidence(domainId), tempoPlan: defaultTempoPlan, clock: manualClock, countInBeats: 0 });
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
    const manual = new ContinuousPracticeSession({ ...continuousSessionPlan(artifact, { scope: { kind: 'FULL' }, inputSource: 'MIDI' }), createClockEvidence: domainId => new ContinuousMidiEvidence(domainId), tempoPlan: defaultTempoPlan, clock: manualClock, countInBeats: 0, localSessionId: 'midi-stop-match' });
    manual.start();
    manualClock.advance(100);
    expect(manual.observeMidiAttack(midiAttack(manual.timebase.domainId, 0, [60]))).toBe(true);
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
      const session = new ContinuousPracticeSession({ ...continuousSessionPlan(artifact, { scope: { kind: 'FULL' }, inputSource: 'MIDI' }), createClockEvidence: domainId => new ContinuousMidiEvidence(domainId), tempoPlan: defaultTempoPlan, clock: offlineClock, countInBeats: 0, localSessionId: 'active-session-network-loss' });

      expect(session.start()).toMatchObject({ state: 'RUNNING', performanceTimeMs: 0 });
      expect(session.observeMidiAttack(midiAttack(session.timebase.domainId, 0, [60]))).toBe(true);
      offlineClock.advance(500);
      expect(session.advanceToNow()).toMatchObject({ state: 'RUNNING', performanceTimeMs: 500 });
      session.pause();
      offlineClock.advance(1_000);
      expect(session.advanceToNow()).toMatchObject({ state: 'PAUSED', performanceTimeMs: 500 });
      const resumed = session.resume();
      offlineClock.advance(resumed.countInRemainingMs + 600);
      expect(session.advanceToNow()).toMatchObject({ state: 'RUNNING', performanceTimeMs: 1100 });
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
    const session = new ContinuousPracticeSession({ ...continuousSessionPlan(artifact, { scope: { kind: 'FULL' }, inputSource: 'MICROPHONE' }), tempoPlan: defaultTempoPlan, clock, countInBeats: 0 });
    session.start();
    clock.advance(1000);
    session.end('STOPPED_BY_USER');

    expect(session.completedEvaluation()).toEqual({
      status: 'UNAVAILABLE', inputSource: 'MICROPHONE', assignmentPolicyId: CONTINUOUS_ASSIGNMENT_POLICY_ID, reason: 'INCOMPLETE_ANALYSIS',
    });
  });

  it('uses capture-time performance membership and closes ordinary MIDI evidence after completion', () => {
    const clock = new ManualClock(0);
    const tempoPlan = resolvePracticeTempoPlan(artifact, { mode: 'SCORE' });
    const runtime = new ContinuousPracticeSession({ ...continuousSessionPlan(artifact, { scope: {
        kind: 'RANGE',
        startGroupId: artifact.moments[0].groupId,
        endGroupId: artifact.moments[0].groupId,
      }, inputSource: 'MIDI' }), createClockEvidence: domainId => new ContinuousMidiEvidence(domainId), tempoPlan, clock, countInBeats: 3 });
    // Before start: state is READY
    const evidence = midiAttack(runtime.timebase.domainId, 100, [60]);
    expect(runtime.observeMidiAttack(evidence)).toBe(false);

    // Start with count-in: state is COUNT_IN
    runtime.start();
    expect(runtime.advanceToNow().state).toBe('COUNT_IN');
    expect(runtime.observeMidiAttack(evidence)).toBe(false);

    // Advance past count-in into RUNNING
    const countInTotalMs = runtime.advanceToNow().countInTotalMs;
    clock.advance(countInTotalMs + 10);
    expect(runtime.advanceToNow().state).toBe('RUNNING');
    clock.advance(90);
    const runningEvidence = midiAttack(runtime.timebase.domainId, countInTotalMs + 100, [60]);
    expect(runtime.observeMidiAttack(runningEvidence)).toBe(true);

    // Pause: state is PAUSED
    runtime.pause();
    expect(runtime.advanceToNow().state).toBe('PAUSED');
    expect(runtime.observeMidiAttack(midiAttack(runtime.timebase.domainId, countInTotalMs + 200, [60]))).toBe(false);
    runtime.resume();
    clock.advance(500);
    const lateRunningEvidence = midiAttack(runtime.timebase.domainId, countInTotalMs + 250, [60]);

    // End: state is ENDED
    runtime.end('STOPPED_BY_USER');
    expect(runtime.advanceToNow().state).toBe('ENDED');
    expect(runtime.observeMidiAttack(lateRunningEvidence)).toBe(false);
    expect(runtime.observeMidiAttack(midiAttack(runtime.timebase.domainId, clock.nowMs() + 100, [60]))).toBe(false);
  });

  it("uses native MIDI capture time rather than callback availability", () => {
    const midiTimebase = new PracticeTimebase({ domainId: 'normalized-midi' });
    const performanceClock = new ManualClock(0);
    const performance = new ContinuousPracticeSession({ ...continuousSessionPlan(artifact, { scope: { kind: 'FULL' }, inputSource: 'MIDI' }), createClockEvidence: domainId => new ContinuousMidiEvidence(domainId), tempoPlan: defaultTempoPlan, clock: performanceClock, countInBeats: 0, localSessionId: 'normalized-midi', timebase: midiTimebase });
    performance.start();
    performanceClock.advance(100);
    const evaluated = performance.observeMidiAttack({
      captureTime: midiTimebase.midiEventToSessionTime(0),
      pianoKey: 60,
      confidence: 1,

    });
    expect(evaluated).toBe(true);
    expect(performance.evaluationSnapshot.assignment.groups.flatMap(group => group.strikes)[0]).toMatchObject({ state: 'PENDING' });
    performanceClock.advance(1_000);
    performance.advanceToNow();
    expect(performance.evaluationSnapshot.assignment.groups.flatMap(group => group.strikes)[0]).toMatchObject({
      state: 'MATCHED',
      match: { timingOffsetMs: 0 },
    });

  });

  it("rejects a scope with no playable target", () => {

    const empty = cloneArtifact({
      artifactId: 'empty-artifact',

      scoreEndBeat: 0,
      notes: [],
      events: [],
      moments: [],
    });
    expect(() => new ContinuousPracticeSession({ ...continuousSessionPlan(empty, { scope: { kind: 'FULL' }, inputSource: 'MICROPHONE' }), tempoPlan: resolvePracticeTempoPlan(empty, { mode: 'SCORE' }), clock: new ManualClock() })).toThrow('Practice scope requires at least one expected group.');

  });

  it("owns live metronome selection in Continuous session snapshots", () => {

    const art = cloneArtifact();
    const clock = new ManualClock(100);

    const perfRuntime = new ContinuousPracticeSession({ ...continuousSessionPlan(art, { scope: { kind: 'FULL' }, inputSource: 'MICROPHONE', metronomeEnabled: false }), clock, metronomeEnabled: false });
    expect(perfRuntime.snapshotSession().metronomeEnabled).toBe(false);

    perfRuntime.setMetronomeEnabled(true);
    expect(perfRuntime.snapshotSession().metronomeEnabled).toBe(true);

  });

  it("persists enabled and disabled metronome selection through Continuous completion", () => {

    const art = cloneArtifact();
    const clock = new ManualClock(0);

    const perfA = new ContinuousPracticeSession({ ...continuousSessionPlan(art, { scope: { kind: 'FULL' }, inputSource: 'MICROPHONE', metronomeEnabled: false }), clock, metronomeEnabled: false });
    perfA.start();
    expect(perfA.snapshotSession().metronomeEnabled).toBe(false);
    perfA.setMetronomeEnabled(true);
    expect(perfA.snapshotSession().metronomeEnabled).toBe(true);
    perfA.end('STOPPED_BY_USER');
    const finalPerfA = perfA.snapshotSession();
    expect(finalPerfA.lifecycleState).toBe('ENDED');
    expect(finalPerfA.metronomeEnabled).toBe(true);

    const perfB = new ContinuousPracticeSession({ ...continuousSessionPlan(art, { scope: { kind: 'FULL' }, inputSource: 'MICROPHONE', metronomeEnabled: true }), clock, metronomeEnabled: true });
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
    const session = new ContinuousPracticeSession({ ...continuousSessionPlan(artifact, { scope: { kind: 'FULL' }, inputSource: 'MIDI' }), clock, countInBeats: 0, createClockEvidence: domainId => {
        const evidence = new ContinuousMidiEvidence(domainId);
        return {
          observe: (...args) => evidence.observe(...args),
          nextDeadline: frontier => evidence.nextDeadline(frontier),
          cover: (...args) => evidence.cover(...args),
          complete: (...args) => {
            events.push('coverage');
            return evidence.complete(...args);
          },
        };
      } });
    session.start();
    clock.advance(100);
    session.observeMidiAttack({
      pianoKey: 60, confidence: 1, captureTime: session.timebase.atSessionMs(0),
    });
    session.end();
    session.advanceToNow();
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
  const session = new ContinuousPracticeSession({ ...continuousSessionPlan(artifact, { scope: { kind: 'FULL' }, inputSource: 'MIDI' }), createClockEvidence: domainId => new ContinuousMidiEvidence(domainId), tempoPlan: defaultTempoPlan, clock, countInBeats: 0, localSessionId: 'continuous-midi-frontier' });

  session.start();
  clock.advance(1_000);
  expect(session.advanceToNow().state).toBe('RUNNING');
  expect(session.evaluationSnapshot.assignment.groups.flatMap(group => group.strikes)[0]).toMatchObject({ state: 'UNMATCHED' });
});
