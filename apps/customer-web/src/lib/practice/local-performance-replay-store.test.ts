import { describe, expect, it } from 'vitest';

import { createPerformanceReplayTimebase } from './performance-replay';
import {
  deletePlayablePerformanceReplay,
  readPlayablePerformanceReplay,
  savePlayablePerformanceReplay,
} from './local-performance-replay-store';

describe('local-performance-replay-store', () => {
  it('keeps a just-finished local replay available by session id', () => {
    const replay = {
      kind: 'MIDI_EVENTS' as const,
      events: [
        {
          event_type: 'note_on' as const,
          note_number: 60,
          velocity: 96,
          timestamp_ms: 0,
        },
      ],
      durationMs: 0,
      timebase: createPerformanceReplayTimebase(1),
    };

    savePlayablePerformanceReplay('session-1', replay);

    expect(readPlayablePerformanceReplay('session-1')).toBe(replay);
    expect(readPlayablePerformanceReplay('missing')).toBeNull();

    deletePlayablePerformanceReplay('session-1');

    expect(readPlayablePerformanceReplay('session-1')).toBeNull();
  });
});
