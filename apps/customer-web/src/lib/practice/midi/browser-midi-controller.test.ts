import { PracticeTimebase } from '@/lib/practice/kernel/timebase';
import { describe, expect, it, vi } from 'vitest';
import {
  BrowserMidiController,
  MidiNoConnectedInputError,
  midiNoteToPitch,
  parseMidiMessage,
} from './browser-midi-controller';

describe('browser MIDI controller', () => {
  it('converts MIDI note numbers to scientific pitch notation', () => {
    expect(midiNoteToPitch(60)).toBe('C4');
    expect(midiNoteToPitch(69)).toBe('A4');
    expect(midiNoteToPitch(21)).toBe('A0');
    expect(midiNoteToPitch(108)).toBe('C8');
  });

  it('parses note_on and note_off messages correctly', () => {
    // Note on: channel 0, pitch 60, velocity 100
    expect(parseMidiMessage(new Uint8Array([0x90, 60, 100]))).toEqual({
      type: 'NOTE_ON',
      noteNumber: 60,
      pitch: 'C4',
      velocity: 100,
    });

    // Note on with velocity 0 is treated as note_off
    expect(parseMidiMessage(new Uint8Array([0x90, 60, 0]))).toEqual({
      type: 'NOTE_OFF',
      noteNumber: 60,
      pitch: 'C4',
      velocity: 0,
    });

    // Explicit note off: channel 0, pitch 60, velocity 64
    expect(parseMidiMessage(new Uint8Array([0x80, 60, 64]))).toEqual({
      type: 'NOTE_OFF',
      noteNumber: 60,
      pitch: 'C4',
      velocity: 0,
    });
  });

  it('throws MidiNoConnectedInputError when 0 connected MIDI devices are detected', async () => {
    const timebase = new PracticeTimebase({ domainId: 'midi-session' });
    const controller = new BrowserMidiController({ timebase });

    const mockAccess = {
      inputs: new Map(),
      onstatechange: null,
    };

    const originalNavigator = globalThis.navigator;
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        requestMIDIAccess: async () => mockAccess,
      },
      configurable: true,
    });

    try {
      await expect(controller.start()).rejects.toThrow(MidiNoConnectedInputError);
      expect(controller.getState().isRunning).toBe(false);
      expect(controller.getState().connectedInputCount).toBe(0);
      expect(controller.getState().hasPermission).toBe(true);
    } finally {
      Object.defineProperty(globalThis, 'navigator', {
        value: originalNavigator,
        configurable: true,
      });
    }
  });

  it('starts successfully when at least 1 connected MIDI device is detected', async () => {
    const timebase = new PracticeTimebase({ domainId: 'midi-session' });
    const controller = new BrowserMidiController({ timebase });

    const fakeInput = {
      id: 'input-1',
      name: 'MIDI Keyboard',
      state: 'connected',
      onmidimessage: null,
    };

    const mockAccess = {
      inputs: new Map([['input-1', fakeInput]]),
      onstatechange: null,
    };

    const originalNavigator = globalThis.navigator;
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        requestMIDIAccess: async () => mockAccess,
      },
      configurable: true,
    });

    try {
      await controller.start();
      expect(controller.getState().isRunning).toBe(true);
      expect(controller.getState().connectedInputCount).toBe(1);
      expect(controller.getState().hasPermission).toBe(true);
    } finally {
      controller.stop();
      Object.defineProperty(globalThis, 'navigator', {
        value: originalNavigator,
        configurable: true,
      });
    }
  });
  it('publishes generic NOTE_ON/OFF and immediate capture facts, without a target or gesture timer', async () => {
    const note = vi.fn(), attack = vi.fn(), input = { state: 'connected', onmidimessage: null };
    vi.stubGlobal('navigator', { requestMIDIAccess: async () => ({ inputs: new Map([['a',input]]),onstatechange:null }) });
    const controller = new BrowserMidiController({ timebase: new PracticeTimebase({domainId:'facts'}),onMidiNote:note,onAttack:attack });
    try {
      await controller.start(); controller.dispatchMidiData(new Uint8Array([0x90,60,80]),100);
      controller.dispatchMidiData(new Uint8Array([0x80,60,0]),110);
      expect(note.mock.calls.map(c => c[0].type)).toEqual(['NOTE_ON','NOTE_OFF']);
      expect(note.mock.calls[0][0].sessionTime).toEqual({domainId:'facts',ms:100});
      expect(attack).toHaveBeenCalledTimes(1); controller.stop();
      controller.dispatchMidiData(new Uint8Array([0x90,60,80]),120); expect(attack).toHaveBeenCalledTimes(1);
    } finally { controller.dispose(); vi.unstubAllGlobals(); }
  });
  it('disposal during MIDI permission wait cannot leave a late active driver', async () => {
    let resolve!: (value: unknown) => void;
    vi.stubGlobal('navigator', { requestMIDIAccess: () => new Promise(r => { resolve = r; }) });
    const controller = new BrowserMidiController({timebase:new PracticeTimebase({domainId:'cancel'})});
    try {
      const start = controller.start(); controller.dispose(); resolve({inputs:new Map(),onstatechange:null});
      await expect(start).rejects.toThrow('MIDI_START_CANCELLED'); expect(controller.getState().isRunning).toBe(false);
    } finally { vi.unstubAllGlobals(); }
  });
  it('native event time survives delayed callbacks and velocity zero remains NOTE_OFF', async () => {
    const note = vi.fn(), attack = vi.fn();
    const input: { state: string; onmidimessage: ((event: Pick<MIDIMessageEvent, 'data' | 'timeStamp'>) => void) | null }
      = { state: 'connected', onmidimessage: null };
    vi.stubGlobal('navigator', { requestMIDIAccess: async () => ({ inputs: new Map([['a', input]]), onstatechange: null }) });
    const now = vi.spyOn(performance, 'now').mockReturnValue(140);
    const controller = new BrowserMidiController({ timebase: new PracticeTimebase({ domainId: 'native' }),
      onMidiNote: note, onAttack: attack });
    try {
      await controller.start();
      input.onmidimessage!({ data: new Uint8Array([0x90, 60, 80]), timeStamp: 100 });
      input.onmidimessage!({ data: new Uint8Array([0x90, 64, 80]), timeStamp: 112 });
      input.onmidimessage!({ data: new Uint8Array([0x90, 60, 0]), timeStamp: 120 });
      expect(attack.mock.calls.map(c => c[0].sessionTime.ms)).toEqual([100, 112]);
      expect(note.mock.calls.map(c => [c[0].type, c[0].sessionTime.ms])).toEqual([['NOTE_ON', 100], ['NOTE_ON', 112], ['NOTE_OFF', 120]]);
    } finally { controller.dispose(); now.mockRestore(); vi.unstubAllGlobals(); }
  });
  it('MIDIAccess stays subscribed across disconnect/reconnect without restarting the owner', async () => {
    const input={state:'connected',onmidimessage:null};
    const access:{inputs:Map<string,typeof input>;onstatechange:(()=>void)|null}={inputs:new Map([['one',input]]),onstatechange:null};
    const request=vi.fn(async()=>access),states=vi.fn();
    vi.stubGlobal('navigator',{requestMIDIAccess:request});
    const controller=new BrowserMidiController({timebase:new PracticeTimebase({domainId:'reconnect'}),onStateChange:states});
    try {
      await controller.start(); const listener=access.onstatechange;
      input.state='disconnected'; access.onstatechange!();
      expect(controller.getState().connectedInputCount).toBe(0); expect(input.onmidimessage).toBeNull();
      expect(access.onstatechange).toBe(listener);
      input.state='connected'; access.onstatechange!();
      expect(controller.getState().connectedInputCount).toBe(1); expect(input.onmidimessage).toBeTypeOf('function');
      expect(request).toHaveBeenCalledOnce(); expect(controller.getState().isRunning).toBe(true);
      controller.dispose(); expect(access.onstatechange).toBeNull(); expect(input.onmidimessage).toBeNull();
    } finally {controller.dispose();vi.unstubAllGlobals();}
  });
});
