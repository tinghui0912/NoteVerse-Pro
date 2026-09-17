export type PerformanceReplayMidiEvent = {
  event_type: 'note_on' | 'note_off';
  note_number: number;
  velocity: number;
  timestamp_ms: number;
};

export type PerformanceReplayTimebase = {
  version: 1;
  speedRatio: number;
};

export type PlayablePerformanceReplay =
  | {
      kind: 'AUDIO_RECORDING';
      blob: Blob;
      contentType: string;
      byteSize: number;
      durationMs: number;
      timebase: PerformanceReplayTimebase;
    }
  | {
      kind: 'MIDI_EVENTS';
      events: PerformanceReplayMidiEvent[];
      durationMs: number;
      timebase: PerformanceReplayTimebase;
    };

export function createPerformanceReplayTimebase(
  speedRatio: number
): PerformanceReplayTimebase {
  return {
    version: 1,
    speedRatio: Number.isFinite(speedRatio) && speedRatio > 0 ? speedRatio : 1,
  };
}

export function buildMidiPerformanceReplay(
  events: PerformanceReplayMidiEvent[],
  timebase: PerformanceReplayTimebase
): PlayablePerformanceReplay | null {
  if (events.length === 0) {
    return null;
  }
  const normalizedEvents = events
    .map((event) => ({
      event_type: event.event_type,
      note_number: event.note_number,
      velocity: event.velocity,
      timestamp_ms: Math.max(0, Math.round(event.timestamp_ms)),
    }))
    .sort((left, right) => left.timestamp_ms - right.timestamp_ms);
  const durationMs = Math.max(...normalizedEvents.map((event) => event.timestamp_ms));
  return {
    kind: 'MIDI_EVENTS',
    events: normalizedEvents,
    durationMs,
    timebase,
  };
}
