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
      refreshInputs: vi.fn(),
    };
    const platform = {
      createMidi: (value: BrowserMidiControllerOptions) => { options = value; return port; },
    } satisfies Pick<ContinuousPlatform, 'createMidi'>;
    const observe = vi.fn();
    const timebase = new PracticeTimebase({ domainId: 'physical-midi' });
    new ContinuousMidiInput(platform, { access: midiDeviceFixture().access, timebase, observe });
    const sessionTime = timebase.atSessionMs(112);
    options.onAttack!({ sessionTime, noteNumber: 64, confidence: 1 });
    expect(options.timebase).toBe(timebase);

    expect(observe).toHaveBeenCalledExactlyOnceWith({ captureTime: sessionTime, pianoKey: 64, confidence: 1 });
    for (const noteNumber of [20, 21, 108, 109]) expect(() => options.onAttack!({ sessionTime, noteNumber, confidence: 1 })).not.toThrow();
    expect(observe.mock.calls.map(([fact]) => fact.pianoKey)).toEqual([64, 21, 108]);
  });

  it('binds, refreshes and releases message routing', async () => {
    const port = { start: vi.fn(async () => { }), dispose: vi.fn(), refreshInputs: vi.fn() };
    const platform = { createMidi: () => port } satisfies Pick<ContinuousPlatform, 'createMidi'>;
    const input = new ContinuousMidiInput(platform, {
      access: midiDeviceFixture().access,
      timebase: new PracticeTimebase({ domainId: 'midi-resource' }), observe: vi.fn(),
    });
    await input.prepare();
    expect(port.start).toHaveBeenCalledOnce();
    input.refreshInputs();
    expect(port.refreshInputs).toHaveBeenCalledOnce();
    input.dispose();
    expect(port.dispose).toHaveBeenCalledOnce();
  });
});
