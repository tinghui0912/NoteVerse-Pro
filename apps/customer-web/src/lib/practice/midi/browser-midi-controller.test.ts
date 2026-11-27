import { midiDeviceFixture } from '../__fixtures__/device-roots';
import { PracticeTimebase } from '@/lib/practice/session/timebase';
import { describe, expect, it, vi } from 'vitest';
import {
  BrowserMidiController,
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

  it('parses note_on and note_off messages correctly', () => {
    // Note on: channel 0, pitch 60, velocity 100
    expect(parseMidiMessage(new Uint8Array([0x90, 60, 100]))).toEqual({
      type: 'NOTE_ON',
      noteNumber: 60,

      velocity: 100,
    });

    // Note on with velocity 0 is treated as note_off
    expect(parseMidiMessage(new Uint8Array([0x90, 60, 0]))).toEqual({
      type: 'NOTE_OFF',
      noteNumber: 60,

      velocity: 0,
    });

    // Explicit note off: channel 0, pitch 60, velocity 64
    expect(parseMidiMessage(new Uint8Array([0x80, 60, 64]))).toEqual({
      type: 'NOTE_OFF',
      noteNumber: 60,

      velocity: 0,
    });
  });

  it('starts an empty routing set without classifying physical health', async () => {
    const device = midiDeviceFixture(false);
    const controller = new BrowserMidiController({ access: device.access, timebase: new PracticeTimebase({ domainId: 'empty' }) });
    await controller.start(); controller.refreshInputs();
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
  it('refreshes message routing on command while the access owner observes connection events', async () => {
    const device = midiDeviceFixture(), health = vi.fn(), attack = vi.fn();
    device.access.addEventListener('statechange', health);
    const listen = vi.spyOn(device.access, 'addEventListener');
    const controller = new BrowserMidiController({ access: device.access, timebase: new PracticeTimebase({ domainId: 'binding' }), onAttack: attack });
    await controller.start(); expect(listen).not.toHaveBeenCalled();
    device.connect(false); controller.refreshInputs(); device.send([0x90, 60, 80], 1); expect(attack).not.toHaveBeenCalled();
    device.connect(true); controller.refreshInputs(); device.send([0x90, 60, 80], 2); expect(attack).toHaveBeenCalledOnce();
    controller.dispose(); device.connect(false); controller.refreshInputs();
    device.send([0x90, 60, 80], 3); expect(attack).toHaveBeenCalledOnce(); expect(health).toHaveBeenCalledTimes(3);
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
      ? { type, noteNumber, velocity: type === 'NOTE_ON' ? velocity : 0 } : null);
  }
});
