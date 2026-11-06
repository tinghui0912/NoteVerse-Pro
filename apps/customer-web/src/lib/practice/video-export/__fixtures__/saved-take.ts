import type { PracticeScoreArtifact } from '@/lib/practice/score/artifact';
import type { PerformanceTakeRead, RecordingTimebase, PerformanceTakeTempoPlan } from '@/lib/api/performance-takes';
export const tempoPlan: PerformanceTakeTempoPlan = {
  selection: { mode: 'SCORE' },
  segments: [{ startTick: 0, bpm: 96, source: 'MUSICXML' }],
};

export const recordingTimebase: RecordingTimebase = {
  nominalMediaDurationUs: 4000000,
  activeSegments: [
    { performanceStartUs: 0, performanceEndUs: 4000000, mediaStartUs: 0, mediaEndUs: 4000000 },
  ],
};

export const take: PerformanceTakeRead = {score_timebase: { ticks_per_quarter: 1 },
  take_id: 'take-1',
  bundle_id: 'source-1',
  score_id: 'score-1',
  revision_id: 'revision-1',
  artifact_id: 'artifact-1',
  score_title_snapshot: 'Etude',
  media_kind: 'VIDEO',
  media_mime_type: 'video/webm',
  media_byte_size: 10,

  scope_type: 'FULL',
  scope_start_tick: 0,
  scope_terminal_tick: 16,
  deletion_status: 'ACTIVE',
  tempo_plan: tempoPlan,
  recording_timebase: recordingTimebase,
  created_at: '2026-09-26T00:00:00.000Z',
};

export const artifact: PracticeScoreArtifact = {
  schemaVersion: 1, ticksPerQuarter: 1,   artifactId: 'artifact-1',
  notes: [0,1].map(i => ({ noteId: `note-${i + 1}`, eventId: `event-${i + 1}`, pianoKey: 60,
    renderNoteId: `note-${i + 1}`, measureNumber: String(i + 1), staffId: '', voiceId: '', tieTypes: [] })),
  events: [0,1].map(i => ({ eventId: `event-${i + 1}`, onsetTick: i * 4, durationTicks: i ? 12 : 4 })),
  moments: [0,1].map(i => ({ groupId: `group-${i + 1}`, onsetTick: i * 4, canonicalEndTick: i ? 16 : 4,
    attacks: [{ attackId: `strike-${i + 1}`, pianoKey: 60, noteIds: [`note-${i + 1}`] }], continuationNoteIds: [] })),
  scoreTempoSegments: [{ startTick: 0, bpm: 96 }],
  meterSegments: [{ startTick: 0, numerator: 4, denominator: 4,   }],
   scoreEndTick: 16,
};
