import { midiDeviceFixture } from '../__fixtures__/device-roots';
import { PracticeTimebase } from '@/lib/practice/kernel/timebase';
import { describe, expect, it, vi } from 'vitest';
import {
  BrowserMidiController,
  MidiNoConnectedInputError,
  midiNoteToPitch,
  isMidiNoteNumber,
  parseMidiMessage,
} from './browser-midi-controller';

describe('browser MIDI controller', () => {
  it('delayed callback delivery never replaces the native MIDI event timestamp', async () => {
    const device = midiDeviceFixture(), attack = vi.fn(), arrival = vi.spyOn(performance, 'now');
    const controller = new BrowserMidiController({ access: device.access,
      timebase: new PracticeTimebase({ domainId: 'native-event', runtimeOriginMs: 1000 }), onAttack: attack });
    try {
      await controller.start();
      arrival.mockReturnValue(2000); device.send([0x90, 60, 80], 1500);
      arrival.mockReturnValue(9000); device.send([0x90, 60, 80], 1500);
      expect(attack.mock.calls.map(call => call[0].sessionTime)).toEqual([
        { domainId: 'native-event', ms: 500 }, { domainId: 'native-event', ms: 500 }]);
    } finally { controller.dispose(); arrival.mockRestore(); }
  });
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

  it('rejects a borrowed access without connected devices', async () => {
    const device = midiDeviceFixture(false);
    const controller = new BrowserMidiController({ access: device.access, timebase: new PracticeTimebase({ domainId: 'empty' }) });
    await expect(controller.start()).rejects.toThrow(MidiNoConnectedInputError);
    expect(controller.getState()).toMatchObject({ isRunning: false, connectedInputCount: 0, hasPermission: true });
    controller.dispose();
  });
  it('binds borrowed MIDI without acquiring it and publishes physical NOTE_ON/OFF facts', async () => {
    const device = midiDeviceFixture(), note = vi.fn(), attack = vi.fn(), acquire = vi.fn();
    vi.stubGlobal('navigator', { requestMIDIAccess: acquire });
    const controller = new BrowserMidiController({ access: device.access,
      timebase: new PracticeTimebase({ domainId: 'facts' }), onMidiNote: note, onAttack: attack });
    try {
      await controller.start();
      device.send([0x90, 60, 80], 100); device.send([0x90, 64, 80], 112); device.send([0x90, 60, 0], 120);
      expect(attack.mock.calls.map(c => c[0].sessionTime)).toEqual([{ domainId: 'facts', ms: 100 }, { domainId: 'facts', ms: 112 }]);
      expect(note.mock.calls.map(c => [c[0].type, c[0].sessionTime.ms])).toEqual([['NOTE_ON', 100], ['NOTE_ON', 112], ['NOTE_OFF', 120]]);
      expect(acquire).not.toHaveBeenCalled(); controller.dispose();
      device.send([0x90, 60, 80], 130); expect(attack).toHaveBeenCalledTimes(2);
    } finally { controller.dispose(); vi.unstubAllGlobals(); }
  });
  it('disconnect/reconnect preserves Device Lease listeners and never overwrites DOM slots', async () => {
    const device = midiDeviceFixture(), health = vi.fn(), slot = vi.fn(), states = vi.fn();
    device.access.addEventListener('statechange', health); device.access.onstatechange = slot;
    const controller = new BrowserMidiController({ access: device.access, timebase: new PracticeTimebase({ domainId: 'binding' }), onStateChange: states });
    await controller.start(); device.connect(false); expect(controller.getState().connectedInputCount).toBe(0);
    device.connect(true); expect(controller.getState().connectedInputCount).toBe(1);
    expect(device.access.onstatechange).toBe(slot); controller.dispose();
    device.connect(false); expect(health).toHaveBeenCalledTimes(3); expect(states).toHaveBeenCalledTimes(4);
  });
});

it.each([
  { status: 0x90, velocity: 80, type: 'NOTE_ON' },
  { status: 0x9f, velocity: 80, type: 'NOTE_ON' },
  { status: 0x90, velocity: 0, type: 'NOTE_OFF' },
  { status: 0x80, velocity: 64, type: 'NOTE_OFF' },
  { status: 0x8f, velocity: 64, type: 'NOTE_OFF' },
])('retains Uint8Array note-byte acceptance for status $status / velocity $velocity', ({ status, velocity, type }) => {
  for (let noteNumber = 0; noteNumber < 256; noteNumber++) {
    const withinWireRange = noteNumber <= 127;
    expect(isMidiNoteNumber(noteNumber)).toBe(withinWireRange);
    expect(parseMidiMessage(new Uint8Array([status, noteNumber, velocity]))).toEqual(withinWireRange
      ? { type, noteNumber, pitch: midiNoteToPitch(noteNumber), velocity: type === 'NOTE_ON' ? velocity : 0 } : null);
  }
});
