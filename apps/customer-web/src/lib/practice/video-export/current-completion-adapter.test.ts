import { decodeRecordingTimebase } from '@/lib/practice/recording/recording-timebase';
import { localMediaAssetFixture } from '@/lib/practice/__fixtures__/local-media-asset';
import { createTransientReviewSession } from '@/lib/practice/review/transient-review-session';
import { completedContinuousSessionFixture } from '@/lib/practice/__fixtures__/continuous-result';
import { expect, it } from 'vitest';
import { createVideoExportSessionFromCompletion } from './current-completion-adapter';
import { createVideoExportSessionFromSavedTake } from './saved-take-adapter';
import { take, artifact } from './__fixtures__/saved-take';
import { continuousPracticePlan } from '@/lib/practice/__fixtures__/practice-plan';
import { createContinuousPerformanceResult } from '@/lib/practice/result/continuous-performance-result';
import { unavailableContinuousEvaluation } from '@/lib/practice/continuous/domain/evaluation/session';
import { parseSavedTempoPlan } from './saved-take-adapter';
const blob = new Blob(['video'], { type: 'video/webm' });
const completion = {
  result: createContinuousPerformanceResult({
    session: completedContinuousSessionFixture(
      Object.freeze({
        ...continuousPracticePlan(artifact),
        bundle: Object.freeze({
          binding: {
            scoreId: 'score-1',
            revisionId: 'revision-1',
            bundleId: take.manifest.practice_binding.bundle_id,
          },
          artifact,
        }),
        tempoPlan: parseSavedTempoPlan(take.manifest.tempo_plan),
      }),
      { localSessionId: take.take_id },
    ),
    evaluation: unavailableContinuousEvaluation(
      'MIDI',
      'CONTINUOUS_ANALYSIS_UNAVAILABLE',
    ),
  }),
  recording: {
    status: 'READY' as const,
    kind: 'VIDEO' as const,
    media: localMediaAssetFixture(blob),
    mimeType: take.manifest.capture.mime_type,

    timebase: decodeRecordingTimebase(take.manifest.recording_timebase),
  },
};
const handoff = createTransientReviewSession(completion, {
  binding: {
    scoreId: 'score-1',
    revisionId: 'revision-1',
    bundleId: take.manifest.practice_binding.bundle_id,
  },
  artifact,
  musicXml: '<score />',
});
it('current and saved media converge on the same neutral downstream session', () => {
  const current = createVideoExportSessionFromCompletion(handoff);
  const saved = createVideoExportSessionFromSavedTake(
    take,
    handoff.recording.status === 'READY'
      ? handoff.recording.media
      : localMediaAssetFixture(blob),
    {
      binding: {
        scoreId: 'score-1',
        revisionId: 'revision-1',
        bundleId: take.manifest.practice_binding.bundle_id,
      },
      artifact: artifact,
    },
  );
  expect(saved.status).toBe('supported');
  if (saved.status !== 'supported') throw new Error('Expected supported take');
  expect(current).toEqual(saved.session);
  expect(current.video.media).toBe(saved.session.video.media);
  for (const key of ['evaluation', 'metrics', 'provenance', 'result'])
    expect(current).not.toHaveProperty(key);
});
it('refuses missing or non-video current media', () => {
  expect(() =>
    createVideoExportSessionFromCompletion({
      ...handoff,
      recording: { status: 'NOT_RECORDED' },
    }),
  ).toThrow('ready video');
  expect(() =>
    createVideoExportSessionFromCompletion({
      ...handoff,
      recording: { ...completion.recording, kind: 'AUDIO' },
    }),
  ).toThrow('ready video');
});

it('keeps export session identity distinct from exact source provenance', () => {
  const current = createVideoExportSessionFromCompletion(handoff);
  expect(current.sessionId).toBe(completion.result.session.localSessionId);
  expect(current.bundleId).toBe(take.manifest.practice_binding.bundle_id);
  expect(
    createVideoExportSessionFromSavedTake(
      take,
      handoff.recording.status === 'READY'
        ? handoff.recording.media
        : localMediaAssetFixture(blob),
      {
        binding: {
          scoreId: 'score-1',
          revisionId: 'revision-1',
          bundleId: 'different',
        },
        artifact,
      },
    ),
  ).toMatchObject({
    status: 'unsupported',
    reason: 'artifact_identity_mismatch',
  });
});
