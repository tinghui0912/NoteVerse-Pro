import { vi } from 'vitest';
import { MetronomeRuntime } from '../metronome/metronome-runtime';
import type { MetronomeAudioPort } from '../metronome/metronome-audio-port';

export function metronomeAudioFixture(nowMs: () => number = () => 0): MetronomeAudioPort {
  return { activate: vi.fn(), nowMs, scheduleClick: vi.fn(), dispose: vi.fn() };
}
/** Observe real runtime commands while controllers execute their own lifecycle. */
export function observeMetronomeRuntime() {
  return {
    start: vi.spyOn(MetronomeRuntime.prototype, 'start').mockClear(),
    dispose: vi.spyOn(MetronomeRuntime.prototype, 'dispose').mockClear(),
    setEnabled: vi.spyOn(MetronomeRuntime.prototype, 'setEnabled').mockClear(),
    setStepContext: vi.spyOn(MetronomeRuntime.prototype, 'setStepContext').mockClear(),
    pause: vi.spyOn(MetronomeRuntime.prototype, 'pause').mockClear(),
    resume: vi.spyOn(MetronomeRuntime.prototype, 'resume').mockClear(),
    stop: vi.spyOn(MetronomeRuntime.prototype, 'stop').mockClear(),
    syncContinuous: vi.spyOn(MetronomeRuntime.prototype, 'syncContinuous').mockClear(),
  };
}
