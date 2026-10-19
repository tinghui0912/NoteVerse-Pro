import { afterEach, expect, it, vi } from 'vitest';
import fixture from '../local-core/__fixtures__/canonical-practice-score-artifact.json';
import type { PracticeScoreArtifact } from '../local-core/artifact';
import { ManualClock } from '../local-core/timebase';
import { BrowserMidiController } from '../midi/browser-midi-controller';
import { StepPracticeController } from './step-practice-controller';
import type { StepPlatform } from './step-platform';

afterEach(() => vi.unstubAllGlobals());
it('real Browser MIDI preserves POST_VERDICT MIDIMessageEvent.timeStamp delivered after READY', async () => {
  const clock = new ManualClock(100), tasks: (() => void)[] = [];
  const input = { id: 'keyboard', state: 'connected', onmidimessage: null as ((event: { data: Uint8Array; timeStamp: number }) => void) | null };
  vi.stubGlobal('navigator', { requestMIDIAccess: async () => ({ inputs: new Map([['keyboard', input]]), onstatechange: null }) });
  const platform: StepPlatform = { clock,
    timer: { schedule: fn => { tasks.push(fn); return fn; }, cancel: () => {} },
    createMidi: options => new BrowserMidiController(options),
    createMetronome: () => ({ start() {}, destroy() {}, setEnabled() {}, setStepContext() {} }) };
  const owner = new StepPracticeController({ artifact: fixture as PracticeScoreArtifact, scope: { kind: 'FULL' }, inputSource: 'MIDI', platform });
  const note = (timeStamp: number) => input.onmidimessage!({ data: new Uint8Array([0x90, 60, 90]), timeStamp });
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
