import { planPracticeResources } from './resource-plan';
import { beforeEach, expect, it, vi } from 'vitest';
import fixture from '../__fixtures__/canonical-practice-score-artifact.json';
import type { PracticeScoreArtifact } from '../kernel/artifact';
import { createPracticeSessionPlanner } from './session-plan';
import type { PracticeExecutionIntent } from './execution-intent';
import * as scopeContract from '../kernel/scope';
import * as tempoContract from '../kernel/tempo';
import { ManualClock } from '../kernel/timebase';
import { StepPracticeRuntime } from '../step/domain/runtime';
import { ContinuousPracticeSession } from '../continuous/domain/practice-session';
import { ContinuousMidiEvidence } from '../continuous/input/midi-evidence';
import { createNaturalContinuousCompletion } from '../continuous/natural-completion';
import { midiEvidenceProvenance } from '../result/continuous-result-provenance';
import { CONTINUOUS_MIDI_EVIDENCE_POLICY_ID } from '../continuous/input/midi-evidence-identity';

const intent: PracticeExecutionIntent = { mode: 'STEP_BY_STEP', inputSource: 'MIDI', recordingMode: 'OFF',
  scope: { kind: 'FULL' }, tempoSelection: { mode: 'SCORE' }, metronomeEnabled: false };
const source = () => ({ sourceId: 'canonical-source', artifact: structuredClone(fixture) as PracticeScoreArtifact });
beforeEach(() => vi.restoreAllMocks());
it('deterministically retains canonical source and artifact identities', () => {
  const input = source(), planPracticeSession = createPracticeSessionPlanner();
  const first = planPracticeSession(input, intent), second = planPracticeSession(input, structuredClone(intent));
  expect(first.resources).toBe(planPracticeResources(intent));
  expect(first).toEqual(second); expect(first.artifact).toBe(input.artifact);
  expect(first.sourceId).toBe(input.sourceId); expect(Object.keys(first).sort()).toEqual([
    'resources', 'sourceId', 'artifact', 'mode', 'inputSource', 'recordingMode', 'scope', 'tempoPlan', 'metronomeInitiallyEnabled',
  ].sort());
});
it('resolves FULL and RANGE and SCORE and CUSTOM_FIXED_BPM', () => {
  const input = source(), planPracticeSession = createPracticeSessionPlanner();
  const full = planPracticeSession(input, intent);
  const range = planPracticeSession(input, { ...intent, scope: { kind: 'RANGE', startGroupId: input.artifact.moments[1].groupId,
    endGroupId: input.artifact.moments[2].groupId }, tempoSelection: { mode: 'CUSTOM_FIXED_BPM', bpm: 100 } });
  expect(full.scope).toMatchObject({ startIndex: 0, endIndex: 4, terminalBeat: input.artifact.scoreEndBeat });
  expect(range.scope).toMatchObject({ startIndex: 1, endIndex: 2, startBeat: input.artifact.moments[1].onsetBeat,
    terminalBeat: input.artifact.moments[2].canonicalEndBeat });
  expect(full.tempoPlan.segments).toHaveLength(2);
  expect(range.tempoPlan.segments).toEqual([{ startBeat: 0, bpm: 100, source: 'CUSTOM' }]);
});
it.each(['', null, 123])('rejects invalid source id %s', sourceId => {
  expect(() => createPracticeSessionPlanner()({ ...source(), sourceId } as never, intent)).toThrow();
});
it('rejects invalid scope, tempo, mode and recording choices without repair', () => {
  for (const fields of [{ scope: { kind: 'RANGE', startGroupId: 'missing', endGroupId: 'missing' } },
    { scope: { kind: 'OTHER' } }, { tempoSelection: { mode: 'OTHER' } },
    { tempoSelection: { mode: 'CUSTOM_FIXED_BPM', bpm: 300 } }, { recordingMode: 'AUDIO' }, { mode: 'OTHER' }]) {
    expect(() => createPracticeSessionPlanner()(source(), { ...intent, ...fields } as never)).toThrow();
  }
});
it('freezes plan-owned structures including selection and canonical notation', () => {
  const plan = createPracticeSessionPlanner()(source(), intent);
  expect(Object.isFrozen(plan)).toBe(true); expect(Object.isFrozen(plan.scope)).toBe(true);
  expect(Object.isFrozen(plan.tempoPlan)).toBe(true); expect(Object.isFrozen(plan.tempoPlan.selection)).toBe(true);
  expect(() => Object.assign(plan.scope, { startIndex: 3 })).toThrow();
  expect(() => Object.assign(plan.tempoPlan.segments[0], { bpm: 70 })).toThrow();
  expect(() => plan.artifact.moments[0].attacks.push(plan.artifact.moments[1].attacks[0])).toThrow();
});
it('initial metronome choices reuse exactly one scope/tempo resolution', () => {
  const resolveScope = vi.spyOn(scopeContract, 'resolvePracticeScope');
  const resolveTempo = vi.spyOn(tempoContract, 'resolvePracticeTempoPlan');
  const planPracticeSession = createPracticeSessionPlanner(), input = source();
  const off = planPracticeSession(input, intent), on = planPracticeSession(input, { ...intent, metronomeEnabled: true });
  expect(on.resources).toBe(off.resources); expect(on.scope).toBe(off.scope); expect(on.tempoPlan).toBe(off.tempoPlan);
  expect(on.metronomeInitiallyEnabled).toBe(true); expect(off.metronomeInitiallyEnabled).toBe(false);
  expect(resolveScope).toHaveBeenCalledOnce(); expect(resolveTempo).toHaveBeenCalledOnce();
});
it('STEP executes the exact planned scope and tempo through completion', () => {
  const input = source();
  const plan = createPracticeSessionPlanner()(input, { ...intent, scope: { kind: 'RANGE',
    startGroupId: input.artifact.moments[1].groupId, endGroupId: input.artifact.moments[1].groupId } });
  const runtime = new StepPracticeRuntime({ ...plan, clock: new ManualClock() });
  expect(runtime.currentStepIndex).toBe(plan.scope.startIndex);
  expect(runtime.snapshot().scope).toBe(plan.scope); expect(runtime.snapshot().tempoPlan).toBe(plan.tempoPlan);
  expect(runtime.snapshot().sourceId).toBe(plan.sourceId);
  runtime.skip(); expect(runtime.snapshot().completionReason).toBe('SCOPE_COMPLETED');
});
it('Continuous clock, evaluator, snapshot and natural Result consume executed resolved truth', () => {
  const resolveScope = vi.spyOn(scopeContract, 'resolvePracticeScope'), resolveTempo = vi.spyOn(tempoContract, 'resolvePracticeTempoPlan');
  const input = source(), plan = createPracticeSessionPlanner()(input, { ...intent, mode: 'CONTINUOUS_PLAY',
    scope: { kind: 'RANGE', startGroupId: input.artifact.moments[1].groupId, endGroupId: input.artifact.moments[2].groupId },
    tempoSelection: { mode: 'CUSTOM_FIXED_BPM', bpm: 100 } });
  const clock = new ManualClock();
  const session = new ContinuousPracticeSession({ ...plan, inputSource: 'MIDI', clock, countInBeats: 0,
    createClockEvidence: id => new ContinuousMidiEvidence(id) });
  expect(session.start()).toMatchObject({ scopeStartBeat: plan.scope.startBeat, scopeTerminalBeat: plan.scope.terminalBeat });
  expect(Reflect.get(session.clock, 'timeline').plan).toBe(plan.tempoPlan);
  expect(session.snapshotSession().scope).toBe(plan.scope); expect(session.snapshotSession().tempoPlan).toBe(plan.tempoPlan);
  expect(session.snapshotSession().sourceId).toBe(plan.sourceId);
  clock.advance(session.clock.scopeDurationMs() + 1000); session.advanceToNow();
  const completion = createNaturalContinuousCompletion({ session: session.snapshotSession(), artifact: plan.artifact,
    evaluation: session.completedEvaluation(), evidenceProvenance: midiEvidenceProvenance(CONTINUOUS_MIDI_EVIDENCE_POLICY_ID),
    recording: { status: 'NOT_RECORDED' }, completedAt: '2026-10-30T00:00:00.000Z' });
  expect(completion.result.scope).toEqual(plan.scope); expect(completion.result.tempoPlan).toEqual(plan.tempoPlan);
  expect(completion.result.schemaVersion).toBe(7); expect(completion.result).not.toHaveProperty('sourceId');
  expect(completion.result.evaluation.status).toBe('COMPLETE');
  if (completion.result.evaluation.status === 'COMPLETE') {
    expect(completion.result.evaluation.assignment.groups.map(group => group.groupId)).toEqual(
      plan.artifact.moments.slice(plan.scope.startIndex, plan.scope.endIndex + 1).map(group => group.groupId));
  }
  expect(resolveScope).toHaveBeenCalledOnce(); expect(resolveTempo).toHaveBeenCalledOnce();
});
it('Continuous execution requires resolved tempo', () => {
  const plan = createPracticeSessionPlanner()(source(), { ...intent, mode: 'CONTINUOUS_PLAY' });
  expect(() => new ContinuousPracticeSession({ ...plan, tempoPlan: undefined, inputSource: 'MIDI', clock: new ManualClock(),
    createClockEvidence: (id: string) => new ContinuousMidiEvidence(id) } as never)).toThrow();
});
