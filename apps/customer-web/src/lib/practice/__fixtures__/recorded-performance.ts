import type { ReadyPerformanceRecording } from '@/lib/practice/recording/recording-artifact';
import { continuousPracticePlan } from './practice-plan';
import { completedContinuousSessionFixture } from './continuous-result';
import { executedPerformanceFromCompletion } from '@/lib/practice/run/executed-performance';
import { recordedPerformance } from '@/lib/practice/recording/recorded-performance';
import type { ContinuousPracticePlan } from '@/lib/practice/planning/practice-plan';
import { artifact } from "@/lib/practice/composite-video/__fixtures__/saved-take";
import { localMediaAssetFixture } from './local-media-asset';
export function recordedPerformanceFixture(
  plan: ContinuousPracticePlan = continuousPracticePlan(artifact),
  recording: ReadyPerformanceRecording = {
    status: 'READY',
    kind: 'VIDEO',
    media: localMediaAssetFixture(new Blob(['video'], { type: 'video/webm' })),
    mimeType: 'video/webm',
    timebase: {
      nominalMediaDurationUs: 4000000,
      activeSegments: [
        {
          performanceStartUs: 0,
          performanceEndUs: 4000000,
          mediaStartUs: 0,
          mediaEndUs: 4000000,
        },
      ],
    },
  },
) {
  return recordedPerformance(
    executedPerformanceFromCompletion(completedContinuousSessionFixture(plan)),
    recording,
  );
}
