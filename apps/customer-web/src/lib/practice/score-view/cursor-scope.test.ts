import { describe, expect, it } from 'vitest';

import { PRACTICE_SCORE_ARTIFACT_SCHEMA_VERSION, type PracticeScoreArtifact } from '@/lib/practice/kernel/artifact';
import { resolvePracticeScopeCursorNoteIds } from '@/lib/practice/score-view/cursor-scope';
import { resolveShareVideoPlaybackPosition } from '@/lib/practice/sharing/video/playback-position';
import type { ShareVideoSession } from '@/lib/practice/sharing/video/session';
import { PracticeVerovioAdapter } from './verovio-adapter';

function artifact(): PracticeScoreArtifact {
  const groups = [
    { groupId: 'A', onsetBeat: 2, canonicalEndBeat: 4.5, renderNoteIds: ['nA'] },
    { groupId: 'B', onsetBeat: 3, canonicalEndBeat: 4.5, renderNoteIds: ['nB'] },
    { groupId: 'C', onsetBeat: 4, canonicalEndBeat: 4.25, renderNoteIds: ['nC'] },
  ];
  return {
    schemaVersion: PRACTICE_SCORE_ARTIFACT_SCHEMA_VERSION,
    scoreId: 'score',
    revisionId: 'revision',
    artifactId: 'artifact',
    notes: groups.map(g => ({ noteId: g.groupId, eventId: g.groupId, pianoKey: 60, renderNoteId: g.renderNoteIds[0], measureNumber: '1', staffId: '1', voiceId: '1', tieTypes: [] })),
    events: groups.map(g => ({ eventId: g.groupId, onsetBeat: g.onsetBeat, durationBeats: g.canonicalEndBeat - g.onsetBeat })),
    moments: groups.map(g => ({ groupId: g.groupId, onsetBeat: g.onsetBeat, canonicalEndBeat: g.canonicalEndBeat, attacks: [{ attackId: g.groupId, pianoKey: 60, noteIds: [g.groupId] }], continuationNoteIds: [] })),
    meterSegments: [],
    scoreTempoSegments: [{ startBeat: 0, bpm: 60 }],

    scoreEndBeat: 4.5,
  };
}

function adapter() {
  const instance = new PracticeVerovioAdapter();
  (instance as unknown as {
    visualTimeline: Array<{ index: number; beat: number; endBeat: number; noteIds: string[] }>;
  }).visualTimeline = [
      { index: 0, beat: 2, endBeat: 4.5, noteIds: ['nA'] },
      { index: 1, beat: 3, endBeat: 4.5, noteIds: ['nB'] },
      { index: 2, beat: 4, endBeat: 4.25, noteIds: ['nC'] },
    ];
  return instance;
}

function session(allowedNoteIds: string[]): ShareVideoSession {
  return {
    sourceId: 'session',
    scoreIdentity: { scoreId: 'score', revisionId: 'revision', artifactId: 'artifact' },
    video: {
      status: 'READY',
      kind: 'VIDEO',
      blob: new Blob(['video'], { type: 'video/webm' }),
      mimeType: 'video/webm',
      durationMs: 2500,
    },
    scope: {
      startBeat: 2,
      terminalBeat: 4.5,
      kind: 'RANGE',
      allowedNoteIds,
    },
    tempoPlan: {
      selection: { mode: 'CUSTOM_FIXED_BPM', bpm: 60 },
      segments: [{ startBeat: 0, bpm: 60, source: 'CUSTOM' }],
    },
    recordingTimebase: {
      nominalMediaDurationMs: 2500,
      activeSegments: [{ perfStartMs: 0, perfEndMs: 2500, mediaStartMs: 0, mediaEndMs: 2500 }],
    },
  };
}

describe('cursor selection scope', () => {
  it('keeps a long final sustain on its selected group instead of later attacks', () => {
    const scoreAdapter = adapter();
    for (const beat of [2, 3, 4, 4.49]) {
      const entry = scoreAdapter.getCursorTimelineEntryForBeatRange(
        beat,
        2,
        4.5,
        ['nA']
      );
      expect(entry?.noteIds).toEqual(['nA']);
    }
  });

  it('allows A to B range but not later C during the terminal tail', () => {
    const entry = adapter().getCursorTimelineEntryForBeatRange(4.49, 2, 4.5, ['nA', 'nB']);
    expect(entry?.noteIds).toEqual(['nB']);
  });

  it('preserves full-piece behavior when no cursor selection is supplied', () => {
    const entry = adapter().getCursorTimelineEntryForBeatRange(4, 2, 4.5);
    expect(entry?.noteIds).toEqual(['nC']);
  });

  it('derives legal cursor note ids from exact artifact group indices', () => {
    expect(
      resolvePracticeScopeCursorNoteIds(artifact(), {
        kind: 'RANGE',
        startIndex: 0,
        endIndex: 1,
        startBeat: 2,
        terminalBeat: 4.5,
        startGroupId: 'A',
        endGroupId: 'B',
      })
    ).toEqual(['nA', 'nB']);
  });

  it('share frame resolution uses the cursor selection scope in terminal tail', () => {
    const frame = resolveShareVideoPlaybackPosition({
      session: session(['nA']),
      adapter: {
        getCursorTimelineEntryForBeatRange: adapter().getCursorTimelineEntryForBeatRange.bind(adapter()),
        getPageWithElement: () => 1,
      },
      mediaTimeMs: 2000,
      actualMediaDurationMs: 2500,
      scoreEndBeat: 4.5,
    });
    expect(frame?.noteIds).toEqual(['nA']);
  });
});
