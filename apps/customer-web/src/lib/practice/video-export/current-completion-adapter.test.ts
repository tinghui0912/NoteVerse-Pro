import { recordingResourceFixture } from '@/lib/practice/__fixtures__/recording-sink';
import { createTransientReviewSession } from '@/lib/practice/review/transient-review-session';
import { canonicalContinuousResultFixture } from '@/lib/practice/__fixtures__/continuous-result';
import { expect, it } from 'vitest';
import { createVideoExportSessionFromCompletion } from './current-completion-adapter';
import { createVideoExportSessionFromSavedTake } from './saved-take-adapter';
import { take, artifact } from './__fixtures__/saved-take';
import { resolvePracticeScope } from '@/lib/practice/planning/scope';
import { parseSavedTempoPlan, parseSavedRecordingTimebase } from './saved-take-adapter';
const blob = new Blob(['video'], { type: 'video/webm' });
const completion = {
  result: { ...canonicalContinuousResultFixture('MIDI',48000,false), sourceId: take.source_id, localSessionId: take.take_id, scoreId: artifact.scoreId, revisionId: artifact.revisionId, artifactId: artifact.artifactId,
    scope: resolvePracticeScope(artifact, { kind: 'FULL' }), tempoPlan: parseSavedTempoPlan(take.tempo_plan) },
  recording: { resource: recordingResourceFixture(), status: 'READY' as const, kind: 'VIDEO' as const, blob, mimeType: take.media_mime_type, durationMs: take.duration_ms,
    timebase: parseSavedRecordingTimebase(take.recording_timebase) },
};
const handoff=createTransientReviewSession(completion,{sourceId:take.source_id,artifact,musicXml:'<score />'});
it('current and saved media converge on the same neutral downstream session', () => {
  const current = createVideoExportSessionFromCompletion(handoff);
  const saved = createVideoExportSessionFromSavedTake(take, blob, { sourceId: take.source_id, artifact: artifact });
  expect(saved.status).toBe('supported');
  if (saved.status !== 'supported') throw new Error('Expected supported take');
  const { captureResource, ...presentation } = current;
  expect(presentation).toEqual(saved.session);
  expect(captureResource).toBe(handoff.recording.status === 'READY' ? handoff.recording.resource : undefined);
  expect(saved.session.captureResource).toBeUndefined();
  for (const key of ['evaluation', 'metrics', 'provenance', 'result']) expect(current).not.toHaveProperty(key);
});
it('refuses missing or non-video current media', () => {
  expect(() => createVideoExportSessionFromCompletion({ ...handoff, recording: { status: 'NOT_RECORDED' } })).toThrow('ready video');
  expect(() => createVideoExportSessionFromCompletion({ ...handoff, recording: { ...completion.recording, kind: 'AUDIO' } })).toThrow('ready video');
});

it('keeps export session identity distinct from exact source provenance', () => {
  const current = createVideoExportSessionFromCompletion(handoff);
  expect(current.sessionId).toBe(completion.result.localSessionId);
  expect(current.sourceId).toBe(take.source_id);
  expect(createVideoExportSessionFromSavedTake(take, blob, { sourceId: 'different', artifact })).toMatchObject({ status: 'unsupported', reason: 'artifact_identity_mismatch' });
});
