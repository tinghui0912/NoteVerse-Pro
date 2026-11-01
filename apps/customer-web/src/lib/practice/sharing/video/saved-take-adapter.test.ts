import { describe, expect, it } from 'vitest';

import {
  createShareVideoSessionFromSavedTake,
  parseSavedRecordingTimebase,
  parseSavedTempoPlan,
} from './saved-take-adapter';

import { take, artifact, tempoPlan, recordingTimebase } from './__fixtures__/saved-take';

describe('share video session saved-take parsing', () => {
  it('creates a session only from complete saved-video metadata', () => {
    const result = createShareVideoSessionFromSavedTake(
      take,
      new Blob(['video'], { type: 'video/webm' }),
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

  it('classifies audio and deleting takes as unsupported', () => {
    expect(
      createShareVideoSessionFromSavedTake(
        { ...take, media_kind: 'AUDIO' },
        new Blob(['audio']),
        { sourceId: take.source_id, artifact: artifact }
      )
    ).toMatchObject({ status: 'unsupported', reason: 'video_required' });
    expect(
      createShareVideoSessionFromSavedTake(
        { ...take, deletion_status: 'DELETING' },
        new Blob(['video']),
        { sourceId: take.source_id, artifact: artifact }
      )
    ).toMatchObject({ status: 'unsupported', reason: 'take_deleting' });
  });

  it('enforces exact artifact identity inside the saved-take adapter', () => {
    expect(
      createShareVideoSessionFromSavedTake(
        take,
        new Blob(['video'], { type: 'video/webm' }),
        { sourceId: take.source_id, artifact: { ...artifact, artifactId: 'different-artifact' } }
      )
    ).toMatchObject({ status: 'unsupported', reason: 'artifact_identity_mismatch' });
  });

  it('keeps empty saved media unavailable without constructing a share session', () => {
    expect(createShareVideoSessionFromSavedTake(take, new Blob([]), { sourceId: take.source_id, artifact: artifact })).toEqual({
      status: 'temporarily_unavailable',
      reason: 'empty_media',
    });
  });

  it.each([
    { field: 'scope', patch: { scope_terminal_beat: take.scope_start_beat }, reason: 'scope_terminal_beat_invalid' },
    { field: 'tempo', patch: { tempo_plan: { ...take.tempo_plan, segments: [] } }, reason: 'tempo_plan_segments_missing' },
    { field: 'timebase', patch: { recording_timebase: { ...take.recording_timebase, activeSegments: [] } }, reason: 'recording_timebase_segments_missing' },
  ])('fails closed on invalid saved $field metadata at the adapter boundary', ({ patch, reason }) => {
    expect(createShareVideoSessionFromSavedTake(
      { ...take, ...patch },
      new Blob(['video'], { type: 'video/webm' }),
      { sourceId: take.source_id, artifact: artifact }
    )).toEqual({ status: 'unsupported', reason });
  });

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
        segments: [{ startBeat: 1, bpm: 96, source: 'MUSICXML' }],
      })
    ).toThrow(/beat_zero/);
    expect(() =>
      parseSavedRecordingTimebase({
        ...recordingTimebase,
        nominalMediaDurationMs: 5000,
        activeSegments: [
          { perfStartMs: 0, perfEndMs: 2000, mediaStartMs: 0, mediaEndMs: 2000 },
          { perfStartMs: 3000, perfEndMs: 5000, mediaStartMs: 2500, mediaEndMs: 5000 },
        ],
      })
    ).toThrow(/media_segments_not_continuous/);
    expect(parseSavedRecordingTimebase(recordingTimebase)).toEqual(recordingTimebase);
  });

  it('requires the persisted range identity to agree with the saved range start', () => {
    expect(
      createShareVideoSessionFromSavedTake(
        {
          ...take,
          scope_type: 'RANGE',
          scope_start_beat: 4,
          scope_start_group_id: 'group-1',
          scope_end_group_id: 'group-2',
        },
        new Blob(['video'], { type: 'video/webm' }),
        { sourceId: take.source_id, artifact: artifact }
      )
    ).toMatchObject({ status: 'unsupported', reason: 'scope_identity_mismatch' });
  });

  it('does not claim the database duration is the decoded media duration', () => {
    const result = createShareVideoSessionFromSavedTake(
      take,
      new Blob(['video'], { type: 'video/webm' }),
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
      createShareVideoSessionFromSavedTake(
        { ...take, scope_type: 'RANGE' },
      new Blob(['video'], { type: 'video/webm' }),
      { sourceId: take.source_id, artifact: artifact }
      )
    ).toMatchObject({ status: 'unsupported', reason: 'scope_identity_missing' });
  });

  it('does not require scope identity for FULL takes', () => {
    const result = createShareVideoSessionFromSavedTake(
      { ...take, scope_type: 'FULL' },
      new Blob(['video'], { type: 'video/webm' }),
      { sourceId: take.source_id, artifact: artifact }
    );
    expect(result.status).toBe('supported');
  });

  it('resolves and validates exact scope identity for RANGE takes', () => {
    const result = createShareVideoSessionFromSavedTake(
      {
        ...take,
        scope_type: 'RANGE',
        scope_start_group_id: 'group-1',
        scope_end_group_id: 'group-2',
      },
      new Blob(['video'], { type: 'video/webm' }),
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
    const result = createShareVideoSessionFromSavedTake(
      {
        ...take,
        scope_type: 'RANGE',
        scope_start_group_id: 'group-1',
        scope_end_group_id: 'missing-group',
      },
      new Blob(['video'], { type: 'video/webm' }),
      { sourceId: take.source_id, artifact: artifact }
    );
    expect(result).toMatchObject({
      status: 'unsupported',
      reason: 'scope_identity_invalid',
    });
  });
});


it('uses validated durable scope beats and tempo without replacing saved values', () => {
  const persisted = { ...take, scope_terminal_beat: take.scope_terminal_beat - 0.0000001 };
  const result = createShareVideoSessionFromSavedTake(persisted, new Blob(['video']), { sourceId: take.source_id, artifact });
  expect(result.status).toBe('supported');
  if (result.status === 'supported') {
    expect(result.session.scope.terminalBeat).toBe(persisted.scope_terminal_beat);
    expect(result.session.tempoPlan).toEqual(take.tempo_plan);
  }
});
