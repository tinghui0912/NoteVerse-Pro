import { describe, expect, it } from 'vitest';

import {
  createShareVideoSessionFromSavedTake,
  parseSavedSyncMetadata,
  parseSavedTempoPlan,
} from './share-video-session';
import type {
  PerformanceTakeRead,
  PerformanceTakeSyncMetadata,
  ResolvedTempoPlan,
} from '@/lib/api/performance-takes';

const tempoPlan: ResolvedTempoPlan = {
  selection: { mode: 'SCORE' },
  segments: [{ startBeat: 0, bpm: 96, source: 'MUSICXML' }],
};

const syncMetadata: PerformanceTakeSyncMetadata = {
  recordingTimebase: {
    recordingStartPerfTimeMs: 0,
    recordingEndPerfTimeMs: 4000,
    nominalMediaDurationMs: 4000,
    activeSegments: [
      { perfStartMs: 0, perfEndMs: 4000, mediaStartMs: 0, mediaEndMs: 4000 },
    ],
  },
  scopeIdentity: {
    startGroupId: 'group-1',
    endGroupId: 'group-2',
  },
};

const take: PerformanceTakeRead = {
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
};

const artifact = {
  schemaVersion: 1 as const,
  scoreId: 'score-1',
  revisionId: 'revision-1',
  artifactId: 'artifact-1',
  playableEvents: [],
  scoreTempoSegments: [{ startBeat: 0, bpm: 96 }],
  meterSegments: [{
    startBeat: 0,
    numerator: 4,
    denominator: 4,
    measureDurationBeats: 4,
    countInPulses: 0,
  }],
  firstPlayableBeat: 0,
  scoreEndBeat: 16,
  expectedPracticeGroups: [
    {
      groupId: 'group-1',
      onsetBeat: 0,
      eventIds: [],
      expectedNotes: [],
      strikeTargets: [],
      renderNoteIds: ['note-1'],
      pitches: [],
      measureNumbers: ['1'],
      staffIds: [],
      voiceIds: [],
      canonicalEndBeat: 4,
    },
    {
      groupId: 'group-2',
      onsetBeat: 4,
      eventIds: [],
      expectedNotes: [],
      strikeTargets: [],
      renderNoteIds: ['note-2'],
      pitches: [],
      measureNumbers: ['2'],
      staffIds: [],
      voiceIds: [],
      canonicalEndBeat: 16,
    },
  ],
  practiceAttackSteps: [
    {
      stepId: 'step-1',
      onsetBeat: 0,
      eventIds: [],
      attackTargets: [],
      continuation: [],
      renderNoteIds: ['note-1'],
      measureNumbers: ['1'],
      staffIds: [],
      voiceIds: [],
    },
    {
      stepId: 'step-2',
      onsetBeat: 4,
      eventIds: [],
      attackTargets: [],
      continuation: [],
      renderNoteIds: ['note-2'],
      measureNumbers: ['2'],
      staffIds: [],
      voiceIds: [],
    },
  ],
};

describe('share video session saved-take parsing', () => {
  it('creates a session only from complete historical video metadata', () => {
    const result = createShareVideoSessionFromSavedTake(
      take,
      new Blob(['video'], { type: 'video/webm' }),
      artifact
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
        new Blob(['audio']),
        artifact
      )
    ).toMatchObject({ status: 'unsupported', reason: 'video_required' });
    expect(
      createShareVideoSessionFromSavedTake(
        { ...take, deletion_status: 'DELETING' },
        new Blob(['video']),
        artifact
      )
    ).toMatchObject({ status: 'unsupported', reason: 'take_deleting' });
    expect(
      createShareVideoSessionFromSavedTake(
        { ...take, artifact_id: '' },
        new Blob(['video']),
        artifact
      )
    ).toMatchObject({ status: 'unsupported', reason: 'score_revision_artifact_missing' });
  });

  it('enforces exact artifact identity inside the saved-take adapter', () => {
    expect(
      createShareVideoSessionFromSavedTake(
        take,
        new Blob(['video'], { type: 'video/webm' }),
        { ...artifact, artifactId: 'different-artifact' }
      )
    ).toMatchObject({ status: 'unsupported', reason: 'artifact_identity_mismatch' });
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
    expect(
      parseSavedSyncMetadata({
        recordingTimebase: syncMetadata.recordingTimebase,
      }).scopeIdentity
    ).toBeUndefined();
  });

  it('requires the persisted range identity to agree with the saved range start', () => {
    expect(
      createShareVideoSessionFromSavedTake(
        { ...take, scope_start_beat: 4, sync_metadata: syncMetadata },
        new Blob(['video'], { type: 'video/webm' }),
        artifact
      ).status
    ).toBe('supported');
    expect(
      createShareVideoSessionFromSavedTake(
        {
          ...take,
          scope_type: 'RANGE',
          scope_start_beat: 4,
          sync_metadata: syncMetadata,
        },
        new Blob(['video'], { type: 'video/webm' }),
        artifact
      )
    ).toMatchObject({ status: 'unsupported', reason: 'scope_identity_mismatch' });
  });

  it('does not claim the database duration is the decoded media duration', () => {
    const result = createShareVideoSessionFromSavedTake(
      take,
      new Blob(['video'], { type: 'video/webm' }),
      artifact
    );
    expect(result.status).toBe('supported');
    if (result.status === 'supported') {
      expect(result.session.video.durationMs).toBe(4000);
      expect(result.session.video.actualMediaDurationMs).toBeUndefined();
    }
  });

  it('rejects a RANGE take without exact scope identity', () => {
    expect(
      createShareVideoSessionFromSavedTake(
        { ...take, scope_type: 'RANGE', sync_metadata: {
          recordingTimebase: syncMetadata.recordingTimebase,
        } },
      new Blob(['video'], { type: 'video/webm' }),
      artifact
      )
    ).toMatchObject({ status: 'unsupported', reason: 'scope_identity_missing' });
  });

  it('does not require scope identity for FULL takes', () => {
    const result = createShareVideoSessionFromSavedTake(
      { ...take, scope_type: 'FULL', sync_metadata: {
        recordingTimebase: syncMetadata.recordingTimebase,
      } },
      new Blob(['video'], { type: 'video/webm' }),
      artifact
    );
    expect(result.status).toBe('supported');
  });

  it('resolves and validates exact scope identity for RANGE takes', () => {
    const result = createShareVideoSessionFromSavedTake(
      { ...take, scope_type: 'RANGE' },
      new Blob(['video'], { type: 'video/webm' }),
      artifact
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
    const result = createShareVideoSessionFromSavedTake(
      {
        ...take,
        scope_type: 'RANGE',
        sync_metadata: {
          ...syncMetadata,
          scopeIdentity: { startGroupId: 'group-1', endGroupId: 'missing-group' },
        },
      },
      new Blob(['video'], { type: 'video/webm' }),
      artifact
    );
    expect(result).toMatchObject({
      status: 'unsupported',
      reason: 'scope_identity_invalid',
    });
  });
});
