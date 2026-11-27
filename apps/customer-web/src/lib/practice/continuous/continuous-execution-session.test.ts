import artifactJson from '../__fixtures__/canonical-practice-score-artifact.json';
import type { PracticeScoreArtifact } from '../score/artifact';
import { expect, it, vi } from 'vitest';
import { createContinuousExecutionSession, type ContinuousExecutionRequest } from './continuous-execution-session';
import { continuousPracticePlan } from '../__fixtures__/practice-plan';
import { borrowedDevices } from '../__fixtures__/device-roots';
import { rootHealthFixture } from '../__fixtures__/root-health';
import { continuousSessionController } from '../__fixtures__/execution-session-controllers';
import { MidiFailure } from '../failure/causal-failure';

function rig() {
  let accepted = false;
  const request: ContinuousExecutionRequest = { plan: continuousPracticePlan(artifactJson as PracticeScoreArtifact),
    ports: { borrowRoots: vi.fn(() => borrowedDevices()), rootHealth: rootHealthFixture().port },
    isCommandAccepted: () => accepted, onNaturalCompletion: vi.fn() };
  let leaf!: ReturnType<typeof continuousSessionController>;
  const create = vi.fn(options => { leaf = continuousSessionController(options); return leaf.controller; });
  const result = createContinuousExecutionSession(request, create);
  if (result.status !== 'READY') throw new Error('Continuous session expected');
  return { request, create, session: result.session, leaf, accept: (value: boolean) => { accepted = value; } };
}
it('owns Continuous construction and observation, with atomic completion payload available before callback', async () => {
  const r = rig();
  expect(r.create).toHaveBeenCalledWith(expect.objectContaining({ plan: r.request.plan }));
  expect(r.session.observe()).toMatchObject({ mode: 'CONTINUOUS_PLAY', phase: 'ACTIVE', recordingIndicator: 2, completion: null });
  expect(Object.isFrozen(r.session.observe())).toBe(true);
  vi.mocked(r.request.onNaturalCompletion).mockImplementation(() => {
    expect(r.session.observe()).toMatchObject({ completion: r.leaf.completion });
  });
  await r.session.start(); r.leaf.complete(); expect(r.request.onNaturalCompletion).toHaveBeenCalledOnce();
  await r.session.retire(); await r.session.dispose();
  expect(r.leaf.controller.abandon).toHaveBeenCalledOnce(); expect(r.leaf.controller.dispose).toHaveBeenCalledOnce();
});
it('Continuous owns pause/resume/interventions/metronome and checks every command fence', async () => {
  const r = rig(), commands = r.session.commands;
  if (commands.mode !== 'CONTINUOUS_PLAY') throw new Error('Continuous commands expected');
  expect(Object.keys(commands).sort()).toEqual(['continueAfterRecovery','continueWithoutAnalysis','continueWithoutRecording','mode','pause','resume','setMetronomeEnabled'].sort());
  const invoke = async () => { commands.pause(); commands.resume(); commands.setMetronomeEnabled(true);
    await commands.continueWithoutAnalysis(); commands.continueWithoutRecording(); return commands.continueAfterRecovery(); };
  expect(await invoke()).toBe(false); r.accept(true); expect(await invoke()).toBe(true); r.accept(false); expect(await invoke()).toBe(false);
  for (const name of ['pause','resume','setMetronomeEnabled','continueWithoutAnalysis','continueWithoutRecording','continueAfterRecovery'] as const) {
    expect(r.leaf.controller[name]).toHaveBeenCalledOnce();
  }
});
it('Continuous owns construction/start/release failure projection with unchanged public codes', async () => {
  const r = rig(), cause = new Error('private infrastructure URL');
  expect(createContinuousExecutionSession(r.request, () => { throw cause; })).toEqual({ status: 'FAILED', failure: { mode: 'CONTINUOUS_PLAY', code: 'ANALYSIS_FAILED', cause } });
  r.leaf.controller.start.mockRejectedValueOnce(cause); await expect(r.session.start()).rejects.toBe(cause);
  expect(r.session.failure(cause, 'START').code).toBe('ANALYSIS_FAILED');
  expect(r.session.failure(new MidiFailure('PERMISSION_DENIED'), 'START').code).toBe('MIDI_PERMISSION_DENIED');
  r.leaf.state.inputError = 'RESOURCE_CLEANUP_FAILED';
  await expect(r.session.retire()).rejects.toThrow('RESOURCE_CLEANUP_FAILED');
  await expect(r.session.dispose()).rejects.toThrow('RESOURCE_CLEANUP_FAILED');
  expect(r.session.failure(cause, 'RELEASE')).toEqual({ mode: 'CONTINUOUS_PLAY', code: 'RESOURCE_CLEANUP_FAILED', cause });
});
