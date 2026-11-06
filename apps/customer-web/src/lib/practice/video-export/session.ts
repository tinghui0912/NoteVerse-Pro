import type { PerformanceRecording } from '@/lib/practice/recording/recording-artifact';
import type { RecordingTimebase } from '@/lib/practice/recording/recording-timebase';
import type { ResolvedPracticeTempoPlan } from '@/lib/practice/planning/tempo';
import type { CursorScope } from '@/lib/practice/score-view/cursor-scope';

export type VideoExportSession = {
  sessionId: string;
  bundleId: string;
  scoreIdentity: {
    scoreId: string;
    revisionId: string;
    artifactId: string;
  };
  video: Pick<Extract<PerformanceRecording, { status: 'READY' }>, 'status' | 'media' | 'mimeType'> & { kind: 'VIDEO'; actualMediaDurationMs?: number };
  scope: CursorScope;
  tempoPlan: ResolvedPracticeTempoPlan;
  recordingTimebase: RecordingTimebase;
};
