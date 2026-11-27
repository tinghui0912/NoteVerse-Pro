import { expect, it } from 'vitest';
import { PracticeExecutionActor } from './practice-execution-actor';
import type { ModeExecutionCommands, PracticeExecutionSessionFactory } from './execution-session';
import { createStepExecutionSession } from '../step/step-execution-session';
import { createContinuousExecutionSession } from '../continuous/continuous-execution-session';
import { stepSessionController, continuousSessionController } from '../__fixtures__/execution-session-controllers';
import { stepPracticePlan, continuousPracticePlan } from '../__fixtures__/practice-plan';
import { borrowedDevices } from '../__fixtures__/device-roots';
import { rootHealthFixture } from '../__fixtures__/root-health';
import artifactJson from '../__fixtures__/canonical-practice-score-artifact.json';
import type { PracticeScoreArtifact } from '../score/artifact';

const artifact = artifactJson as PracticeScoreArtifact;
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
async function invoke(commands: ModeExecutionCommands) {
  commands.setMetronomeEnabled(true);
  if (commands.mode === 'STEP_BY_STEP') commands.skip();
  else {
    commands.pause(); commands.resume(); commands.continueWithoutRecording();
    await commands.continueWithoutAnalysis(); commands.continueAfterRecovery();
  }
}

it.each([
  ['STEP_BY_STEP', 'END'], ['CONTINUOUS_PLAY', 'RETRY'], ['CONTINUOUS_PLAY', 'REPLACEMENT'],
] as const)('%s %s synchronously fences captured A commands throughout release and after B starts', async (mode, transition) => {
  const leaves: (ReturnType<typeof stepSessionController> | ReturnType<typeof continuousSessionController>)[] = [];
  const factory: PracticeExecutionSessionFactory = request => request.plan.mode === 'STEP_BY_STEP'
    ? createStepExecutionSession({ ...request, plan: request.plan }, options => {
      const leaf = stepSessionController(options); leaves.push(leaf); return leaf.controller;
    }) : createContinuousExecutionSession({ ...request, plan: request.plan }, options => {
      const leaf = continuousSessionController(options); leaves.push(leaf); return leaf.controller;
    });
  const actor = new PracticeExecutionActor({ borrowRoots: () => borrowedDevices(), rootHealth: rootHealthFixture().port }, factory);
  const plan = mode === 'STEP_BY_STEP' ? stepPracticePlan(artifact) : continuousPracticePlan(artifact);
  actor.setCandidate(plan, true, 'score/revision'); await actor.start();
  const commandsA = actor.modeCommands()!;
  await invoke(commandsA);
  const gate = deferred();
  let released: Promise<void>;
  if (transition === 'END') {
    leaves[0].controller.abandon.mockReturnValueOnce(gate.promise);
    released = actor.end();
  } else {
    leaves[0].controller.dispose.mockReturnValueOnce(gate.promise);
    if (transition === 'RETRY') {
      leaves[0].complete();
      expect(actor.snapshot().lifecycle).toBe('COMPLETED');
      await invoke(commandsA); // Completion itself closes command admission.
      released = actor.retry();
    } else {
      actor.setCandidate(plan, true, 'replacement/revision');
      released = actor.start();
    }
  }
  // No cleanup settlement or React render is needed to close command admission.
  expect(actor.modeCommands()).toBeNull();
  await invoke(commandsA);
  expect(leaves).toHaveLength(1);
  gate.resolve(); await released;
  if (transition === 'END') await actor.start();
  expect(leaves).toHaveLength(2);
  const commandsB = actor.modeCommands()!;
  await invoke(commandsA);
  expect(leaves[1].controller.setMetronomeEnabled).not.toHaveBeenCalled();
  expect(leaves[0].controller.setMetronomeEnabled).toHaveBeenCalledOnce();
  if ('skip' in leaves[0].controller) expect(leaves[0].controller.skip).toHaveBeenCalledOnce();
  if ('pause' in leaves[0].controller) {
    expect(leaves[0].controller.pause).toHaveBeenCalledOnce();
    expect(leaves[0].controller.resume).toHaveBeenCalledOnce();
    expect(leaves[0].controller.continueWithoutAnalysis).toHaveBeenCalledOnce();
    expect(leaves[0].controller.continueWithoutRecording).toHaveBeenCalledOnce();
    expect(leaves[0].controller.continueAfterRecovery).toHaveBeenCalledOnce();
  }
  await invoke(commandsB);
  expect(leaves[1].controller.setMetronomeEnabled).toHaveBeenCalledOnce();
  await actor.dispose(); await invoke(commandsB);
  expect(leaves[1].controller.setMetronomeEnabled).toHaveBeenCalledOnce();
});
