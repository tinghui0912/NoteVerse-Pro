import { describe, expect, it } from 'vitest';

import {
  buildMidiPerformanceReplay,
  createPerformanceReplayTimebase,
} from './performance-replay';

describe('buildMidiPerformanceReplay', () => {
  it('normalizes local MIDI replay events into session order', () => {
    const timebase = createPerformanceReplayTimebase(0.75);
    const replay = buildMidiPerformanceReplay(
      [
        {
          event_type: 'note_off',
          note_number: 60,
          velocity: 0,
          timestamp_ms: 140.4,
        },
        {
          event_type: 'note_on',
          note_number: 60,
          velocity: 96,
          timestamp_ms: 12.6,
        },
      ],
      timebase
    );

    expect(replay).toEqual({
      kind: 'MIDI_EVENTS',
      durationMs: 140,
      timebase,
      events: [
        {
          event_type: 'note_on',
          note_number: 60,
          velocity: 96,
          timestamp_ms: 13,
        },
        {
          event_type: 'note_off',
          note_number: 60,
          velocity: 0,
          timestamp_ms: 140,
        },
      ],
    });
  });

  it('does not create an empty local MIDI replay', () => {
    expect(
      buildMidiPerformanceReplay([], createPerformanceReplayTimebase(1))
    ).toBeNull();
  });

  it('normalizes invalid speed ratio to a stable replay timebase', () => {
    expect(createPerformanceReplayTimebase(0)).toEqual({
      version: 1,
      speedRatio: 1,
    });
  });
});
