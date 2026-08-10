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
});
