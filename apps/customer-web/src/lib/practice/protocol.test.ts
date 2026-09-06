import { describe, expect, it } from 'vitest';
import { parsePracticeServerMessage } from './protocol';


describe('Practice WebSocket protocol', () => {
  it('accepts a versioned server message', () => {
    expect(
      parsePracticeServerMessage({
        protocol_version: 1,
        type: 'session.ready',
        payload: { session_id: 'session-1', state: 'STREAMING' },
      })
    ).toMatchObject({ type: 'session.ready' });
  });

  it('rejects an unversioned or structurally invalid server message', () => {
    expect(() =>
      parsePracticeServerMessage({
        type: 'session.ready',
        payload: { session_id: 'session-1', state: 'STREAMING' },
      })
    ).toThrow();
  });

  it('accepts fixed-clock performance sync messages', () => {
    expect(
      parsePracticeServerMessage({
        protocol_version: 1,
        type: 'performance.clock_sync',
        payload: {
          state: 'RUNNING',
          musical_beat: 6.5,
          performance_time_ms: 500,
          count_in_remaining_ms: 0,
          count_in_remaining_pulses: 0,
          scope_completed: false,
          scope_start_group_id: 'entry-6',
          scope_end_group_id: 'entry-8',
          scope_start_beat: 6,
          scope_terminal_beat: 9,
          nominal_scope_duration_ms: 1500,
          speed_ratio: 1,
        },
      })
    ).toMatchObject({ type: 'performance.clock_sync' });
  });

  it('accepts fixed-clock performance timeline projection messages', () => {
    expect(
      parsePracticeServerMessage({
        protocol_version: 1,
        type: 'performance.timeline',
        payload: {
          scope_start_beat: 2,
          scope_terminal_beat: 6,
          segments: [
            {
              start_performance_time_ms: 0,
              end_performance_time_ms: 1000,
              start_beat: 2,
              end_beat: 4,
            },
            {
              start_performance_time_ms: 1000,
              end_performance_time_ms: 3000,
              start_beat: 4,
              end_beat: 6,
            },
          ],
        },
      })
    ).toMatchObject({ type: 'performance.timeline' });
  });

  it('rejects malformed fixed-clock performance sync messages', () => {
    expect(() =>
      parsePracticeServerMessage({
        protocol_version: 1,
        type: 'performance.clock_sync',
        payload: {
          state: 'RUNNING',
          musical_beat: 6.5,
          performance_time_ms: 500,
          count_in_remaining_ms: 0,
          count_in_remaining_pulses: 0,
          scope_completed: false,
          scope_start_group_id: 'entry-6',
          scope_end_group_id: 'entry-8',
          scope_start_beat: 6,
          scope_terminal_beat: 9,
          nominal_scope_duration_ms: 1500,
          speed_ratio: 1,
          alignment_confidence: 0.9,
        },
      })
    ).toThrow();
  });

  it('rejects fixed-clock state names as lifecycle event types', () => {
    expect(() =>
      parsePracticeServerMessage({
        protocol_version: 1,
        type: 'performance.running',
        payload: {
          state: 'RUNNING',
          musical_beat: 6.5,
          performance_time_ms: 500,
          count_in_remaining_ms: 0,
          count_in_remaining_pulses: 0,
          scope_completed: false,
          scope_start_group_id: 'entry-6',
          scope_end_group_id: 'entry-8',
          scope_start_beat: 6,
          scope_terminal_beat: 9,
          nominal_scope_duration_ms: 1500,
          speed_ratio: 1,
        },
      })
    ).toThrow();
  });
});
