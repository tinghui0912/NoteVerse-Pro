import type { PracticeScoreArtifact } from "@/lib/practice/score/artifact";
import type {
  PerformanceTakeRead,
  RecordingTimebase,
  PerformanceTakeTempoPlan,
} from "@/lib/api/performance-takes";
const tempoPlan: PerformanceTakeTempoPlan = {
  selection: { mode: "SCORE" },
  segments: [{ startTick: 0, bpm: 96, source: "MUSICXML" }],
};
const recordingTimebase: RecordingTimebase = {
  nominalMediaDurationUs: 4000000,
  activeSegments: [
    {
      performanceStartUs: 0,
      performanceEndUs: 4000000,
      mediaStartUs: 0,
      mediaEndUs: 4000000,
    },
  ],
};
export const take: PerformanceTakeRead = {
  archive_media: { mime_type: "video/webm", byte_size: 10 },
  take_id: "take-1",
  deletion_status: "ACTIVE",
  created_at: "2026-09-26T00:00:00.000Z",
  manifest: {
    artifact_id: "practice-score-artifact:7cfc80643d19fef4",
    score_title_snapshot: "Etude",
    score_timebase: { ticks_per_quarter: 1 },
    tempo_plan: tempoPlan,
    recording_timebase: recordingTimebase,
    practice_binding: {
      bundle_id: "source-1",
      score_id: "score-1",
      revision_id: "revision-1",
    },
    capture: {
      kind: "VIDEO",
      mime_type: "video/webm",
      byte_size: 10,
    },
    scope: {
      kind: "FULL",
      start_tick: 0,
      terminal_tick: 16,
    },
  },
};
export const artifact: PracticeScoreArtifact = {
  schemaVersion: 1,
  ticksPerQuarter: 1,
  artifactId: "practice-score-artifact:7cfc80643d19fef4",
  notes: [0, 1].map((i) => ({
    noteId: `note-${i + 1}`,
    eventId: `event-${i + 1}`,
    pianoKey: 60,
    renderNoteId: `note-${i + 1}`,
    measureNumber: String(i + 1),
    staffId: "",
    voiceId: "",
    tieTypes: [],
  })),
  events: [0, 1].map((i) => ({
    eventId: `event-${i + 1}`,
    onsetTick: i * 4,
    durationTicks: i ? 12 : 4,
  })),
  moments: [0, 1].map((i) => ({
    groupId: `group-${i + 1}`,
    onsetTick: i * 4,
    canonicalEndTick: i ? 16 : 4,
    attacks: [
      { attackId: `strike-${i + 1}`, pianoKey: 60, noteIds: [`note-${i + 1}`] },
    ],
    continuationNoteIds: [],
  })),
  scoreTempoSegments: [{ startTick: 0, bpm: 96 }],
  meterSegments: [{ startTick: 0, numerator: 4, denominator: 4 }],
  scoreEndTick: 16,
};
