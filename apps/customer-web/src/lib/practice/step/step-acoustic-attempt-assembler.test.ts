import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { SourceAcousticObservation, SourceAcousticPublication } from '../acoustic/runtime/source-publication';
import type { StepPitchEvidence } from '@/lib/practice/step/domain/attempt';
import type { PracticeScoreArtifact } from '@/lib/practice/kernel/artifact';
import fixture from '@/lib/practice/__fixtures__/canonical-practice-score-artifact.json';
import { ManualClock } from '@/lib/practice/kernel/timebase';
import { StepPracticeRuntime } from '@/lib/practice/step/domain/runtime';
import { StepAcousticAttemptAssembler, STEP_ACOUSTIC_GESTURE_MS, type StepAcousticAssemblerOptions } from './step-acoustic-attempt-assembler';

const observation = (sample: number, id = `o:${sample}`, pitch = 'C4', confidence = .8): SourceAcousticObservation => ({
  observationId: id, pitch, midiPitch: pitch === 'C5' ? 72 : 60, confidence,
  sourceDomainId: 'source', sourceSampleRateHz: 48000, sourceEventSample: sample, targetSample: Math.round(sample / 3),
});
const publication = (frontier: number, observations: readonly SourceAcousticObservation[], availabilityRuntimeMs = 0): SourceAcousticPublication => ({
  sourceDomainId: 'source', sourceSampleRateHz: 48000, ownedThroughSourceSample: frontier, availabilityRuntimeMs, observations,
  window: { jobIndex: 0, regionIndex: 0, windowIndex: 0, ownedStartTarget: 0, ownedEndTarget: frontier / 3, startSample: 0, endSample: 29120 },
});
function setup(open = vi.fn((): number | null => 1)) {
  const completed: { identity: number; evidence: StepPitchEvidence }[] = [];
  const assembler = new StepAcousticAttemptAssembler({ sourceDomainId: 'source', sourceSampleRateHz: 48000,
    localSessionId: 'session', sourceAnchorSample: 0, sessionAnchorTime: { domainId: 'session', ms: 0 },
    sink: { open, complete: (identity, evidence) => { completed.push({ identity, evidence }); } } });
  assembler.acceptInputAfter(2); return { assembler, completed, open };
}

describe('score-blind source-frontier H50 bounded ownership', () => {
  it('ignores exact watermark and accepts one source unit later with original sample mapping', () => {
    const s = setup();
    const sealed = s.assembler.accept(publication(5000, [observation(2), observation(3)]));
    expect(sealed).toMatchObject({ anchorSourceSample: 3, endSourceSample: 2403 });
    expect(s.open).toHaveBeenCalledExactlyOnceWith({ domainId: 'session', ms: 3 / 48000 * 1000, sampleIndex: 3 });
    expect(sealed?.observations.map(o => o.sourceEventSample)).toEqual([3]);
  });
  it('includes anchor and pre-right-edge events, excludes the exact right edge, preserves all pitches and minimum confidence', () => {
    const s = setup();
    const sealed = s.assembler.accept(publication(5000, [observation(2403, 'right', 'G4', .1), observation(2400, 'near', 'E4', .4),
      observation(3, 'b', 'C5', .7), observation(3, 'a', 'C4', .9)]));
    expect(STEP_ACOUSTIC_GESTURE_MS).toBe(50);
    expect(sealed?.observations.map(o => o.observationId)).toEqual(['a', 'b', 'near']);
    expect(sealed?.evidence).toMatchObject({ observedAttackPitches: ['C4', 'C5', 'E4'], confidence: .4,
      captureEndSessionTime: { domainId: 'session', ms: 2403 / 48000 * 1000, sampleIndex: 2403 } });
    expect(s.completed).toHaveLength(1); expect(s.assembler.snapshot().phase).toBe('BLOCKED');
  });
  it('waits for the source frontier, includes later in-window evidence and never seals on a wall timer', () => {
    vi.useFakeTimers();
    try {
      const s = setup(); expect(s.assembler.accept(publication(100, [observation(3)]))).toBeNull();
      vi.advanceTimersByTime(100000); expect(s.completed).toHaveLength(0);
      expect(s.assembler.accept(publication(1000, [observation(500, 'late-in-window', 'E4', .3)], 999999))).toBeNull();
      const sealed = s.assembler.accept(publication(2403, [], 1000000));
      expect(sealed?.observations.map(o => o.observationId)).toEqual(['o:3', 'late-in-window']);
      expect(sealed?.evidence).toMatchObject({ confidence: .3 }); expect(s.completed).toHaveLength(1);
    } finally { vi.useRealTimers(); }
  });
  it('retains an identical duplicate once across publications and never gives it a second ownership', () => {
    const s = setup(), o = observation(3);
    s.assembler.accept(publication(100, [o, { ...o }]));
    const sealed = s.assembler.accept(publication(5000, [{ ...o }])); expect(sealed?.observations).toHaveLength(1);
    s.assembler.acceptInputAfter(5000); expect(s.assembler.accept(publication(5000, [o]))).toBeNull();
    expect(s.completed).toHaveLength(1); expect(s.open).toHaveBeenCalledTimes(1);
  });
  it('mutated duplicate fails closed even after an external retirement boundary', () => {
    const s = setup(), o = observation(3); s.assembler.accept(publication(5000, [o])); s.assembler.acceptInputAfter(5000);
    expect(() => s.assembler.accept(publication(5000, [{ ...o, confidence: .5 }]))).toThrow('STEP_ACOUSTIC_MUTATED_OBSERVATION');
    expect(s.assembler.snapshot().phase).toBe('FAILED'); expect(() => s.assembler.acceptInputAfter(6000)).toThrow();
  });
  it('ignored non-READY input is never queued, even if its identity is republished after READY', () => {
    const s = setup(); s.assembler.suspend(); const ignored = observation(3000, 'busy');
    expect(s.assembler.accept(publication(4000, [ignored]))).toBeNull(); expect(s.open).not.toHaveBeenCalled();
    s.assembler.acceptInputAfter(4000);
    expect(s.assembler.accept(publication(4000, [ignored]))).toBeNull();
    const next = s.assembler.accept(publication(8000, [observation(4001, 'new')]));
    expect(next?.observations.map(o => o.observationId)).toEqual(['new']);
  });
  it('a rejected domain open blocks subsequent publications rather than retaining a second gesture', () => {
    const s = setup(vi.fn(() => null));
    s.assembler.accept(publication(1000, [observation(3)])); s.assembler.accept(publication(5000, [observation(1001)]));
    expect(s.open).toHaveBeenCalledTimes(1); expect(s.completed).toHaveLength(0); expect(s.assembler.snapshot().phase).toBe('BLOCKED');
  });
  it('blocked evidence and old delayed source timestamps cannot be rebound to a fresh boundary', () => {
    const s = setup(); s.assembler.accept(publication(5000, [observation(3)]));
    s.assembler.accept(publication(8000, [observation(6000, 'during-feedback')])); s.assembler.acceptInputAfter(8000);
    s.assembler.accept(publication(8000, [observation(6000, 'during-feedback')], 9999999));
    s.assembler.accept(publication(8000, [observation(7000, 'delayed-unseen')], 99999999));
    expect(s.open).toHaveBeenCalledTimes(1); expect(s.completed).toHaveLength(1);
  });
  it('does not extend H50 or collect a second gesture from the same publication', () => {
    const s = setup(); const sealed = s.assembler.accept(publication(10000, [observation(3), observation(3000, 'outside', 'E4')]));
    expect(sealed?.endSourceSample).toBe(2403); expect(sealed?.observations).toHaveLength(1);
    expect(s.open).toHaveBeenCalledTimes(1); expect(s.completed).toHaveLength(1);
    expect(() => s.assembler.acceptInputAfter(5000)).toThrow('STEP_ACOUSTIC_RETIREMENT_INVALID');
  });
  it('rejects new unretired observations behind an already-proven frontier', () => {
    const s = setup(); s.assembler.accept(publication(1000, []));
    expect(() => s.assembler.accept(publication(2000, [observation(500)]))).toThrow('STEP_ACOUSTIC_NONCHRONOLOGICAL_OBSERVATION');
  });
  it('cannot seal an active gesture across a missing window or a new source analysis region', () => {
    for (const window of [{ regionIndex: 0, windowIndex: 2 }, { regionIndex: 1, windowIndex: 0 }]) {
      const s = setup(); s.assembler.accept(publication(100, [observation(3)]));
      const p = publication(5000, []);
      expect(() => s.assembler.accept({ ...p, window: { ...p.window, ...window } })).toThrow('STEP_ACOUSTIC_GESTURE_COVERAGE_GAP');
      expect(s.completed).toHaveLength(0); expect(s.assembler.snapshot().phase).toBe('FAILED');
    }
  });
  it('a sink cannot swallow a reentrancy error and revive failed ownership', () => {
    const a: StepAcousticAttemptAssembler<number> = new StepAcousticAttemptAssembler({ sourceDomainId: 'source', sourceSampleRateHz: 48000,
      localSessionId: 'session', sourceAnchorSample: 0, sessionAnchorTime: { domainId: 'session', ms: 0 }, sink: {
        open: () => { try { a.suspend(); } catch { /* Deliberately malicious callback. */ } return 1; }, complete: () => {},
      } });
    a.acceptInputAfter(0); expect(() => a.accept(publication(5000, [observation(3)]))).toThrow();
    expect(a.snapshot().phase).toBe('FAILED'); expect(a.snapshot().gestureAnchorSourceSample).toBeNull();
  });
  it('copies and freezes bounded observation content rather than keeping mutable aliases', () => {
    const s = setup(), o = observation(3); s.assembler.accept(publication(100, [o]));
    (o as { confidence: number }).confidence = .1;
    const sealed = s.assembler.accept(publication(5000, [])); expect(sealed?.evidence).toMatchObject({ confidence: .8 });
    expect(Object.isFrozen(sealed?.observations[0])).toBe(true); expect(Object.isFrozen(sealed?.evidence)).toBe(true);
  });
  it.each([44100, 48000] as const)('%i source mapping is monotonic, domain-bound and preserves fractional sample identity', rate => {
    const opened: unknown[] = [];
    const assembler = new StepAcousticAttemptAssembler({ sourceDomainId: 'source', sourceSampleRateHz: rate, localSessionId: 'local',
      sourceAnchorSample: 50000, sessionAnchorTime: { domainId: 'local', ms: 10000 },
      sink: { open: t => { opened.push(t); return 'opaque'; }, complete: () => {} } });
    assembler.acceptInputAfter(50000);
    const sample = 50000 + rate / 16000;
    assembler.accept({ ...publication(50000 + rate, []), sourceSampleRateHz: rate,
      observations: [{ ...observation(sample), sourceSampleRateHz: rate }] });
    expect(opened).toEqual([{ domainId: 'local', ms: 10000 + (sample - 50000) / rate * 1000, sampleIndex: sample }]);
  });
  it('rejects wrong domain, wrong rate, nonfinite coordinates and reentrant callback readiness', () => {
    for (const p of [{ ...publication(5000, []), sourceDomainId: 'other' }, { ...publication(5000, []), ownedThroughSourceSample: NaN }]) {
      const s = setup(); expect(() => s.assembler.accept(p)).toThrow('STEP_ACOUSTIC_PUBLICATION_INVALID');
    }
    const s = setup(); expect(() => s.assembler.accept(publication(5000, [{ ...observation(3), sourceSampleRateHz: 44100 }]))).toThrow();
    const a: StepAcousticAttemptAssembler<number> = new StepAcousticAttemptAssembler({ sourceDomainId: 'source', sourceSampleRateHz: 48000, localSessionId: 'local', sourceAnchorSample: 0,
      sessionAnchorTime: { domainId: 'local', ms: 0 }, sink: { open: () => 1, complete: () => a.acceptInputAfter(5000) } });
    a.acceptInputAfter(0); expect(() => a.accept(publication(5000, [observation(3)]))).toThrow(); expect(a.snapshot().phase).toBe('FAILED');
  });
});

it('one persistent assembler plus actual STEP runtime cannot let one gesture satisfy identical consecutive targets', () => {
  const base = fixture as PracticeScoreArtifact;
  const artifact: PracticeScoreArtifact = { ...base,
    expectedPracticeGroups: base.expectedPracticeGroups.slice(0, 2).map(g => ({ ...g, pitches: ['C4'], strikeTargets: [{ ...g.strikeTargets[0], pitch: 'C4' }] })),
    practiceAttackSteps: base.practiceAttackSteps.slice(0, 2).map(s => ({ ...s, attackTargets: [{ ...s.attackTargets[0], pitch: 'C4' }] })) };
  const clock = new ManualClock(), domainId = 'same-target', time = (sample: number) => ({ domainId, ms: sample / 48000 * 1000, sampleIndex: sample });
  const runtime = new StepPracticeRuntime({ artifact, scope: { kind: 'FULL' }, inputSource: 'MICROPHONE', clock, localSessionId: domainId, metadataClock: { nowEpochMs: () => 0 } });
  const records: ReturnType<StepPracticeRuntime['completeAttempt']>[] = [];
  const assembler = new StepAcousticAttemptAssembler({ sourceDomainId: 'source', sourceSampleRateHz: 48000, localSessionId: domainId,
    sourceAnchorSample: 0, sessionAnchorTime: time(0), sink: {
      open: t => runtime.openAttempt(t), complete: (id, evidence) => { expect(runtime.analyzeAttempt(id)).toBe(true); records.push(runtime.completeAttempt(id, evidence)); },
    } });
  assembler.acceptInputAfter(0); const old = observation(3, 'one-gesture'); assembler.accept(publication(4800, [old]));
  expect(runtime.snapshot().step).toMatchObject({ currentIndex: 0, attemptState: 'POST_VERDICT' });
  runtime.rearm(time(4800)); assembler.acceptInputAfter(4800);
  expect(runtime.snapshot().step).toMatchObject({ currentIndex: 1, attemptState: 'READY' });
  for (const obs of [old, { ...old, observationId: 'delayed-alias' }]) assembler.accept(publication(4800, [obs], 9999999));
  expect(records).toHaveLength(1); expect(runtime.snapshot().step.pendingPostVerdict).toBeNull();
  assembler.accept(publication(9000, [observation(4800, 'equality'), observation(4801, 'genuinely-new')]));
  expect(records).toHaveLength(2); expect(runtime.isCompleted).toBe(false); runtime.rearm(time(10000));
  expect(runtime.isCompleted).toBe(true); expect(records[0].kind === 'FINALIZED' && records[0].record.attemptId).not.toBe(records[1].kind === 'FINALIZED' && records[1].record.attemptId);
});

it.each(['CAPTURING', 'ANALYZING', 'POST_VERDICT'] as const)('actual runtime %s refuses a second acoustic attempt without queuing it', phase => {
  const artifact = fixture as PracticeScoreArtifact, clock = new ManualClock(), domainId = 'occupied';
  const runtime = new StepPracticeRuntime({ artifact, scope: { kind: 'FULL' }, inputSource: 'MICROPHONE', clock, localSessionId: domainId });
  const first = runtime.openAttempt({ domainId, ms: .001 })!;
  if (phase !== 'CAPTURING') runtime.analyzeAttempt(first);
  if (phase === 'POST_VERDICT') runtime.completeAttempt(first, { observedAttackPitches: ['A0'], confidence: .8, captureEndSessionTime: { domainId, ms: .002 } });
  const complete = vi.fn();
  const assembler = new StepAcousticAttemptAssembler({ sourceDomainId: 'source', sourceSampleRateHz: 48000, localSessionId: domainId,
    sourceAnchorSample: 0, sessionAnchorTime: { domainId, ms: 0 }, sink: { open: time => runtime.openAttempt(time), complete } });
  assembler.acceptInputAfter(0); assembler.accept(publication(5000, [observation(3)])); assembler.accept(publication(9000, [observation(6000)]));
  expect(complete).not.toHaveBeenCalled(); expect(assembler.snapshot().phase).toBe('BLOCKED');
  expect(runtime.snapshot().step.attemptState).toBe(phase);
  expect(runtime.snapshot().step.pendingPostVerdict?.verdict ?? null).toBe(phase === 'POST_VERDICT' ? 'MISMATCH' : null);
});


it('silence advances source coverage without opening an attempt, verdict or timer', () => {
  vi.useFakeTimers();
  try {
    const s = setup();
    for (const frontier of [1000, 5000, 10000, 100000]) {
      expect(s.assembler.accept(publication(frontier, []))).toBeNull();
      vi.advanceTimersByTime(100000);
      expect(s.open).not.toHaveBeenCalled(); expect(s.completed).toEqual([]);
      expect(s.assembler.snapshot()).toMatchObject({ phase: 'READY', activeObservationCount: 0, retainedObservationIdentityCount: 0 });
    }
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});

it.each([100, 999999])('microphone superset mismatch preserves H50 retirement despite publication availability %s', availability => {
  const domainId = 'non-exact', time = (sample: number) => ({ domainId, ms: sample / 48000 * 1000, sampleIndex: sample });
  const runtime = new StepPracticeRuntime({ artifact: fixture as PracticeScoreArtifact, scope: { kind: 'FULL' }, inputSource: 'MICROPHONE', localSessionId: domainId, clock: new ManualClock() });
  const assembler = new StepAcousticAttemptAssembler({ sourceDomainId: 'source', sourceSampleRateHz: 48000,
    localSessionId: domainId, sourceAnchorSample: 0, sessionAnchorTime: time(0), sink: {
      open: t => runtime.openAttempt(t), complete: (id, evidence) => { runtime.analyzeAttempt(id); runtime.completeAttempt(id, evidence); },
    } });
  assembler.acceptInputAfter(0);
  assembler.accept(publication(4800, [observation(3,'target','C4'), observation(4,'additional','E4')], availability));
  const first = runtime.snapshot().step.pendingPostVerdict!;
  expect(first).toMatchObject({ verdict: 'MISMATCH',
    observedAttackPitches: ['C4','E4'], confidence: .8, captureEndSessionTime: time(2403) });
  expect(runtime.snapshot().step).toMatchObject({ currentIndex: 0, targetGeneration: 1, attemptState: 'POST_VERDICT' });
  runtime.rearm(time(4800)); assembler.acceptInputAfter(4800);
  assembler.accept(publication(9600, [observation(4000,'delayed'), observation(4800,'equality'), observation(4801,'new')], availability + 1000));
  const second = runtime.snapshot().step.pendingPostVerdict!;
  expect(second).toMatchObject({ verdict: 'MATCH', targetGeneration: 1, attemptStartSessionTime: time(4801), observedAttackPitches: ['C4'] });
  expect(second.attemptId).not.toBe(first.attemptId);
  expect(runtime.currentStepIndex).toBe(0); runtime.rearm(time(9600)); expect(runtime.currentStepIndex).toBe(1);
});


it('acoustic assembler options describe source chronology and opaque sink ownership only', () => {
  expectTypeOf<keyof StepAcousticAssemblerOptions<number>>().toEqualTypeOf<
    'sourceDomainId' | 'sourceSampleRateHz' | 'localSessionId' | 'sourceAnchorSample' | 'sessionAnchorTime' | 'sink'
  >();
});
