import { expect, it, vi } from 'vitest';
import { metronomeAudioFixture } from '../__fixtures__/metronome';
import { rootHealthFixture } from '../__fixtures__/root-health';
import { borrowedDevices } from '../__fixtures__/device-roots';
import { stepPracticePlan } from '../__fixtures__/practice-plan';
import artifactJson from '../__fixtures__/canonical-practice-score-artifact.json';
import type { PracticeScoreArtifact } from '../score/artifact';
import * as stepPlatform from '../step/step-platform';
import * as continuousPlatform from '../continuous/continuous-platform';
import { ManualClock } from '../session/timebase';
import { PracticeExecutionActor } from './practice-execution-actor';
import { browserExecutionSessionFactory } from './browser-execution-session-factory';
const artifact = artifactJson as PracticeScoreArtifact;
it("real STEP explicitly starts without count-in, waits for input, and next Start has a new localSessionId", async () => {
  const clock = new ManualClock(100),
    health = rootHealthFixture();
  const createMidi = vi.fn(() => ({
    start: vi.fn(async () => {}),
    refreshInputs: vi.fn(),
    dispose: vi.fn(),
  }));
  const platform = vi
    .spyOn(stepPlatform, "browserStepPlatform")
    .mockReturnValue({
      clock,
      timer: { schedule: vi.fn(), cancel: vi.fn() },
      createMidi,
      createMetronomeAudio: () => metronomeAudioFixture(),
    });
  const continuous = vi.spyOn(continuousPlatform, "browserContinuousPlatform");
  const actor = new PracticeExecutionActor({
    borrowRoots: () => borrowedDevices(),
    rootHealth: health.port,
  }, browserExecutionSessionFactory);
  actor.setCandidate(stepPracticePlan(artifact), true, "score/revision");
  expect(platform).not.toHaveBeenCalled();
  expect(continuous).not.toHaveBeenCalled();
  await actor.start();
  const first = actor.snapshot();
  expect(first).toMatchObject({
    mode: "STEP_BY_STEP",
    lifecycle: "ACTIVE",
    stepInteractionPhase: "READY",
    performanceClock: null,
  });
  clock.advance(100000);
  expect(actor.snapshot()).toBe(first);
  expect(health.listenerCount()).toBe(1);
  const firstId = Reflect.get(vi.mocked(platform).mock.results[0], "value");
  expect(firstId).toBeDefined();
  const controllerIds: string[] = [];
  // The actual MIDI binding's timebase carries the local session identity.
  controllerIds.push(
    createMidi.mock.calls.length
      ? (
          vi.mocked(createMidi).mock.calls[0] as unknown as [
            { timebase: { domainId: string } },
          ]
        )[0].timebase.domainId
      : "",
  );
  await actor.end();
  expect(actor.snapshot().lifecycle).toBe("READY");
  await actor.start();
  controllerIds.push(
    (
      vi.mocked(createMidi).mock.calls[1] as unknown as [
        { timebase: { domainId: string } },
      ]
    )[0].timebase.domainId,
  );
  expect(controllerIds[1]).not.toBe(controllerIds[0]);
  expect(continuous).not.toHaveBeenCalled();
  await actor.dispose();
});
