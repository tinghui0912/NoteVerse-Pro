import artifactJson from '../__fixtures__/canonical-practice-score-artifact.json';
import type { PracticeScoreArtifact } from '../score/artifact';
import { expect, it, vi } from 'vitest';
import { createStepExecutionSession, type StepExecutionRequest } from './step-execution-session';
import { stepPracticePlan } from '../__fixtures__/practice-plan';
import { borrowedDevices } from '../__fixtures__/device-roots';
import { rootHealthFixture } from '../__fixtures__/root-health';
import { stepSessionController } from '../__fixtures__/execution-session-controllers';
import { MidiFailure } from '../failure/causal-failure';

function rig() {
  let accepted = false;
  const request: StepExecutionRequest = { plan: stepPracticePlan(artifactJson as PracticeScoreArtifact),
    ports: { borrowRoots: vi.fn(() => borrowedDevices()), rootHealth: rootHealthFixture().port },
    isCommandAccepted: () => accepted, onNaturalCompletion: vi.fn() };
  let leaf!: ReturnType<typeof stepSessionController>;
  const create = vi.fn(options => { leaf = stepSessionController(options); return leaf.controller; });
  const result = createStepExecutionSession(request, create);
  if (result.status !== 'READY') throw new Error('STEP session expected');
  return { request, create, session: result.session, leaf, accept: (value: boolean) => { accepted = value; } };
}
it('owns STEP construction, immutable observation and exact completion evidence adaptation', async () => {
  const r = rig();
  expect(r.create).toHaveBeenCalledWith(expect.objectContaining({ plan: r.request.plan, rootHealth: r.request.ports.rootHealth }));
  expect(r.session.observe()).toMatchObject({ mode: 'STEP_BY_STEP', canAcceptAttempt: true, stepInteractionPhase: 'READY' });
  expect(Object.isFrozen(r.session.observe())).toBe(true);
  const changed = vi.fn(); r.session.subscribe(changed); expect(r.leaf.controller.subscribe).toHaveBeenCalledWith(changed);
  await r.session.start(); expect(r.leaf.controller.start).toHaveBeenCalledOnce();
  r.leaf.complete(); expect(r.request.onNaturalCompletion).toHaveBeenCalledOnce();
  await r.session.retire(); await r.session.dispose();
  expect(r.leaf.controller.abandon).toHaveBeenCalledOnce(); expect(r.leaf.controller.dispose).toHaveBeenCalledOnce();
});
it('STEP owns only skip/metronome and checks the root fence before delegating', () => {
  const r = rig(), commands = r.session.commands;
  if (commands.mode !== 'STEP_BY_STEP') throw new Error('STEP commands expected');
  expect(Object.keys(commands).sort()).toEqual(['mode', 'setMetronomeEnabled', 'skip']);
  commands.skip(); commands.setMetronomeEnabled(true); expect(r.leaf.controller.skip).not.toHaveBeenCalled();
  r.accept(true); commands.skip(); commands.setMetronomeEnabled(false);
  r.accept(false); commands.skip(); commands.setMetronomeEnabled(true);
  expect(r.leaf.controller.skip).toHaveBeenCalledOnce();
  expect(r.leaf.controller.setMetronomeEnabled).toHaveBeenCalledExactlyOnceWith(false);
});
it('STEP owns construction/start/cleanup consequence codes while preserving diagnostic causes', async () => {
  const r = rig(), cause = new Error('private infrastructure URL');
  const failed = createStepExecutionSession(r.request, () => { throw cause; });
  expect(failed).toEqual({ status: 'FAILED', failure: { mode: 'STEP_BY_STEP', code: 'STEP_ATTEMPT_FAILED', cause } });
  r.leaf.controller.start.mockRejectedValueOnce(cause);
  await expect(r.session.start()).rejects.toBe(cause);
  expect(r.session.failure(cause, 'START').code).toBe('STEP_ATTEMPT_FAILED');
  expect(r.session.failure(new MidiFailure('PERMISSION_DENIED'), 'START').code).toBe('STEP_MIDI_PERMISSION_DENIED');
  r.leaf.state.error = 'STEP_RESOURCE_CLEANUP_FAILED';
  await expect(r.session.retire()).rejects.toThrow('STEP_RESOURCE_CLEANUP_FAILED');
  await expect(r.session.dispose()).rejects.toThrow('STEP_RESOURCE_CLEANUP_FAILED');
  expect(r.session.failure(cause, 'RELEASE')).toEqual({ mode: 'STEP_BY_STEP', code: 'STEP_RESOURCE_CLEANUP_FAILED', cause });
});
