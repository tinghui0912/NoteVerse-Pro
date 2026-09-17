import { describe, expect, it } from 'vitest';

import {
  completedReportHandoffSessionId,
  shouldWaitForLocalReplayHandoff,
  type LocalReplayFinalizationState,
} from './report-handoff';

describe('report handoff', () => {
  it('waits only while the same session replay is finalizing', () => {
    expect(
      shouldWaitForLocalReplayHandoff('session-1', {
        status: 'finalizing',
        sessionId: 'session-1',
      })
    ).toBe(true);
    expect(
      shouldWaitForLocalReplayHandoff('session-1', {
        status: 'finalizing',
        sessionId: 'session-2',
      })
    ).toBe(false);
  });

  it.each([
    [{ status: 'not_expected' }, 'session-1'],
    [{ status: 'ready', sessionId: 'session-1' }, 'session-1'],
    [{ status: 'failed', sessionId: 'session-1' }, 'session-1'],
    [{ status: 'finalizing', sessionId: 'session-1' }, null],
    [{ status: 'ready', sessionId: 'session-2' }, null],
  ] satisfies Array<[LocalReplayFinalizationState, string | null]>)(
    'resolves pending report handoff from %o to %s',
    (finalization, expectedSessionId) => {
      expect(completedReportHandoffSessionId('session-1', finalization)).toBe(
        expectedSessionId
      );
    }
  );

  it('does not resolve without a pending report handoff', () => {
    expect(
      completedReportHandoffSessionId(null, {
        status: 'ready',
        sessionId: 'session-1',
      })
    ).toBeNull();
  });
});
