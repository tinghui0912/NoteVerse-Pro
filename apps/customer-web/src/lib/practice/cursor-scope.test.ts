import { describe, expect, it } from 'vitest';

import {
  PRACTICE_SCORE_ARTIFACT_SCHEMA_VERSION,
  resolvePracticeScopeCursorNoteIds,
  type PracticeScoreArtifact,
} from './local-core/artifact';
import { PracticeVerovioAdapter } from './verovio-adapter';
import { resolveShareVideoPlaybackPosition } from './share-video-playback-position';
import type { ShareVideoSession } from './share-video-session';

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
    playableEvents: [],
    expectedPracticeGroups: groups.map((group) => ({
      ...group,
      eventIds: [group.groupId],
      expectedNotes: [],
      strikeTargets: [
        {
          strikeId: group.groupId,
          pitch: group.groupId,
          expectedNotes: [],
          eventIds: [group.groupId],
          renderNoteIds: group.renderNoteIds,
          measureNumbers: ['1'],
        },
      ],
      pitches: [group.groupId],
      measureNumbers: ['1'],
      staffIds: ['staff-1'],
      voiceIds: ['voice-1'],
    })),
    practiceAttackSteps: groups.map((group) => ({
      stepId: group.groupId,
      onsetBeat: group.onsetBeat,
      eventIds: [group.groupId],
      attackTargets: [
        {
          attackId: group.groupId,
          pitch: group.groupId,
          notes: [],
          eventIds: [group.groupId],
          renderNoteIds: group.renderNoteIds,
          measureNumbers: ['1'],
        },
      ],
      continuation: [],
      renderNoteIds: group.renderNoteIds,
      measureNumbers: ['1'],
      staffIds: ['staff-1'],
      voiceIds: ['voice-1'],
    })),
    meterSegments: [],
    scoreTempoSegments: [{ startBeat: 0, bpm: 60 }],
    firstPlayableBeat: 2,
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
