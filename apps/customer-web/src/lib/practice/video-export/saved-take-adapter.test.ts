import { localMediaAssetFixture } from '../__fixtures__/local-media-asset';
import { describe, expect, it } from 'vitest';

import {
  createVideoExportSessionFromSavedTake,
  hasSavedTakeVideoExportMetadata,
  parseSavedRecordingTimebase,
  parseSavedTempoPlan,
} from './saved-take-adapter';

import {
  take,
  artifact,
  tempoPlan,
  recordingTimebase,
} from './__fixtures__/saved-take';

describe('video export session saved-take parsing', () => {
  it('creates a session only from complete saved-video metadata', () => {
    const result = createVideoExportSessionFromSavedTake(
      take,
      ownedBlob(['video'], { type: 'video/webm' }),
      { sourceId: take.source_id, artifact: artifact }
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

  it('accepts the same raw MP4 Take as local composition input', () => {
    const blob = ownedBlob(['raw mp4'], { type: 'video/mp4' });
    const result = createVideoExportSessionFromSavedTake(
      { ...take, media_mime_type: 'video/mp4' },
      blob,
      { sourceId: take.source_id, artifact }
    );
    expect(result.status).toBe('supported');
    if (result.status !== 'supported') throw new Error('Expected MP4 source');
    expect(result.session.video.media).toBe(blob);
    expect(result.session.video.mimeType).toBe('video/mp4');
  });

  it('classifies audio and deleting takes as unsupported', () => {
    expect(
      createVideoExportSessionFromSavedTake(
        { ...take, media_kind: 'AUDIO' },
        ownedBlob(['audio']),
        { sourceId: take.source_id, artifact: artifact }
      )
    ).toMatchObject({ status: 'unsupported', reason: 'video_required' });
    expect(
      createVideoExportSessionFromSavedTake(
        { ...take, deletion_status: 'DELETING' },
        ownedBlob(['video']),
        { sourceId: take.source_id, artifact: artifact }
      )
    ).toMatchObject({ status: 'unsupported', reason: 'take_deleting' });
  });

  it('enforces exact artifact identity inside the saved-take adapter', () => {
    expect(
      createVideoExportSessionFromSavedTake(
        take,
        ownedBlob(['video'], { type: 'video/webm' }),
        {
          sourceId: take.source_id,
          artifact: { ...artifact, artifactId: 'different-artifact' },
        }
      )
    ).toMatchObject({
      status: 'unsupported',
      reason: 'artifact_identity_mismatch',
    });
  });

  it('keeps empty saved media unavailable without constructing a export session', () => {
    expect(
      createVideoExportSessionFromSavedTake(take, ownedBlob([]), {
        sourceId: take.source_id,
        artifact: artifact,
      })
    ).toEqual({
      status: 'temporarily_unavailable',
      reason: 'empty_media',
    });
  });

  it.each([
    {
      field: 'scope',
      patch: { scope_terminal_tick: take.scope_start_tick },
      reason: 'scope_terminal_tick_invalid',
    },
    {
      field: 'tempo',
      patch: { tempo_plan: { ...take.tempo_plan, segments: [] } },
      reason: 'tempo_plan_segments_missing',
    },
    {
      field: 'timebase',
      patch: {
        recording_timebase: { ...take.recording_timebase, activeSegments: [] },
      },
      reason: 'recording_timebase_segments_missing',
    },
  ])(
    'fails closed on invalid saved $field metadata at the adapter boundary',
    ({ patch, reason }) => {
      expect(
        createVideoExportSessionFromSavedTake(
          { ...take, ...patch },
          ownedBlob(['video'], { type: 'video/webm' }),
          { sourceId: take.source_id, artifact: artifact }
        )
      ).toEqual({ status: 'unsupported', reason });
    }
  );

  it('rejects missing and malformed recording timebase instead of inventing a timeline', () => {
    expect(() => parseSavedTempoPlan(null)).toThrow(/missing/);
    expect(() => parseSavedRecordingTimebase(null)).toThrow(/missing/);
    expect(() =>
      parseSavedRecordingTimebase({
        ...recordingTimebase,
        activeSegments: [],
      })
    ).toThrow(/segments_missing/);
    expect(() =>
      parseSavedTempoPlan({
        ...tempoPlan,
        segments: [{ startTick: 1, bpm: 96, source: 'MUSICXML' }],
      })
    ).toThrow(/tick_zero/);
    expect(() =>
      parseSavedRecordingTimebase({
        ...recordingTimebase,
        nominalMediaDurationMs: 5000,
        activeSegments: [
          {
            perfStartMs: 0,
            perfEndMs: 2000,
            mediaStartMs: 0,
            mediaEndMs: 2000,
          },
          {
            perfStartMs: 3000,
            perfEndMs: 5000,
            mediaStartMs: 2500,
            mediaEndMs: 5000,
          },
        ],
      })
    ).toThrow(/media_segments_not_continuous/);
    expect(parseSavedRecordingTimebase(recordingTimebase)).toEqual(
      recordingTimebase
    );
  });

  it('requires the persisted range identity to agree with the saved range start', () => {
    expect(
      createVideoExportSessionFromSavedTake(
        {
          ...take,
          scope_type: 'RANGE',
          scope_start_tick: 4,
          scope_start_group_id: 'group-1',
          scope_end_group_id: 'group-2',
        },
        ownedBlob(['video'], { type: 'video/webm' }),
        { sourceId: take.source_id, artifact: artifact }
      )
    ).toMatchObject({
      status: 'unsupported',
      reason: 'scope_identity_mismatch',
    });
  });

  it('does not claim the database duration is the decoded media duration', () => {
    const result = createVideoExportSessionFromSavedTake(
      take,
      ownedBlob(['video'], { type: 'video/webm' }),
      { sourceId: take.source_id, artifact: artifact }
    );
    expect(result.status).toBe('supported');
    if (result.status === 'supported') {
      expect(result.session.video.durationMs).toBe(4000);
      expect(result.session.video.actualMediaDurationMs).toBeUndefined();
    }
  });

  it('rejects a RANGE take without exact scope identity', () => {
    expect(
      createVideoExportSessionFromSavedTake(
        { ...take, scope_type: 'RANGE' },
        ownedBlob(['video'], { type: 'video/webm' }),
        { sourceId: take.source_id, artifact: artifact }
      )
    ).toMatchObject({
      status: 'unsupported',
      reason: 'scope_identity_missing',
    });
  });

  it('does not require scope identity for FULL takes', () => {
    const result = createVideoExportSessionFromSavedTake(
      { ...take, scope_type: 'FULL' },
      ownedBlob(['video'], { type: 'video/webm' }),
      { sourceId: take.source_id, artifact: artifact }
    );
    expect(result.status).toBe('supported');
  });

  it('resolves and validates exact scope identity for RANGE takes', () => {
    const result = createVideoExportSessionFromSavedTake(
      {
        ...take,
        scope_type: 'RANGE',
        scope_start_group_id: 'group-1',
        scope_end_group_id: 'group-2',
      },
      ownedBlob(['video'], { type: 'video/webm' }),
      { sourceId: take.source_id, artifact: artifact }
    );
    expect(result.status).toBe('supported');
    if (result.status === 'supported') {
      expect(result.session.scope).toMatchObject({
        kind: 'RANGE',
        allowedNoteIds: ['note-1', 'note-2'],
      });
    }
  });

  it('rejects RANGE scope identity that does not match the exact artifact', () => {
    const result = createVideoExportSessionFromSavedTake(
      {
        ...take,
        scope_type: 'RANGE',
        scope_start_group_id: 'group-1',
        scope_end_group_id: 'missing-group',
      },
      ownedBlob(['video'], { type: 'video/webm' }),
      { sourceId: take.source_id, artifact: artifact }
    );
    expect(result).toMatchObject({
      status: 'unsupported',
      reason: 'scope_identity_invalid',
    });
  });
});

it('uses validated durable scope ticks and tempo without replacing saved integer values', () => {
  const persisted = { ...take };
  const result = createVideoExportSessionFromSavedTake(
    persisted,
    ownedBlob(['video']),
    { sourceId: take.source_id, artifact }
  );
  expect(result.status).toBe('supported');
  if (result.status === 'supported') {
    expect(result.session.scope.terminalTick).toBe(
      persisted.scope_terminal_tick
    );
    expect(result.session.tempoPlan).toEqual(take.tempo_plan);
  }
});

it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, 60])(
  'rejects an invalid or artifact-mismatched durable score grid %s',
  (resolution) => {
    const mismatch = {
      ...take,
      score_timebase: { ticks_per_quarter: resolution },
    };
    expect(
      createVideoExportSessionFromSavedTake(mismatch, ownedBlob(['video']), {
        sourceId: take.source_id,
        artifact,
      })
    ).toEqual({ status: 'unsupported', reason: 'score_timebase_mismatch' });
  }
);
it('rejects missing durable score timebase even with matching artifact identity and scope ticks', () => {
  const mismatch = { ...take };
  Reflect.deleteProperty(mismatch, 'score_timebase');
  expect(
    createVideoExportSessionFromSavedTake(mismatch, ownedBlob(['video']), {
      sourceId: take.source_id,
      artifact,
    })
  ).toEqual({ status: 'unsupported', reason: 'score_timebase_mismatch' });
  expect(hasSavedTakeVideoExportMetadata(mismatch)).toBe(false);
});

function ownedBlob(...args: ConstructorParameters<typeof Blob>) { return localMediaAssetFixture(new Blob(...args)); }
