import { midiDeviceFixture } from '../__fixtures__/device-roots';
import { PracticeTimebase } from '@/lib/practice/kernel/timebase';
import type { BrowserMidiControllerOptions } from '@/lib/practice/midi/browser-midi-controller';
import { describe, expect, it, vi } from 'vitest';
import type { ContinuousPlatform } from './continuous-input';
import { ContinuousMidiInput } from './continuous-midi-input';

describe('Continuous physical MIDI input projection', () => {
  it('projects infrastructure facts into capture-time commands without a source discriminator', () => {
    let options!: BrowserMidiControllerOptions;
    const port = {
      start: vi.fn(async () => { }), dispose: vi.fn(),
      getState: () => ({ connectedInputCount: 1, isRunning: true, isSupported: true, hasPermission: true }),
    };
    const platform = {
      createMidi: (value: BrowserMidiControllerOptions) => { options = value; return port; },
    } satisfies Pick<ContinuousPlatform, 'createMidi'>;
    const observe = vi.fn();
    const onState = vi.fn();
    const timebase = new PracticeTimebase({ domainId: 'physical-midi' });
    new ContinuousMidiInput(platform, { access: midiDeviceFixture().access, timebase, observe, onState });
    const sessionTime = timebase.atSessionMs(112);
    options.onAttack!({ sessionTime, pitch: 'E4', confidence: 1 });
    expect(options.timebase).toBe(timebase);
    expect(options.onStateChange).toBe(onState);
    expect(observe).toHaveBeenCalledExactlyOnceWith({ captureTime: sessionTime, pitch: 'E4', confidence: 1 });
  });

  it('retains preparation, disconnect rejection and resource release ownership', async () => {
    const state = { connectedInputCount: 1, isRunning: true, isSupported: true, hasPermission: true };
    const port = { start: vi.fn(async () => { }), dispose: vi.fn(), getState: () => state };
    const platform = { createMidi: () => port } satisfies Pick<ContinuousPlatform, 'createMidi'>;
    const input = new ContinuousMidiInput(platform, {
      access: midiDeviceFixture().access,
      timebase: new PracticeTimebase({ domainId: 'midi-resource' }), observe: vi.fn(), onState: vi.fn(),
    });
    await input.prepare();
    expect(port.start).toHaveBeenCalledOnce();
    input.assertConnected();
    state.connectedInputCount = 0;
    expect(() => input.assertConnected()).toThrow('NO_CONNECTED_INPUT');
    input.dispose();
    expect(port.dispose).toHaveBeenCalledOnce();
  });
});
