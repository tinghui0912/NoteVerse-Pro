export type LocalReplayFinalizationState =
  | { status: 'not_expected' }
  | { status: 'finalizing'; sessionId: string }
  | { status: 'ready'; sessionId: string }
  | { status: 'failed'; sessionId: string };

export function shouldWaitForLocalReplayHandoff(
  sessionId: string,
  finalization: LocalReplayFinalizationState
): boolean {
  return finalization.status === 'finalizing' && finalization.sessionId === sessionId;
}

export function completedReportHandoffSessionId(
  pendingSessionId: string | null,
  finalization: LocalReplayFinalizationState
): string | null {
  if (!pendingSessionId) {
    return null;
  }
  if (finalization.status === 'not_expected') {
    return pendingSessionId;
  }
  if (finalization.sessionId !== pendingSessionId) {
    return null;
  }
  return finalization.status === 'finalizing' ? null : pendingSessionId;
}
