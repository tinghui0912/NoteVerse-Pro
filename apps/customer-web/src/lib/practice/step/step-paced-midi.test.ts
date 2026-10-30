import { stepSessionPlan } from '@/lib/practice/__fixtures__/session-plan';
import { midiDeviceFixture } from '@/lib/practice/__fixtures__/device-roots';
import { afterEach, expect, it, vi } from 'vitest';
import fixture from '@/lib/practice/__fixtures__/canonical-practice-score-artifact.json';
import type { PracticeScoreArtifact } from '@/lib/practice/kernel/artifact';
import { ManualClock } from '@/lib/practice/kernel/timebase';
import { BrowserMidiController } from '../midi/browser-midi-controller';
import { StepPracticeController } from './step-practice-controller';
import type { StepPlatform } from './step-platform';

afterEach(() => vi.unstubAllGlobals());
it('real Browser MIDI preserves POST_VERDICT MIDIMessageEvent.timeStamp delivered after READY', async () => {
  const clock = new ManualClock(100), tasks: (() => void)[] = [];
  const device = midiDeviceFixture();
  const platform: StepPlatform = { clock,
    timer: { schedule: fn => { tasks.push(fn); return fn; }, cancel: () => {} },
    createMidi: options => new BrowserMidiController(options),
    createMetronome: () => ({ start() {}, destroy() {}, setEnabled() {}, setStepContext() {} }) };
  const owner = new StepPracticeController({ plan: stepSessionPlan(fixture as PracticeScoreArtifact, { scope: { kind: 'FULL' }, inputSource: 'MIDI' }), devices: { inputMicrophone: null, recordingMicrophone: null, camera: null, midi: device.access }, platform });
  const note = (timeStamp: number) => device.send([0x90, 60, 90], timeStamp);
  try {
    await owner.start(); clock.set(200); note(200);
    let staleTimestamp = 0;
    owner.subscribe(() => {
      if (owner.snapshot().stepInteractionPhase === 'POST_VERDICT') { clock.set(800); staleTimestamp = 600; }
    });
    clock.set(235); tasks[0]();
    expect(owner.snapshot()).toMatchObject({ canAcceptAttempt: true, stepInteractionPhase: 'READY' });
    expect(owner.snapshot().sessionSnapshot!.step.inputEligibleAfter.ms).toBe(800);
    note(staleTimestamp); note(800);
    expect(tasks).toHaveLength(1); expect(owner.snapshot().sessionSnapshot!.step.activeAttempt).toBeNull();
    clock.set(801); note(801);
    expect(tasks).toHaveLength(2);
    expect(owner.snapshot().sessionSnapshot!.step.activeAttempt!.attemptStartSessionTime.ms).toBe(801);
  } finally { owner.dispose(); }
});
