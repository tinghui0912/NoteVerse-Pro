// @vitest-environment jsdom

import { act, cleanup, render, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { usePracticeMidiStream } from './use-practice-midi-stream';

type MidiStreamApi = ReturnType<typeof usePracticeMidiStream>;

let latestApi: MidiStreamApi | null = null;

function MidiStreamHarness({
  onApi,
  onMidiEvent = vi.fn(),
}: {
  onApi: (api: MidiStreamApi) => void;
  onMidiEvent?: Parameters<typeof usePracticeMidiStream>[0];
}) {
  const api = usePracticeMidiStream(onMidiEvent);
  useEffect(() => {
    onApi(api);
  }, [api, onApi]);
  return null;
}

describe('usePracticeMidiStream', () => {
  afterEach(() => {
    cleanup();
    latestApi = null;
    vi.restoreAllMocks();
    Reflect.deleteProperty(navigator, 'requestMIDIAccess');
  });

  it('reports no connected MIDI inputs without treating permission as denied', async () => {
    Object.defineProperty(navigator, 'requestMIDIAccess', {
      configurable: true,
      value: async () => ({
        inputs: new Map(),
        outputs: new Map(),
        onstatechange: null,
      }),
    });

    render(<MidiStreamHarness onApi={(api) => {
      latestApi = api;
    }} />);

    let setupError: unknown = null;
    await act(async () => {
      try {
        await latestApi?.setup();
      } catch (error) {
        setupError = error;
      }
    });

    expect(setupError).toEqual(new Error('practice_realtime_midi_no_inputs'));

    await waitFor(() => {
      expect(latestApi?.hasMidiPermission).toBe(true);
      expect(latestApi?.hasConnectedInput).toBe(false);
    });
  });

  it('timestamps MIDI events on cumulative active stream time across pause and resume', async () => {
    const onMidiEvent = vi.fn();
    const input = {
      id: 'input-1',
      state: 'connected',
      onmidimessage: null,
    } as unknown as MIDIInput;
    const nowSpy = vi.spyOn(performance, 'now');
    nowSpy.mockReturnValue(1_000);
    Object.defineProperty(navigator, 'requestMIDIAccess', {
      configurable: true,
      value: async () => ({
        inputs: new Map([['input-1', input]]),
        outputs: new Map(),
        onstatechange: null,
      }),
    });

    render(
      <MidiStreamHarness
        onApi={(api) => {
          latestApi = api;
        }}
        onMidiEvent={onMidiEvent}
      />
    );

    await act(async () => {
      await latestApi?.setup();
    });

    act(() => {
      latestApi?.setStreaming(true);
    });
    nowSpy.mockReturnValue(1_250);
    input.onmidimessage?.({ data: new Uint8Array([0x90, 60, 96]) } as MIDIMessageEvent);

    act(() => {
      latestApi?.setStreaming(false);
    });
    nowSpy.mockReturnValue(2_000);
    act(() => {
      latestApi?.setStreaming(true);
    });
    nowSpy.mockReturnValue(2_100);
    input.onmidimessage?.({ data: new Uint8Array([0x80, 60, 0]) } as MIDIMessageEvent);

    expect(onMidiEvent).toHaveBeenNthCalledWith(1, {
      event_type: 'note_on',
      note_number: 60,
      velocity: 96,
      timestamp_ms: 250,
    });
    expect(onMidiEvent).toHaveBeenNthCalledWith(2, {
      event_type: 'note_off',
      note_number: 60,
      velocity: 0,
      timestamp_ms: 350,
    });
  });
});
