import { describe, expect, it } from 'vitest';

import {
  createShareVideoSessionFromSavedTake,
  parseSavedSyncMetadata,
  parseSavedTempoPlan,
} from './share-video-session';

const tempoPlan = {
  selection: { mode: 'SCORE' },
  segments: [{ startBeat: 0, bpm: 96, source: 'MUSICXML' }],
};

const syncMetadata = {
  recordingTimebase: {
    recordingStartPerfTimeMs: 0,
    recordingEndPerfTimeMs: 4000,
    nominalMediaDurationMs: 4000,
    activeSegments: [
      { perfStartMs: 0, perfEndMs: 4000, mediaStartMs: 0, mediaEndMs: 4000 },
    ],
  },
  replayTiming: {
    scopeStartBeat: 0,
    scopeStartMs: 0,
    nominalDurationMs: 4000,
  },
};

const take = {
  take_id: 'take-1',
  score_id: 'score-1',
  revision_id: 'revision-1',
  artifact_id: 'artifact-1',
  media_kind: 'VIDEO',
  media_mime_type: 'video/webm',
  media_byte_size: 10,
  duration_ms: 4000,
  scope_start_beat: 0,
  scope_terminal_beat: 16,
  deletion_status: 'ACTIVE',
  resolved_tempo_plan: tempoPlan,
  sync_metadata: syncMetadata,
  created_at: '2026-09-26T00:00:00.000Z',
} as const;

describe('share video session saved-take parsing', () => {
  it('creates a session only from complete historical video metadata', () => {
    const result = createShareVideoSessionFromSavedTake(
      take,
      new Blob(['video'], { type: 'video/webm' })
    );
    expect(result.status).toBe('supported');
    if (result.status === 'supported') {
      expect(result.session.scoreIdentity).toEqual({
        scoreId: 'score-1',
        revisionId: 'revision-1',
        artifactId: 'artifact-1',
      });
      expect(result.session.recordingTimebase.activeSegments).toHaveLength(1);
    }
  });

  it('classifies audio, deleting, and missing identity takes as unsupported', () => {
    expect(
      createShareVideoSessionFromSavedTake(
        { ...take, media_kind: 'AUDIO' },
        new Blob(['audio'])
      )
    ).toMatchObject({ status: 'unsupported', reason: 'video_required' });
    expect(
      createShareVideoSessionFromSavedTake(
        { ...take, deletion_status: 'DELETING' },
        new Blob(['video'])
      )
    ).toMatchObject({ status: 'unsupported', reason: 'take_deleting' });
    expect(
      createShareVideoSessionFromSavedTake(
        { ...take, artifact_id: null },
        new Blob(['video'])
      )
    ).toMatchObject({ status: 'unsupported', reason: 'score_revision_artifact_missing' });
  });

  it('rejects missing and malformed sync data instead of inventing a timeline', () => {
    expect(() => parseSavedTempoPlan(null)).toThrow(/missing/);
    expect(() => parseSavedSyncMetadata(null)).toThrow(/missing/);
    expect(() =>
      parseSavedSyncMetadata({
        ...syncMetadata,
        recordingTimebase: {
          ...syncMetadata.recordingTimebase,
          activeSegments: [],
        },
      })
    ).toThrow(/segments_missing/);
    expect(() =>
      parseSavedTempoPlan({
        ...tempoPlan,
        segments: [{ startBeat: 1, bpm: 96, source: 'MUSICXML' }],
      })
    ).toThrow(/beat_zero/);
  });
});
