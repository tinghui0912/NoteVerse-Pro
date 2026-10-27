import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { sourcePublication, type SourceAcousticPublication } from '../acoustic/runtime/source-publication';
import { planWindow } from '../acoustic/runtime/window-planner';
import type { StepPitchEvidence } from '@/lib/practice/step/domain/attempt';
import type { PracticeScoreArtifact } from '@/lib/practice/kernel/artifact';
import fixture from '@/lib/practice/__fixtures__/canonical-practice-score-artifact.json';
import { ManualClock } from '@/lib/practice/kernel/timebase';
import { StepPracticeRuntime } from '@/lib/practice/step/domain/runtime';
import { StepAcousticAttemptAssembler, STEP_ACOUSTIC_GESTURE_MS, type StepAcousticAssemblerOptions } from './step-acoustic-attempt-assembler';

const start = 57600, end = 86400;
const event = (sample: number, pitch = 'C4', confidence = .8) => ({ targetSample: sample / 3, pitch,
  midiPitch: ({ C4: 60, C5: 72, E4: 64, G4: 67 } as Record<string, number>)[pitch], confidence, onsetScore: .8, frameScore: .8 });
function publication(job: number, events: ReturnType<typeof event>[] = [], availabilityRuntimeMs = 0) {
  const window = planWindow({ index: 0, sourceStart: start, originTarget: start / 3, nextWindow: job, queuedEndTarget: 0 }, job)!;
  return sourcePublication('source', 48000, 0, window, { events, inferenceMs: 0, decodeMs: 0, actualSessionRunCount: job + 1 }, availabilityRuntimeMs);
}
function setup(open = vi.fn((): number | null => 1)) {
  const completed: { identity: number; evidence: StepPitchEvidence }[] = [];
  const assembler = new StepAcousticAttemptAssembler({ sourceDomainId: 'source', sourceSampleRateHz: 48000,
    localSessionId: 'session', sourceAnchorSample: 0, sessionAnchorTime: { domainId: 'session', ms: 0 },
    sink: { open, complete: (identity, evidence) => { completed.push({ identity, evidence }); } } });
  assembler.acceptInputAfter(start + 2); return { assembler, completed, open };
}

describe('score-blind H50 ownership over the canonical source stream', () => {
  it('ignores exact physical watermark and accepts the next source event', () => {
    const s = setup(); s.assembler.acceptInputAfter(start + 3);
    const sealed = s.assembler.accept(publication(0, [event(start + 3), event(start + 6)]));
    expect(sealed).toMatchObject({ anchorSourceSample: start + 6, endSourceSample: start + 2406 });
    expect(s.open).toHaveBeenCalledExactlyOnceWith({ domainId: 'session', ms: (start + 6) / 48000 * 1000, sampleIndex: start + 6 });
    expect(sealed?.observations.map(o => o.sourceEventSample)).toEqual([start + 6]);
  });
  it('preserves inclusive anchor, exclusive H50 edge, exact pitch set and minimum confidence', () => {
    const s = setup();
    const sealed = s.assembler.accept(publication(0, [event(start + 2403, 'G4', .1), event(start + 2400, 'E4', .4),
      event(start + 3, 'C5', .7), event(start + 3, 'C4', .9)]));
    expect(STEP_ACOUSTIC_GESTURE_MS).toBe(50);
    expect(sealed?.observations.map(o => o.pitch)).toEqual(['C4', 'C5', 'E4']);
    expect(sealed?.evidence).toMatchObject({ observedAttackPitches: ['C4', 'C5', 'E4'], confidence: .4,
      captureEndSessionTime: { domainId: 'session', ms: (start + 2403) / 48000 * 1000, sampleIndex: start + 2403 } });
    expect(s.completed).toHaveLength(1); expect(s.assembler.snapshot().phase).toBe('BLOCKED');
  });
  it('seals across consecutive windows only after coverage, never on a wall timer', () => {
    vi.useFakeTimers();
    try {
      const s = setup(); expect(s.assembler.accept(publication(0, [event(end - 3)]))).toBeNull();
      expect(s.assembler.snapshot().activeObservationCount).toBe(1);
      vi.advanceTimersByTime(100000); expect(s.completed).toHaveLength(0);
      const sealed = s.assembler.accept(publication(1, [event(end, 'E4', .3)], 999999));
      expect(sealed?.observations.map(o => o.sourceEventSample)).toEqual([end - 3, end]);
      expect(sealed?.evidence.confidence).toBe(.3); expect(s.completed).toHaveLength(1);
      expect(s.assembler.snapshot().activeObservationCount).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it('retired delayed analysis is new source chronology but cannot open the next gesture', () => {
    const s = setup(); s.assembler.accept(publication(0, [event(start + 3)]));
    s.assembler.accept(publication(1, [event(end + 3, 'E4')]));
    s.assembler.acceptInputAfter(150000); // physical capture is ahead of analysis (115200)
    expect(s.assembler.accept(publication(2, [event(120000), event(140001)], 999999))).toBeNull();
    expect(s.open).toHaveBeenCalledTimes(1); expect(s.completed).toHaveLength(1);
    const fresh = s.assembler.accept(publication(3, [event(149997), event(150000), event(150003)], 1000000));
    expect(fresh?.anchorSourceSample).toBe(150003); expect(s.completed).toHaveLength(2);
  });
  it('a rejected domain open blocks, discards, and never queues another gesture', () => {
    const s = setup(vi.fn(() => null));
    s.assembler.accept(publication(0, [event(start + 3)])); s.assembler.accept(publication(1, [event(end + 3)]));
    expect(s.open).toHaveBeenCalledTimes(1); expect(s.completed).toHaveLength(0);
    expect(s.assembler.snapshot()).toMatchObject({ phase: 'BLOCKED', processedThroughSourceSample: end + 28800, activeObservationCount: 0 });
  });
  it('one publication cannot collect a second gesture or extend H50', () => {
    const s = setup(); const sealed = s.assembler.accept(publication(0, [event(start + 3), event(start + 3000, 'E4')]));
    expect(sealed?.endSourceSample).toBe(start + 2403); expect(sealed?.observations).toHaveLength(1);
    expect(s.completed).toHaveLength(1);
    expect(() => s.assembler.acceptInputAfter(end - 1)).toThrow('STEP_ACOUSTIC_RETIREMENT_INVALID');
  });
  it.each(['replay', 'mutated-replay', 'job-gap', 'window-gap', 'regression', 'old-event', 'alias', 'duplicate', 'window-replay'] as const)(
    '%s is a terminal source-contract violation, including while BLOCKED', kind => {
      const s = setup(), old = publication(0, [event(start + 3)]); s.assembler.accept(old);
      const p = structuredClone(publication(1, [event(end + 3)]));
      let corrupt: SourceAcousticPublication = p;
      if (kind === 'replay') corrupt = old;
      if (kind === 'mutated-replay') corrupt = { ...old, observations: [{ ...old.observations[0], confidence: .1 }] };
      if (kind === 'job-gap') corrupt = { ...p, window: { ...p.window, jobIndex: 2 } };
      if (kind === 'window-gap') corrupt = { ...p, window: { ...p.window, windowIndex: 2 } };
      if (kind === 'window-replay') corrupt = { ...p, window: { ...p.window, windowIndex: 0 } };
      if (kind === 'regression') corrupt = { ...p, ownedThroughSourceSample: end };
      if (kind === 'old-event') corrupt = { ...p, observations: [{ ...p.observations[0], sourceEventSample: start + 3 }] };
      if (kind === 'alias') corrupt = { ...p, observations: [{ ...p.observations[0], observationId: 'forged-alias' }] };
      if (kind === 'duplicate') corrupt = { ...p, observations: [p.observations[0], p.observations[0]] };
      const before = structuredClone(corrupt);
      expect(() => s.assembler.accept(corrupt)).toThrow(); expect(corrupt).toEqual(before);
      expect(s.assembler.snapshot()).toMatchObject({ phase: 'FAILED', activeObservationCount: 0 });
      expect(() => s.assembler.acceptInputAfter(200000)).toThrow('STEP_ACOUSTIC_ASSEMBLER_UNAVAILABLE');
    });
  it.each([1, 2])('active H50 cannot cross published region 0 to %i, including empty intervening regions', region => {
    const s = setup(); s.assembler.accept(publication(0, [event(end - 3)]));
    const window = planWindow({ index: region, sourceStart: 120000, originTarget: 40000, nextWindow: 0, queuedEndTarget: 40000 }, 1)!;
    const p = sourcePublication('source', 48000, 0, window, { events: [], inferenceMs: 0, decodeMs: 0, actualSessionRunCount: 2 }, 1);
    expect(() => s.assembler.accept(p)).toThrow('STEP_ACOUSTIC_GESTURE_COVERAGE_GAP');
    expect(s.completed).toHaveLength(0);
  });
  it.each(['BLOCKED', 'READY'] as const)('accepts a visible region jump in %s but retires old physical evidence', phase => {
    const s = setup(); if (phase === 'BLOCKED') s.assembler.suspend();
    s.assembler.accept(publication(0));
    if (phase === 'READY') s.assembler.acceptInputAfter(150000);
    expect(s.assembler.snapshot()).toMatchObject({ phase, activeObservationCount: 0 });
    const window = planWindow({ index: 2, sourceStart: 120000, originTarget: 40000, nextWindow: 0, queuedEndTarget: 40000 }, 1)!;
    const p = sourcePublication('source', 48000, 0, window,
      { events: [event(120000), event(140001)], inferenceMs: 0, decodeMs: 0, actualSessionRunCount: 2 }, 1);
    expect(p.ownedThroughSourceSample).toBeGreaterThan(end);
    expect(s.assembler.accept(p)).toBeNull();
    expect(s.assembler.snapshot()).toMatchObject({ phase, processedThroughSourceSample: 148800, activeObservationCount: 0 });
    expect(s.open).not.toHaveBeenCalled(); expect(s.completed).toEqual([]);
    s.assembler.acceptInputAfter(150000);
    const nextWindow = planWindow({ index: 2, sourceStart: 120000, originTarget: 40000, nextWindow: 1, queuedEndTarget: 49600 }, 2)!;
    const next = sourcePublication('source', 48000, 0, nextWindow,
      { events: [event(150000), event(150003)], inferenceMs: 0, decodeMs: 0, actualSessionRunCount: 3 }, 2);
    expect(s.assembler.accept(next)?.anchorSourceSample).toBe(150003);
    expect(s.completed).toHaveLength(1);
  });
  it('cannot swallow callback reentrancy and revive ownership', () => {
    const a: StepAcousticAttemptAssembler<number> = new StepAcousticAttemptAssembler({ sourceDomainId: 'source', sourceSampleRateHz: 48000,
      localSessionId: 'session', sourceAnchorSample: 0, sessionAnchorTime: { domainId: 'session', ms: 0 }, sink: {
        open: () => { try { a.suspend(); } catch { /* Malicious callback. */ } return 1; }, complete: () => {},
      } });
    a.acceptInputAfter(0); expect(() => a.accept(publication(0, [event(start + 3)]))).toThrow();
    expect(a.snapshot()).toMatchObject({ phase: 'FAILED', gestureAnchorSourceSample: null });
  });
  it('copies active evidence instead of retaining mutable input aliases', () => {
    const s = setup(), p = structuredClone(publication(0, [event(end - 3)])); s.assembler.accept(p);
    (p.observations[0] as { confidence: number }).confidence = .1;
    const sealed = s.assembler.accept(publication(1));
    expect(sealed?.evidence.confidence).toBe(.8); expect(Object.isFrozen(sealed?.observations[0])).toBe(true);
  });
  it.each([44100, 48000] as const)('%i preserves fractional source identity and session anchor mapping', rate => {
    const opened: unknown[] = [], base = 50000, target = 19201, sample = (base * 16000 + target * rate) / 16000;
    const a = new StepAcousticAttemptAssembler({ sourceDomainId: 'source', sourceSampleRateHz: rate, localSessionId: 'local',
      sourceAnchorSample: base, sessionAnchorTime: { domainId: 'local', ms: 10000 }, sink: { open: t => { opened.push(t); return 1; }, complete: () => {} } });
    a.acceptInputAfter(base);
    const window = planWindow({ index: 0, sourceStart: 0, originTarget: 19200, nextWindow: 0, queuedEndTarget: 0 }, 0)!;
    a.accept(sourcePublication('source', rate, base, window, { events: [{ ...event(target * 3), targetSample: target }],
      inferenceMs: 0, decodeMs: 0, actualSessionRunCount: 1 }, 0));
    expect(opened).toEqual([{ domainId: 'local', ms: 10000 + (sample - base) / rate * 1000, sampleIndex: sample }]);
  });
  it('rejects invalid domain/rate/coordinates and callback rearm', () => {
    for (const p of [{ ...publication(0), sourceDomainId: 'other' }, { ...publication(0), ownedThroughSourceSample: NaN },
      { ...publication(0), sourceSampleRateHz: 44100 as const }]) expect(() => setup().assembler.accept(p)).toThrow();
    const a: StepAcousticAttemptAssembler<number> = new StepAcousticAttemptAssembler({ sourceDomainId: 'source', sourceSampleRateHz: 48000,
      localSessionId: 'local', sourceAnchorSample: 0, sessionAnchorTime: { domainId: 'local', ms: 0 },
      sink: { open: () => 1, complete: () => a.acceptInputAfter(end) } });
    a.acceptInputAfter(0); expect(() => a.accept(publication(0, [event(start + 3)]))).toThrow(); expect(a.snapshot().phase).toBe('FAILED');
  });
  it('thousands of retire/rearm and BLOCKED windows retain only current H50 and one chronology summary', () => {
    const a = new StepAcousticAttemptAssembler({ sourceDomainId: 'source', sourceSampleRateHz: 48000,
      localSessionId: 'session', sourceAnchorSample: 0, sessionAnchorTime: { domainId: 'session', ms: 0 },
      sink: { open: () => 1, complete: () => {} } });
    const shape = Object.keys(a.snapshot());
    const ownedShape = (value: unknown): unknown => {
      expect(value instanceof Map || value instanceof Set || Array.isArray(value)).toBe(false);
      return value && typeof value === 'object'
        ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, ownedShape(child)])) : typeof value;
    };
    let initialOwnedShape: unknown;
    for (let job = 0; job < 6000; job++) {
      const anchor = start + job * 28800 + 3;
      if (job % 2 === 0) a.acceptInputAfter(anchor - 3);
      a.accept(publication(job, [event(anchor), event(anchor + 3, 'E4')]));
      expect(a.snapshot().activeObservationCount).toBe(0);
      expect(Object.keys(a.snapshot())).toEqual(shape);
      // Inspect the complete owned graph, including the source sequence summary.
      const retained = ownedShape(a);
      if (job === 0) initialOwnedShape = retained;
      else expect(retained).toEqual(initialOwnedShape);
      expect(a.snapshot()).not.toHaveProperty('retainedObservationIdentityCount');
    }
    expect(a.snapshot()).toMatchObject({ phase: 'BLOCKED', processedThroughSourceSample: end + 5999 * 28800 });
  });
});

it('identical targets use physical retirement and new chronology, not a session identity ledger', () => {
  const base = fixture as PracticeScoreArtifact;
  const artifact = { ...base,
    expectedPracticeGroups: base.expectedPracticeGroups.slice(0, 2).map(g => ({ ...g, pitches: ['C4'], strikeTargets: [{ ...g.strikeTargets[0], pitch: 'C4' }] })),
    practiceAttackSteps: base.practiceAttackSteps.slice(0, 2).map(s => ({ ...s, attackTargets: [{ ...s.attackTargets[0], pitch: 'C4' }] })) };
  const domainId = 'same-target', time = (sample: number) => ({ domainId, ms: sample / 48000 * 1000, sampleIndex: sample });
  const runtime = new StepPracticeRuntime({ artifact, scope: { kind: 'FULL' }, inputSource: 'MICROPHONE', clock: new ManualClock(), localSessionId: domainId });
  const records: unknown[] = [];
  const a = new StepAcousticAttemptAssembler({ sourceDomainId: 'source', sourceSampleRateHz: 48000, localSessionId: domainId,
    sourceAnchorSample: 0, sessionAnchorTime: time(0), sink: { open: t => runtime.openAttempt(t), complete: (id, evidence) => {
      runtime.analyzeAttempt(id); records.push(runtime.completeAttempt(id, evidence));
    } } });
  a.acceptInputAfter(0); a.accept(publication(0, [event(start + 3)]));
  a.accept(publication(1, [event(end + 3)])); // POST_VERDICT: discarded
  runtime.rearm(time(150000)); a.acceptInputAfter(150000);
  a.accept(publication(2, [event(120000)])); // newly analyzed, physically retired
  expect(records).toHaveLength(1); expect(runtime.snapshot().step).toMatchObject({ currentIndex: 1, attemptState: 'READY' });
  a.accept(publication(3, [event(150000), event(150003)]));
  expect(records).toHaveLength(2); expect(runtime.isCompleted).toBe(false); runtime.rearm(time(180000));
  expect(runtime.isCompleted).toBe(true);
});

it.each(['CAPTURING', 'ANALYZING', 'POST_VERDICT'] as const)('busy %s refuses another acoustic gesture without queuing', phase => {
  const runtime = new StepPracticeRuntime({ artifact: fixture as PracticeScoreArtifact, scope: { kind: 'FULL' }, inputSource: 'MICROPHONE', clock: new ManualClock(), localSessionId: 'busy' });
  const first = runtime.openAttempt({ domainId: 'busy', ms: .001 })!;
  if (phase !== 'CAPTURING') runtime.analyzeAttempt(first);
  if (phase === 'POST_VERDICT') runtime.completeAttempt(first, { observedAttackPitches: ['A0'], confidence: .8, captureEndSessionTime: { domainId: 'busy', ms: .002 } });
  const complete = vi.fn();
  const a = new StepAcousticAttemptAssembler({ sourceDomainId: 'source', sourceSampleRateHz: 48000, localSessionId: 'busy', sourceAnchorSample: 0,
    sessionAnchorTime: { domainId: 'busy', ms: 0 }, sink: { open: t => runtime.openAttempt(t), complete } });
  a.acceptInputAfter(0); a.accept(publication(0, [event(start + 3)])); a.accept(publication(1, [event(end + 3)]));
  expect(complete).not.toHaveBeenCalled(); expect(a.snapshot().phase).toBe('BLOCKED'); expect(runtime.snapshot().step.attemptState).toBe(phase);
});
it('silence owns no gesture or timer', () => {
  vi.useFakeTimers();
  try {
    const s = setup();
    for (let job = 0; job < 10; job++) { s.assembler.accept(publication(job)); vi.advanceTimersByTime(100000);
      expect(s.assembler.snapshot()).toMatchObject({ phase: 'READY', activeObservationCount: 0 }); }
    expect(s.open).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});
it('assembler options contain only source mapping and opaque sink ownership', () => {
  expectTypeOf<keyof StepAcousticAssemblerOptions<number>>().toEqualTypeOf<
    'sourceDomainId' | 'sourceSampleRateHz' | 'localSessionId' | 'sourceAnchorSample' | 'sessionAnchorTime' | 'sink'
  >();
});
