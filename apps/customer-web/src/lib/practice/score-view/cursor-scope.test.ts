import { PRACTICE_SCORE_ARTIFACT_SCHEMA_VERSION } from '@/lib/practice/contracts/generated/score-artifact';
import { describe, expect, it } from 'vitest';

import { type PracticeScoreArtifact } from '@/lib/practice/score/artifact';
import { resolvePracticeScopeCursorNoteIds } from '@/lib/practice/score-view/cursor-scope';
import { resolveVideoExportPlaybackPosition } from '@/lib/practice/video-export/playback-position';
import { recordedPerformanceFixture } from '@/lib/practice/__fixtures__/recorded-performance';
import { continuousPracticePlan } from '@/lib/practice/__fixtures__/practice-plan';
import { PracticeVerovioAdapter } from './verovio-adapter';

function artifact(): PracticeScoreArtifact {
  const groups = [
    {
      groupId: 'A',
      onsetTick: 200,
      canonicalEndTick: 450,
      renderNoteIds: ['nA'],
    },
    {
      groupId: 'B',
      onsetTick: 300,
      canonicalEndTick: 450,
      renderNoteIds: ['nB'],
    },
    {
      groupId: 'C',
      onsetTick: 400,
      canonicalEndTick: 425,
      renderNoteIds: ['nC'],
    },
  ];
  return {
    schemaVersion: PRACTICE_SCORE_ARTIFACT_SCHEMA_VERSION,
    ticksPerQuarter: 100,

    artifactId: 'artifact',
    notes: groups.map((g) => ({
      noteId: g.groupId,
      eventId: g.groupId,
      pianoKey: 60,
      renderNoteId: g.renderNoteIds[0],
      measureNumber: '1',
      staffId: '1',
      voiceId: '1',
      tieTypes: [],
    })),
    events: groups.map((g) => ({
      eventId: g.groupId,
      onsetTick: g.onsetTick,
      durationTicks: g.canonicalEndTick - g.onsetTick,
    })),
    moments: groups.map((g) => ({
      groupId: g.groupId,
      onsetTick: g.onsetTick,
      canonicalEndTick: g.canonicalEndTick,
      attacks: [{ attackId: g.groupId, pianoKey: 60, noteIds: [g.groupId] }],
      continuationNoteIds: [],
    })),
    meterSegments: [{ startTick: 0, numerator: 4, denominator: 4 }],
    scoreTempoSegments: [{ startTick: 0, bpm: 60 }],

    scoreEndTick: 450,
  };
}

function adapter() {
  const instance = new PracticeVerovioAdapter(artifact());
  (
    instance as unknown as {
      visualTimeline: Array<{
        index: number;
        tick: number;
        endTick: number;
        noteIds: string[];
      }>;
    }
  ).visualTimeline = [
    { index: 0, tick: 200, endTick: 450, noteIds: ['nA'] },
    { index: 1, tick: 300, endTick: 450, noteIds: ['nB'] },
    { index: 2, tick: 400, endTick: 425, noteIds: ['nC'] },
  ];
  return instance;
}

function performance() {
  const plan = continuousPracticePlan(artifact(), {
    scope: { kind: 'RANGE', startGroupId: 'A', endGroupId: 'A' },
    tempoSelection: { mode: 'CUSTOM_FIXED_BPM', bpm: 60 },
  });
  return recordedPerformanceFixture(plan, {
    ...recordedPerformanceFixture().recording,
    timebase: {
      nominalMediaDurationUs: 2500000,
      activeSegments: [
        {
          performanceStartUs: 0,
          performanceEndUs: 2500000,
          mediaStartUs: 0,
          mediaEndUs: 2500000,
        },
      ],
    },
  });
}

describe('cursor selection scope', () => {
  it('keeps a long final sustain on its selected group instead of later attacks', () => {
    const scoreAdapter = adapter();
    for (const tick of [200, 300, 400, 449]) {
      const entry = scoreAdapter.getCursorTimelineEntryForTickRange(
        tick,
        200,
        450,
        ['nA'],
      );
      expect(entry?.noteIds).toEqual(['nA']);
    }
  });

  it('allows A to B range but not later C during the terminal tail', () => {
    const entry = adapter().getCursorTimelineEntryForTickRange(449, 200, 450, [
      'nA',
      'nB',
    ]);
    expect(entry?.noteIds).toEqual(['nB']);
  });

  it('preserves full-piece behavior when no cursor selection is supplied', () => {
    const entry = adapter().getCursorTimelineEntryForTickRange(400, 200, 450);
    expect(entry?.noteIds).toEqual(['nC']);
  });

  it('derives legal cursor note ids from exact artifact group indices', () => {
    expect(
      resolvePracticeScopeCursorNoteIds(artifact(), {
        kind: 'RANGE',
        startIndex: 0,
        endIndex: 1,
        startTick: 200,
        terminalTick: 450,
        startGroupId: 'A',
        endGroupId: 'B',
      }),
    ).toEqual(['nA', 'nB']);
  });

  it('video export frame resolution uses the cursor selection scope in terminal tail', () => {
    const frame = resolveVideoExportPlaybackPosition({
      recordedPerformance: performance(),
      adapter: {
        getCursorTimelineEntryForTickRange:
          adapter().getCursorTimelineEntryForTickRange.bind(adapter()),
        getPageWithElement: () => 1,
      },
      mediaTimeMs: 2000,
      actualMediaDurationMs: 2500,
    });
    expect(frame?.noteIds).toEqual(['nA']);
  });
});
