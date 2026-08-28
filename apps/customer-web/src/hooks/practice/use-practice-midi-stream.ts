'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type NavigatorWithMidi = Navigator & {
  requestMIDIAccess?: () => Promise<MIDIAccess>;
};

type PracticeMidiStreamOptions = {
  onInputsDisconnected?: () => void;
};

export type PracticeMidiEvent = {
  event_type: 'note_on' | 'note_off';
  note_number: number;
  velocity: number;
  timestamp_ms: number;
};

export function usePracticeMidiStream(
  onMidiEvent: (event: PracticeMidiEvent) => void,
  options: PracticeMidiStreamOptions = {}
) {
  const onMidiEventRef = useRef(onMidiEvent);
  const onInputsDisconnectedRef = useRef(options.onInputsDisconnected);
  const midiAccessRef = useRef<MIDIAccess | null>(null);
  const streamingRef = useRef(false);
  const connectedInputIdsRef = useRef(new Set<string>());
  const [hasMidiPermission, setHasMidiPermission] = useState<boolean | null>(null);
  const [connectedInputCount, setConnectedInputCount] = useState<number | null>(null);
  const [isSupported, setIsSupported] = useState(
    () =>
      typeof navigator !== 'undefined' &&
      typeof (navigator as NavigatorWithMidi).requestMIDIAccess === 'function'
  );

  useEffect(() => {
    onMidiEventRef.current = onMidiEvent;
  }, [onMidiEvent]);

  useEffect(() => {
    onInputsDisconnectedRef.current = options.onInputsDisconnected;
  }, [options.onInputsDisconnected]);

  const setStreaming = useCallback((streaming: boolean) => {
    streamingRef.current = streaming;
  }, []);

  const syncConnectedInputs = useCallback((access: MIDIAccess) => {
    const connectedInputs = [...access.inputs.values()].filter(
      (input) => input.state === 'connected'
    );
    connectedInputIdsRef.current = new Set(connectedInputs.map((input) => input.id));
    setConnectedInputCount(connectedInputs.length);
    return connectedInputs;
  }, []);

  const teardown = useCallback(() => {
    streamingRef.current = false;
    midiAccessRef.current?.inputs.forEach((input) => {
      input.onmidimessage = null;
    });
    if (midiAccessRef.current) {
      midiAccessRef.current.onstatechange = null;
    }
    midiAccessRef.current = null;
    connectedInputIdsRef.current.clear();
  }, []);

  const setup = useCallback(async () => {
    teardown();
    const requestMIDIAccess = (navigator as NavigatorWithMidi).requestMIDIAccess;
    if (typeof requestMIDIAccess !== 'function') {
      setIsSupported(false);
      throw new Error('practice_realtime_midi_unsupported');
    }

    try {
      const access = await requestMIDIAccess.call(navigator);
      midiAccessRef.current = access;
      const connectedInputs = syncConnectedInputs(access);
      if (connectedInputs.length === 0) {
        setHasMidiPermission(true);
        throw new Error('practice_realtime_midi_no_inputs');
      }
      connectedInputs.forEach((input) => {
        input.onmidimessage = (event) => {
          if (!streamingRef.current) {
            return;
          }
          if (!event.data) {
            return;
          }
          const midiEvent = parseMidiMessage(event.data);
          if (midiEvent) {
            onMidiEventRef.current(midiEvent);
          }
        };
      });
      access.onstatechange = () => {
        const nextConnectedInputs = syncConnectedInputs(access);
        nextConnectedInputs.forEach((input) => {
          if (input.onmidimessage) {
            return;
          }
          input.onmidimessage = (event) => {
            if (!streamingRef.current || !event.data) {
              return;
            }
            const midiEvent = parseMidiMessage(event.data);
            if (midiEvent) {
              onMidiEventRef.current(midiEvent);
            }
          };
        });
        if (streamingRef.current && nextConnectedInputs.length === 0) {
          streamingRef.current = false;
          onInputsDisconnectedRef.current?.();
        }
      };
      setHasMidiPermission(true);
      return access;
    } catch (error) {
      if (!(error instanceof Error && error.message === 'practice_realtime_midi_no_inputs')) {
        setHasMidiPermission(false);
      }
      throw error;
    }
  }, [syncConnectedInputs, teardown]);

  useEffect(() => teardown, [teardown]);

  return {
    connectedInputCount,
    hasConnectedInput: connectedInputCount === null ? null : connectedInputCount > 0,
    hasMidiPermission,
    isSupported,
    setStreaming,
    setup,
    teardown,
  };
}

function parseMidiMessage(data: Uint8Array): PracticeMidiEvent | null {
  if (data.length < 3) {
    return null;
  }
  const status = data[0] & 0xf0;
  const noteNumber = data[1];
  const velocity = data[2];
  if (status === 0x90 && velocity > 0) {
    return {
      event_type: 'note_on',
      note_number: noteNumber,
      velocity,
      timestamp_ms: Date.now(),
    };
  }
  if (status === 0x80 || status === 0x90) {
    return {
      event_type: 'note_off',
      note_number: noteNumber,
      velocity,
      timestamp_ms: Date.now(),
    };
  }
  return null;
}
