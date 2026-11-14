import { recordedPerformance } from '@/lib/practice/recording/recorded-performance';
import { expect, it } from 'vitest';
import { executedPerformanceFromCompletion } from './executed-performance';
import { continuousPracticePlan } from '@/lib/practice/__fixtures__/practice-plan';
import { completedContinuousSessionFixture } from '@/lib/practice/__fixtures__/continuous-result';
import {
  artifact,
  take,
} from "@/lib/practice/composite-video/__fixtures__/performance-take";
import { createNaturalContinuousCompletion } from '@/lib/practice/continuous/natural-completion';
import { unavailableContinuousEvaluation } from '@/lib/practice/continuous/domain/evaluation/session';
import {
  createTransientReviewSession,
  releaseTransientReviewSession,
} from '@/lib/practice/review/transient-review-session';
import { admitPerformanceTakeRecordedPerformance } from '@/lib/practice/performance-take/admission';
import { localMediaAssetFixture } from '@/lib/practice/__fixtures__/local-media-asset';

it('keeps exact natural Session owners and passes one authority through Review and recording', async () => {
  const plan = continuousPracticePlan(artifact),
    session = completedContinuousSessionFixture(plan);
  const media = localMediaAssetFixture(
    new Blob(['1234567890'], { type: 'video/webm' }),
  );
  const completion = createNaturalContinuousCompletion({
    session,
    evaluation: unavailableContinuousEvaluation(
      'MIDI',
      'CONTINUOUS_ANALYSIS_UNAVAILABLE',
    ),
    recording: {
      status: 'READY',
      kind: 'VIDEO',
      media,
      mimeType: 'video/webm',
      timebase: take.manifest.recording_timebase,
    },
  });
  const executed = completion.result.executed;
  expect(executed.bundle).toBe(plan.bundle);
  expect(executed.bundle.binding).toBe(plan.bundle.binding);
  expect(executed.bundle.artifact).toBe(plan.bundle.artifact);
  expect(executed.scope).toBe(plan.scope);
  expect(executed.tempoPlan).toBe(plan.tempoPlan);
  expect(Object.keys(executed).sort()).toEqual([
    'bundle',
    'scope',
    'tempoPlan',
  ]);
  expect(Object.isFrozen(executed)).toBe(true);
  const review = createTransientReviewSession(completion, {
    ...plan.bundle,
    musicXml: '<score />',
  });
  expect(review.result).toBe(completion.result);
  if (review.recording.status !== 'READY')
    throw new Error('Expected recording');
  const recorded = recordedPerformance(
    review.result.executed,
    review.recording,
  );
  expect(recorded.executed).toBe(executed);
  expect(recorded.recording).toBe(review.recording);
  const saved = admitPerformanceTakeRecordedPerformance(
    {
      ...take,
      manifest: {
        ...take.manifest,
        practice_binding: {
          ...take.manifest.practice_binding,
          bundle_id: plan.bundle.binding.bundleId,
        },
      },
    },
    plan.bundle,
    recorded.recording.media,
  );
  expect(saved.status).toBe('supported');
  if (saved.status !== 'supported') throw new Error(saved.reason);
  expect(Object.keys(saved.recordedPerformance).sort()).toEqual([
    'executed',
    'recording',
  ]);
  expect(saved.recordedPerformance).toEqual(recorded);
  expect(saved.recordedPerformance.recording.media).toBe(
    recorded.recording.media,
  );
  await releaseTransientReviewSession(review);
  await media.release();
});
it.each(['STOPPED_BY_USER', null] as const)(
  'rejects unearned execution %s',
  (completionReason) => {
    const session = completedContinuousSessionFixture(
      continuousPracticePlan(artifact),
    );
    expect(() =>
      executedPerformanceFromCompletion({ ...session, completionReason }),
    ).toThrow();
  },
);
