import type { PerformanceRecording } from '@/lib/practice/recording/recording-artifact';
import type { RecordingTimebaseMapping } from '@/lib/practice/recording/recording-timebase';
import type { ResolvedPracticeTempoPlan } from '@/lib/practice/kernel/tempo';
import type { CursorScope } from '@/lib/practice/score-view/cursor-scope';

export type ShareVideoSession = {
  sessionId: string;
  sourceId: string;
  scoreIdentity: {
    scoreId: string;
    revisionId: string;
    artifactId: string;
  };
  video: Pick<Extract<PerformanceRecording, { status: 'READY' }>, 'status' | 'blob' | 'mimeType' | 'durationMs'> & { kind: 'VIDEO'; actualMediaDurationMs?: number };
  scope: CursorScope;
  tempoPlan: ResolvedPracticeTempoPlan;
  recordingTimebase: RecordingTimebaseMapping;
};
