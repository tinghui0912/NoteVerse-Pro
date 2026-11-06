import { decodeRecordingTimebase } from '@/lib/practice/recording/recording-timebase';
import { localMediaAssetFixture } from '../__fixtures__/local-media-asset';
import { describe, expect, it } from 'vitest';
import {
  createVideoExportSessionFromSavedTake,
  hasSavedTakeVideoExportMetadata,
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
      {
        binding: {
          scoreId: 'score-1',
          revisionId: 'revision-1',
          bundleId: take.manifest.practice_binding.bundle_id,
        },
        artifact: artifact,
      },
    );
    expect(result.status).toBe('supported');
    if (result.status === 'supported') {
      expect(result.session.scoreIdentity).toEqual({
        scoreId: 'score-1',
        revisionId: 'revision-1',
        artifactId: artifact.artifactId,
      });
      expect(result.session.recordingTimebase.activeSegments).toHaveLength(1);
    }
  });
  it('accepts the same raw MP4 Take as local composition input', () => {
    const blob = ownedBlob(['raw mp4'], { type: 'video/mp4' });
    const result = createVideoExportSessionFromSavedTake(
      {
        ...take,
        archive_media: { ...take.archive_media, mime_type: 'video/mp4' },
        manifest: {
          ...take.manifest,
          capture: { ...take.manifest.capture, mime_type: 'video/mp4' },
        },
      },
      blob,
      {
        binding: {
          scoreId: 'score-1',
          revisionId: 'revision-1',
          bundleId: take.manifest.practice_binding.bundle_id,
        },
        artifact,
      },
    );
    expect(result.status).toBe('supported');
    if (result.status !== 'supported') throw new Error('Expected MP4 source');
    expect(result.session.video.media).toBe(blob);
    expect(result.session.video.mimeType).toBe('video/mp4');
  });
  it('classifies audio and deleting takes as unsupported', () => {
    expect(
      createVideoExportSessionFromSavedTake(
        {
          ...take,
          manifest: {
            ...take.manifest,
            capture: {
              ...take.manifest.capture,
              kind: 'AUDIO',
            },
          },
        },
        ownedBlob(['audio']),
        {
          binding: {
            scoreId: 'score-1',
            revisionId: 'revision-1',
            bundleId: take.manifest.practice_binding.bundle_id,
          },
          artifact: artifact,
        },
      ),
    ).toMatchObject({ status: 'unsupported', reason: 'video_required' });
    expect(
      createVideoExportSessionFromSavedTake(
        { ...take, deletion_status: 'DELETING' },
        ownedBlob(['video']),
        {
          binding: {
            scoreId: 'score-1',
            revisionId: 'revision-1',
            bundleId: take.manifest.practice_binding.bundle_id,
          },
          artifact: artifact,
        },
      ),
    ).toMatchObject({ status: 'unsupported', reason: 'take_deleting' });
  });
  it('enforces exact artifact identity inside the saved-take adapter', () => {
    expect(
      createVideoExportSessionFromSavedTake(
        take,
        ownedBlob(['video'], { type: 'video/webm' }),
        {
          binding: {
            scoreId: 'score-1',
            revisionId: 'revision-1',
            bundleId: take.manifest.practice_binding.bundle_id,
          },
          artifact: { ...artifact, artifactId: 'different-artifact' },
        },
      ),
    ).toMatchObject({
      status: 'unsupported',
      reason: 'artifact_identity_mismatch',
    });
  });
  it('keeps empty saved media unavailable without constructing a export session', () => {
    expect(
      createVideoExportSessionFromSavedTake(take, ownedBlob([]), {
        binding: {
          scoreId: 'score-1',
          revisionId: 'revision-1',
          bundleId: take.manifest.practice_binding.bundle_id,
        },
        artifact: artifact,
      }),
    ).toEqual({
      status: 'temporarily_unavailable',
      reason: 'empty_media',
    });
  });
  it.each([
    {
      field: 'scope',
      patch: {
        scope: {
          ...take.manifest.scope,
          terminal_tick: take.manifest.scope.start_tick,
        },
      },
      reason: 'scope_terminal_tick_invalid',
    },
    {
      field: 'tempo',
      patch: { tempo_plan: { ...take.manifest.tempo_plan, segments: [] } },
      reason: 'tempo_plan_segments_missing',
    },
    {
      field: 'timebase',
      patch: {
        recording_timebase: {
          ...take.manifest.recording_timebase,
          activeSegments: [],
        },
      },
      reason: 'recording_timebase_invalid',
    },
  ])(
    'fails closed on invalid saved $field metadata at the adapter boundary',
    ({ patch, reason }) => {
      expect(
        createVideoExportSessionFromSavedTake(
          { ...take, manifest: { ...take.manifest, ...patch } } as never,
          ownedBlob(['video'], { type: 'video/webm' }),
          {
            binding: {
              scoreId: 'score-1',
              revisionId: 'revision-1',
              bundleId: take.manifest.practice_binding.bundle_id,
            },
            artifact: artifact,
          },
        ),
      ).toEqual({ status: 'unsupported', reason });
    },
  );
  it('rejects missing and malformed recording timebase instead of inventing a timeline', () => {
    expect(() => parseSavedTempoPlan(null)).toThrow(/missing/);
    expect(() => decodeRecordingTimebase(null)).toThrow(
      /recording_timebase_invalid/,
    );
    expect(() =>
      decodeRecordingTimebase({
        ...recordingTimebase,
        activeSegments: [],
      }),
    ).toThrow(/recording_timebase_invalid/);
    expect(() =>
      parseSavedTempoPlan({
        ...tempoPlan,
        segments: [{ startTick: 1, bpm: 96, source: 'MUSICXML' }],
      }),
    ).toThrow(/tick_zero/);
    expect(() =>
      decodeRecordingTimebase({
        ...recordingTimebase,
        nominalMediaDurationUs: 5000000,
        activeSegments: [
          {
            performanceStartUs: 0,
            performanceEndUs: 2000000,
            mediaStartUs: 0,
            mediaEndUs: 2000000,
          },
          {
            performanceStartUs: 3000000,
            performanceEndUs: 5000000,
            mediaStartUs: 2500000,
            mediaEndUs: 5000000,
          },
        ],
      }),
    ).toThrow(/recording_timebase_invalid/);
    expect(decodeRecordingTimebase(recordingTimebase)).toEqual(
      recordingTimebase,
    );
  });
  it('requires the persisted range identity to agree with the saved range start', () => {
    expect(
      createVideoExportSessionFromSavedTake(
        {
          ...take,
          manifest: {
            ...take.manifest,
            scope: {
              ...take.manifest.scope,
              kind: 'RANGE',
              start_tick: 4,
              start_group_id: 'group-1',
              end_group_id: 'group-2',
            },
          },
        },
        ownedBlob(['video'], { type: 'video/webm' }),
        {
          binding: {
            scoreId: 'score-1',
            revisionId: 'revision-1',
            bundleId: take.manifest.practice_binding.bundle_id,
          },
          artifact: artifact,
        },
      ),
    ).toMatchObject({
      status: 'unsupported',
      reason: 'scope_identity_mismatch',
    });
  });
  it('does not claim the database duration is the decoded media duration', () => {
    const result = createVideoExportSessionFromSavedTake(
      take,
      ownedBlob(['video'], { type: 'video/webm' }),
      {
        binding: {
          scoreId: 'score-1',
          revisionId: 'revision-1',
          bundleId: take.manifest.practice_binding.bundle_id,
        },
        artifact: artifact,
      },
    );
    expect(result.status).toBe('supported');
    if (result.status === 'supported') {
      expect(result.session.recordingTimebase.nominalMediaDurationUs).toBe(
        4000000,
      );
      expect(result.session.video.actualMediaDurationMs).toBeUndefined();
    }
  });
  it('rejects a RANGE take without exact scope identity', () => {
    expect(
      createVideoExportSessionFromSavedTake(
        {
          ...take,
          manifest: {
            ...take.manifest,
            scope: {
              ...take.manifest.scope,
              kind: 'RANGE',
            } as never,
          },
        },
        ownedBlob(['video'], { type: 'video/webm' }),
        {
          binding: {
            scoreId: 'score-1',
            revisionId: 'revision-1',
            bundleId: take.manifest.practice_binding.bundle_id,
          },
          artifact: artifact,
        },
      ),
    ).toMatchObject({
      status: 'unsupported',
      reason: 'scope_identity_missing',
    });
  });
  it('does not require scope identity for FULL takes', () => {
    const result = createVideoExportSessionFromSavedTake(
      {
        ...take,
        manifest: {
          ...take.manifest,
          scope: {
            ...take.manifest.scope,
            kind: 'FULL',
          },
        },
      },
      ownedBlob(['video'], { type: 'video/webm' }),
      {
        binding: {
          scoreId: 'score-1',
          revisionId: 'revision-1',
          bundleId: take.manifest.practice_binding.bundle_id,
        },
        artifact: artifact,
      },
    );
    expect(result.status).toBe('supported');
  });
  it('resolves and validates exact scope identity for RANGE takes', () => {
    const result = createVideoExportSessionFromSavedTake(
      {
        ...take,
        manifest: {
          ...take.manifest,
          scope: {
            ...take.manifest.scope,
            kind: 'RANGE',
            start_group_id: 'group-1',
            end_group_id: 'group-2',
          },
        },
      },
      ownedBlob(['video'], { type: 'video/webm' }),
      {
        binding: {
          scoreId: 'score-1',
          revisionId: 'revision-1',
          bundleId: take.manifest.practice_binding.bundle_id,
        },
        artifact: artifact,
      },
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
        manifest: {
          ...take.manifest,
          scope: {
            ...take.manifest.scope,
            kind: 'RANGE',
            start_group_id: 'group-1',
            end_group_id: 'missing-group',
          },
        },
      },
      ownedBlob(['video'], { type: 'video/webm' }),
      {
        binding: {
          scoreId: 'score-1',
          revisionId: 'revision-1',
          bundleId: take.manifest.practice_binding.bundle_id,
        },
        artifact: artifact,
      },
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
    {
      binding: {
        scoreId: 'score-1',
        revisionId: 'revision-1',
        bundleId: take.manifest.practice_binding.bundle_id,
      },
      artifact,
    },
  );
  expect(result.status).toBe('supported');
  if (result.status === 'supported') {
    expect(result.session.scope.terminalTick).toBe(
      persisted.manifest.scope.terminal_tick,
    );
    expect(result.session.tempoPlan).toEqual(take.manifest.tempo_plan);
  }
});
it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, 60])(
  'rejects an invalid or artifact-mismatched durable score grid %s',
  (resolution) => {
    const mismatch = {
      ...take,
      manifest: {
        ...take.manifest,
        score_timebase: { ticks_per_quarter: resolution },
      },
    };
    expect(
      createVideoExportSessionFromSavedTake(mismatch, ownedBlob(['video']), {
        binding: {
          scoreId: 'score-1',
          revisionId: 'revision-1',
          bundleId: take.manifest.practice_binding.bundle_id,
        },
        artifact,
      }),
    ).toEqual({ status: 'unsupported', reason: 'score_timebase_mismatch' });
  },
);
it('rejects missing durable score timebase even with matching artifact identity and scope ticks', () => {
  const mismatch = { ...take };
  Reflect.deleteProperty(mismatch.manifest, 'score_timebase');
  expect(
    createVideoExportSessionFromSavedTake(mismatch, ownedBlob(['video']), {
      binding: {
        scoreId: 'score-1',
        revisionId: 'revision-1',
        bundleId: take.manifest.practice_binding.bundle_id,
      },
      artifact,
    }),
  ).toEqual({ status: 'unsupported', reason: 'score_timebase_mismatch' });
  expect(hasSavedTakeVideoExportMetadata(mismatch)).toBe(false);
});
function ownedBlob(...args: ConstructorParameters<typeof Blob>) {
  return localMediaAssetFixture(new Blob(...args));
}
