import { stepPracticePlan } from '@/lib/practice/__fixtures__/practice-plan';
import canonicalArtifactJson from '@/lib/practice/__fixtures__/canonical-practice-score-artifact.json';
import { leadingRestArtifact } from '@/lib/practice/__fixtures__/leading-rest-artifact';
import { type PracticeScoreArtifact } from '@/lib/practice/score/artifact';
import { ManualClock } from '@/lib/practice/session/timebase';
import { StepPracticeSession } from '@/lib/practice/step/domain/practice-session';
import { describe, expect, it } from 'vitest';
const artifact = canonicalArtifactJson as PracticeScoreArtifact;
function cloneArtifact(overrides: Partial<PracticeScoreArtifact> = {}): PracticeScoreArtifact {
  return structuredClone({ ...artifact, ...overrides });
}
describe('STEP runtime target and session contracts', () => {
  it("rejects a scope with no playable target", () => {

    const empty = cloneArtifact({
      artifactId: 'empty-artifact',

      scoreEndTick: 0,
      notes: [],
      events: [],
      moments: [],
    });
    expect(() => new StepPracticeSession({ plan: stepPracticePlan(empty, { scope: { kind: 'FULL' }, inputSource: 'MIDI' }), clock: new ManualClock() })).toThrow('Practice scope requires at least one expected group.');

  });

  it("retains live metronome selection in STEP snapshots", () => {

    const art = cloneArtifact();
    const clock = new ManualClock(100);

    const stepRuntime = new StepPracticeSession({ plan: stepPracticePlan(art, { scope: { kind: 'FULL' }, inputSource: 'MIDI', metronomeEnabled: false }), clock });
    expect(stepRuntime.snapshot().step.metronomeEnabled).toBe(false);
    expect(stepRuntime.currentOnsetTick).toBe(0);

    stepRuntime.setMetronomeEnabled(true);
    expect(stepRuntime.snapshot().step.metronomeEnabled).toBe(true);

  });

  it("persists enabled and disabled metronome selection through STEP completion", () => {

    const art = cloneArtifact();
    const clock = new ManualClock(0);

    const stepA = new StepPracticeSession({ plan: stepPracticePlan(art, { scope: { kind: 'FULL' }, inputSource: 'MIDI', metronomeEnabled: false }), clock });
    expect(stepA.snapshot().step.metronomeEnabled).toBe(false);
    stepA.setMetronomeEnabled(true);
    expect(stepA.snapshot().step.metronomeEnabled).toBe(true);
    stepA.end();
    const finalStepA = stepA.snapshot();
    expect(finalStepA.runtimeStatus).toBe('ENDED');
    expect(finalStepA.step.metronomeEnabled).toBe(true);

    const stepB = new StepPracticeSession({ plan: stepPracticePlan(art, { scope: { kind: 'FULL' }, inputSource: 'MIDI', metronomeEnabled: true }), clock });
    expect(stepB.snapshot().step.metronomeEnabled).toBe(true);
    stepB.setMetronomeEnabled(false);
    stepB.end();
    const finalStepB = stepB.snapshot();
    expect(finalStepB.runtimeStatus).toBe('ENDED');
    expect(finalStepB.step.metronomeEnabled).toBe(false);

  });

  it("starts on the first target after a leading rest", () => {
    // StepPracticeSession initialized without explicit scope (full piece):
    const clock = new ManualClock(0);
    const stepRuntime = new StepPracticeSession({ plan: stepPracticePlan(leadingRestArtifact, { scope: { kind: 'FULL' }, inputSource: 'MIDI' }), clock });
    expect(stepRuntime.currentOnsetTick).toBe(2.0);
    expect(stepRuntime.currentTarget()?.stepId).toBe('g-rest-1');

  });
});

it.each(['MIDI', 'MICROPHONE'] as const)('%s snapshots expose only the current learning interaction and attempt schema', inputSource => {
  const localSessionId = 'snapshot-contract', time = (ms: number) => ({ domainId: localSessionId, ms });
  const runtime = new StepPracticeSession({ plan: stepPracticePlan(artifact, { scope: { kind: 'FULL' }, inputSource: inputSource }), localSessionId, clock: new ManualClock(0) });
  const identity = runtime.openAttempt(time(100))!;
  runtime.analyzeAttempt(identity);
  runtime.completeAttempt(identity, { observedAttackKeys: [60], confidence: inputSource === 'MIDI' ? 1 : .12, captureEndSessionTime: time(150) });
  const saved = runtime.snapshot();
  expect(saved.step).toMatchObject({ attemptState: 'POST_VERDICT', currentIndex: 0,
    pendingPostVerdict: { ...identity, verdict: 'MATCH', observedAttackKeys: [60], confidence: inputSource === 'MIDI' ? 1 : .12 } });
  runtime.rearm(time(200));
  expect(runtime.snapshot().step.currentIndex).toBe(1);
  expect(saved.step.currentIndex).toBe(0); expect(Object.isFrozen(saved.step.pendingPostVerdict)).toBe(true);
});

it('STEP snapshots contain only current learning interaction state', () => {
  const runtime = new StepPracticeSession({ plan: stepPracticePlan(artifact, { scope: { kind: 'FULL' }, inputSource: 'MIDI' }), clock: new ManualClock(0) });
  expect(Object.keys(runtime.snapshot().step).sort()).toEqual([
    'currentIndex', 'targetGeneration', 'inputEligibleAfter', 'inputAvailable', 'completed',
    'attemptState', 'activeAttempt', 'pendingPostVerdict', 'canAcceptAttempt', 'metronomeEnabled',
  ].sort());
});

it('retains canonical source provenance in the STEP session snapshot', () => {
  const plan = stepPracticePlan(artifact);
  const runtime = new StepPracticeSession({ plan, clock: new ManualClock() });
  expect(runtime.snapshot().plan.source.sourceId).toBe(plan.source.sourceId);
  expect(runtime.snapshot().localSessionId).not.toBe(plan.source.sourceId);
});
