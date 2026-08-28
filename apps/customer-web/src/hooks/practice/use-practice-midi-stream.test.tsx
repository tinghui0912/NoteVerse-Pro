// @vitest-environment jsdom

import { act, cleanup, render, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { usePracticeMidiStream } from './use-practice-midi-stream';

type MidiStreamApi = ReturnType<typeof usePracticeMidiStream>;

let latestApi: MidiStreamApi | null = null;

function MidiStreamHarness({ onApi }: { onApi: (api: MidiStreamApi) => void }) {
  const api = usePracticeMidiStream(vi.fn());
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
});
