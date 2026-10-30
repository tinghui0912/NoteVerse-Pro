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
  schemaVersion: 2 as const,
  scoreId: 'score-1',
  revisionId: 'revision-1',
  artifactId: 'artifact-1',
  playableEvents: [0, 1].map(i => ({ eventId: `event-${i + 1}`, onsetBeat: i * 4, durationBeats: 4, pianoKeys: [60], renderNoteIds: [`note-${i + 1}`], measureNumbers: [String(i + 1)], staffIds: [], voiceIds: [], tieTypes: [], playable: true, entryCandidate: true })),
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
      eventIds: ['event-1'],
      expectedNotes: [{ expectedNoteId: 'expected-1', eventId: 'event-1', pianoKey: 60, renderNoteId: 'note-1', measureNumbers: ['1'] }],
      strikeTargets: [{ strikeId: 'strike-1', pianoKey: 60, expectedNotes: [{ expectedNoteId: 'expected-1', eventId: 'event-1', pianoKey: 60, renderNoteId: 'note-1', measureNumbers: ['1'] }], eventIds: ['event-1'], renderNoteIds: ['note-1'], measureNumbers: ['1'] }],
      renderNoteIds: ['note-1'],
      pianoKeys: [60],
      measureNumbers: ['1'],
      staffIds: [],
      voiceIds: [],
      canonicalEndBeat: 4,
    },
    {
      groupId: 'group-2',
      onsetBeat: 4,
      eventIds: ['event-2'],
      expectedNotes: [{ expectedNoteId: 'expected-2', eventId: 'event-2', pianoKey: 60, renderNoteId: 'note-2', measureNumbers: ['2'] }],
      strikeTargets: [{ strikeId: 'strike-2', pianoKey: 60, expectedNotes: [{ expectedNoteId: 'expected-2', eventId: 'event-2', pianoKey: 60, renderNoteId: 'note-2', measureNumbers: ['2'] }], eventIds: ['event-2'], renderNoteIds: ['note-2'], measureNumbers: ['2'] }],
      renderNoteIds: ['note-2'],
      pianoKeys: [60],
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
      eventIds: ['event-1'],
      attackTargets: [{ attackId: 'attack-1', pianoKey: 60, notes: [{ stepNoteId: 'step-note-1', eventId: 'event-1', pianoKey: 60, renderNoteId: 'note-1', measureNumbers: ['1'], staffIds: [], voiceIds: [] }], eventIds: ['event-1'], renderNoteIds: ['note-1'], measureNumbers: ['1'] }],
      continuation: [],
      renderNoteIds: ['note-1'],
      measureNumbers: ['1'],
      staffIds: [],
      voiceIds: [],
    },
    {
      stepId: 'step-2',
      onsetBeat: 4,
      eventIds: ['event-2'],
      attackTargets: [{ attackId: 'attack-2', pianoKey: 60, notes: [{ stepNoteId: 'step-note-2', eventId: 'event-2', pianoKey: 60, renderNoteId: 'note-2', measureNumbers: ['2'], staffIds: [], voiceIds: [] }], eventIds: ['event-2'], renderNoteIds: ['note-2'], measureNumbers: ['2'] }],
      continuation: [],
      renderNoteIds: ['note-2'],
      measureNumbers: ['2'],
      staffIds: [],
      voiceIds: [],
    },
  ],
};
