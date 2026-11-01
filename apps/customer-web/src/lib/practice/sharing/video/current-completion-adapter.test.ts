import { expect, it } from 'vitest';
import { createShareVideoSessionFromCompletion } from './current-completion-adapter';
import { createShareVideoSessionFromSavedTake } from './saved-take-adapter';
import { take, artifact } from './__fixtures__/saved-take';
import { resolvePracticeScope } from '@/lib/practice/kernel/scope';
import { parseSavedTempoPlan, parseSavedRecordingTimebase } from './saved-take-adapter';
const blob = new Blob(['video'], { type: 'video/webm' });
const completion = {
  result: { sourceId: take.source_id, localSessionId: take.take_id, scoreId: artifact.scoreId, revisionId: artifact.revisionId, artifactId: artifact.artifactId,
    scope: resolvePracticeScope(artifact, { kind: 'FULL' }), tempoPlan: parseSavedTempoPlan(take.tempo_plan) },
  recording: { status: 'READY' as const, kind: 'VIDEO' as const, blob, mimeType: take.media_mime_type, durationMs: take.duration_ms,
    timebase: parseSavedRecordingTimebase(take.recording_timebase) },
};
it('current and saved media converge on the same neutral downstream session', () => {
  const current = createShareVideoSessionFromCompletion(completion, { sourceId: take.source_id, artifact: artifact });
  const saved = createShareVideoSessionFromSavedTake(take, blob, { sourceId: take.source_id, artifact: artifact });
  expect(saved.status).toBe('supported');
  if (saved.status !== 'supported') throw new Error('Expected supported take');
  expect(current).toEqual(saved.session);
  for (const key of ['evaluation', 'metrics', 'provenance', 'result']) expect(current).not.toHaveProperty(key);
});
it('refuses a current recording from a different score artifact', () => {
  expect(() => createShareVideoSessionFromCompletion(completion, { sourceId: take.source_id, artifact: { ...artifact, artifactId: 'different' } })).toThrow('identity mismatch');
});
it('refuses missing or non-video current media', () => {
  expect(() => createShareVideoSessionFromCompletion({ ...completion, recording: { status: 'NOT_RECORDED' } }, { sourceId: take.source_id, artifact: artifact })).toThrow('ready video');
  expect(() => createShareVideoSessionFromCompletion({ ...completion, recording: { ...completion.recording, kind: 'AUDIO' } }, { sourceId: take.source_id, artifact: artifact })).toThrow('ready video');
});

it('keeps share session identity distinct from exact source provenance', () => {
  const current = createShareVideoSessionFromCompletion(completion, { sourceId: take.source_id, artifact });
  expect(current.sessionId).toBe(completion.result.localSessionId);
  expect(current.sourceId).toBe(take.source_id);
  expect(() => createShareVideoSessionFromCompletion(completion, { sourceId: 'different', artifact })).toThrow('identity mismatch');
  expect(createShareVideoSessionFromSavedTake(take, blob, { sourceId: 'different', artifact })).toMatchObject({ status: 'unsupported', reason: 'artifact_identity_mismatch' });
});
