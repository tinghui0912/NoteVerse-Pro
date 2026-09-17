import type { PlayablePerformanceReplay } from '@/lib/practice/performance-replay';

const replayBySessionId = new Map<string, PlayablePerformanceReplay>();

export function savePlayablePerformanceReplay(
  sessionId: string,
  replay: PlayablePerformanceReplay
) {
  replayBySessionId.set(sessionId, replay);
}

export function readPlayablePerformanceReplay(
  sessionId: string | null | undefined
): PlayablePerformanceReplay | null {
  if (!sessionId) {
    return null;
  }
  return replayBySessionId.get(sessionId) ?? null;
}

export function deletePlayablePerformanceReplay(sessionId: string | null | undefined) {
  if (!sessionId) {
    return;
  }
  replayBySessionId.delete(sessionId);
}
