import type { PracticeScoreArtifact } from '@/lib/practice/kernel/artifact';
import type { PerformanceTakeRead, RecordingTimebase, PerformanceTakeTempoPlan } from '@/lib/api/performance-takes';
export const tempoPlan: PerformanceTakeTempoPlan = {
  selection: { mode: 'SCORE' },
  segments: [{ startBeat: 0, bpm: 96, source: 'MUSICXML' }],
};

export const recordingTimebase: RecordingTimebase = {
  nominalMediaDurationMs: 4000,
  activeSegments: [
    { perfStartMs: 0, perfEndMs: 4000, mediaStartMs: 0, mediaEndMs: 4000 },
  ],
};

export const take: PerformanceTakeRead = {
  take_id: 'take-1',
  source_score_id: 'score-1',
  source_revision_id: 'revision-1',
  source_artifact_id: 'artifact-1',
  score_title_snapshot: 'Etude',
  media_kind: 'VIDEO',
  media_mime_type: 'video/webm',
  media_byte_size: 10,
  duration_ms: 4000,
  scope_type: 'FULL',
  scope_start_beat: 0,
  scope_terminal_beat: 16,
  deletion_status: 'ACTIVE',
  tempo_plan: tempoPlan,
  recording_timebase: recordingTimebase,
  created_at: '2026-09-26T00:00:00.000Z',
};

export const artifact: PracticeScoreArtifact = {
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
    source: 'MUSICXML',
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
