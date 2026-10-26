import { expect, it } from 'vitest';
import { createShareVideoSessionFromCompletion } from './current-completion-adapter';
import { createShareVideoSessionFromSavedTake } from './saved-take-adapter';
import { take, artifact } from './__fixtures__/saved-take';
import { resolvePracticeScope } from '@/lib/practice/kernel/scope';
import { parseSavedTempoPlan, parseSavedRecordingTimebase } from './saved-take-adapter';
const blob = new Blob(['video'], { type: 'video/webm' });
const completion = {
  result: { localSessionId: take.take_id, scoreId: artifact.scoreId, revisionId: artifact.revisionId, artifactId: artifact.artifactId,
    scope: resolvePracticeScope(artifact, { kind: 'FULL' }), tempoPlan: parseSavedTempoPlan(take.tempo_plan) },
  recording: { status: 'READY' as const, kind: 'VIDEO' as const, blob, mimeType: take.media_mime_type, durationMs: take.duration_ms,
    timebase: parseSavedRecordingTimebase(take.recording_timebase) },
};
it('current and saved media converge on the same neutral downstream session', () => {
  const current = createShareVideoSessionFromCompletion(completion, artifact);
  const saved = createShareVideoSessionFromSavedTake(take, blob, artifact);
  expect(saved.status).toBe('supported');
  if (saved.status !== 'supported') throw new Error('Expected supported take');
  expect(current).toEqual(saved.session);
  for (const key of ['evaluation', 'metrics', 'provenance', 'result']) expect(current).not.toHaveProperty(key);
});
it('refuses a current recording from a different score artifact', () => {
  expect(() => createShareVideoSessionFromCompletion(completion, { ...artifact, artifactId: 'different' })).toThrow('identity mismatch');
});
it('refuses missing or non-video current media', () => {
  expect(() => createShareVideoSessionFromCompletion({ ...completion, recording: { status: 'NOT_RECORDED' } }, artifact)).toThrow('ready video');
  expect(() => createShareVideoSessionFromCompletion({ ...completion, recording: { ...completion.recording, kind: 'AUDIO' } }, artifact)).toThrow('ready video');
});
