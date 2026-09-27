import type { PerformanceTakeRead } from '@/lib/api/performance-takes';

import type {
  PerformanceReviewDraft,
  PerformanceReviewDraftVideoReady,
  RecordingTimebaseMapping,
} from './performance-review-draft';
import type {
  ResolvedPracticeScope,
  PracticeTempoSegmentSource,
  ResolvedPracticeTempoPlan,
} from './local-core';

export type ShareVideoSession = {
  sourceId: string;
  scoreIdentity: {
    scoreId: string;
    revisionId: string;
    artifactId: string;
  };
  video: PerformanceReviewDraftVideoReady;
  scope: Pick<ResolvedPracticeScope, 'startBeat' | 'terminalBeat'>;
  tempoPlan: ResolvedPracticeTempoPlan;
  recordingTimebase: RecordingTimebaseMapping;
  replayTiming?: {
    scopeStartBeat: number;
    scopeStartMs: number;
    nominalDurationMs: number;
  };
};

export type ShareVideoSessionInput = ShareVideoSession | PerformanceReviewDraft;

export function createShareVideoSessionFromReviewDraft(
  draft: PerformanceReviewDraft
): ShareVideoSession {
  if (draft.video?.status !== 'READY') {
    throw new Error('Share video requires a ready video recording.');
  }
  if (!draft.revisionId || !draft.artifactId) {
    throw new Error('Share video requires a stable score revision and artifact identity.');
  }
  return {
    sourceId: draft.localSessionId,
    scoreIdentity: {
      scoreId: draft.scoreId,
      revisionId: draft.revisionId,
      artifactId: draft.artifactId,
    },
    video: draft.video,
    scope: {
      startBeat: draft.scope.startBeat,
      terminalBeat: draft.scope.terminalBeat,
    },
    tempoPlan: draft.tempoPlan,
    recordingTimebase: draft.recordingTimebase,
    replayTiming: draft.replayTiming,
  };
}

export function isShareVideoSession(
  value: ShareVideoSessionInput
): value is ShareVideoSession {
  return 'sourceId' in value && 'scoreIdentity' in value;
}

export function toShareVideoSession(
  value: ShareVideoSessionInput
): ShareVideoSession {
  return isShareVideoSession(value)
    ? value
    : createShareVideoSessionFromReviewDraft(value);
}

type ParsedRecordingTimebase = RecordingTimebaseMapping;

export type SavedTakeEligibility =
  | { status: 'supported'; session: ShareVideoSession }
  | { status: 'unsupported'; reason: string }
  | { status: 'temporarily_unavailable'; reason: string };

export function hasSavedTakeShareVideoMetadata(take: PerformanceTakeRead): boolean {
  if (
    take.deletion_status === 'DELETING' ||
    take.media_kind !== 'VIDEO' ||
    !take.score_id ||
    !take.revision_id ||
    !take.artifact_id
  ) {
    return false;
  }
  try {
    parseSavedTempoPlan(take.resolved_tempo_plan);
    parseSavedSyncMetadata(take.sync_metadata);
    requireFiniteNonNegative(take.scope_start_beat, 'scope_start_beat');
    requireFinitePositive(take.scope_terminal_beat, 'scope_terminal_beat');
    return true;
  } catch {
    return false;
  }
}

export function createShareVideoSessionFromSavedTake(
  take: PerformanceTakeRead,
  videoBlob: Blob
): SavedTakeEligibility {
  if (take.deletion_status === 'DELETING') {
    return { status: 'unsupported', reason: 'take_deleting' };
  }
  if (take.media_kind !== 'VIDEO') {
    return { status: 'unsupported', reason: 'video_required' };
  }
  if (!videoBlob.size) {
    return { status: 'temporarily_unavailable', reason: 'empty_media' };
  }
  if (!take.score_id || !take.revision_id || !take.artifact_id) {
    return { status: 'unsupported', reason: 'score_revision_artifact_missing' };
  }

  try {
    const tempoPlan = parseSavedTempoPlan(take.resolved_tempo_plan);
    const syncMetadata = parseSavedSyncMetadata(take.sync_metadata);
    return {
      status: 'supported',
      session: {
        sourceId: take.take_id,
        scoreIdentity: {
          scoreId: take.score_id,
          revisionId: take.revision_id,
          artifactId: take.artifact_id,
        },
        video: {
          status: 'READY',
          blob: videoBlob,
          mimeType: take.media_mime_type,
          durationMs: take.duration_ms,
          actualMediaDurationMs: take.duration_ms,
        },
        scope: {
          startBeat: requireFiniteNonNegative(take.scope_start_beat, 'scope_start_beat'),
          terminalBeat: requireFinitePositive(take.scope_terminal_beat, 'scope_terminal_beat'),
        },
        tempoPlan,
        recordingTimebase: syncMetadata.recordingTimebase,
        replayTiming: syncMetadata.replayTiming,
      },
    };
  } catch (error) {
    return {
      status: 'unsupported',
      reason: error instanceof Error ? error.message : 'sync_metadata_invalid',
    };
  }
}

export function parseSavedTempoPlan(
  raw: Record<string, unknown> | null | undefined
): ResolvedPracticeTempoPlan {
  if (!raw || typeof raw !== 'object') {
    throw new Error('resolved_tempo_plan_missing');
  }
  const selection = raw.selection;
  if (!selection || typeof selection !== 'object') {
    throw new Error('resolved_tempo_plan_selection_missing');
  }
  const mode = (selection as Record<string, unknown>).mode;
  if (mode !== 'SCORE' && mode !== 'CUSTOM_FIXED_BPM') {
    throw new Error('resolved_tempo_plan_selection_invalid');
  }
  const rawSegments = raw.segments;
  if (!Array.isArray(rawSegments) || rawSegments.length === 0) {
    throw new Error('resolved_tempo_plan_segments_missing');
  }
  const segments = rawSegments.map((segment, index) => {
    if (!segment || typeof segment !== 'object') {
      throw new Error(`resolved_tempo_plan_segment_${index}_invalid`);
    }
    const candidate = segment as Record<string, unknown>;
    const startBeat = requireFiniteNonNegative(candidate.startBeat, `tempo_segment_${index}_startBeat`);
    const bpm = requireFinitePositive(candidate.bpm, `tempo_segment_${index}_bpm`);
    const source = candidate.source;
    if (source !== 'MUSICXML' && source !== 'PRODUCT_DEFAULT' && source !== 'CUSTOM') {
      throw new Error(`tempo_segment_${index}_source_invalid`);
    }
    return { startBeat, bpm, source: source as PracticeTempoSegmentSource };
  });
  if (segments[0].startBeat !== 0) {
    throw new Error('resolved_tempo_plan_must_start_at_beat_zero');
  }
  for (let index = 1; index < segments.length; index += 1) {
    if (segments[index].startBeat <= segments[index - 1].startBeat) {
      throw new Error('resolved_tempo_plan_segments_not_sorted');
    }
  }
  return {
    selection: mode === 'SCORE'
      ? { mode: 'SCORE' }
      : { mode: 'CUSTOM_FIXED_BPM', bpm: requireFinitePositive((selection as Record<string, unknown>).bpm, 'tempo_selection_bpm') },
    segments,
  };
}

export function parseSavedSyncMetadata(
  raw: Record<string, unknown> | null | undefined
): {
  recordingTimebase: ParsedRecordingTimebase;
  replayTiming: ShareVideoSession['replayTiming'];
} {
  if (!raw || typeof raw !== 'object') {
    throw new Error('sync_metadata_missing');
  }
  const recordingTimebase = parseRecordingTimebase(raw.recordingTimebase);
  const replayTiming = parseReplayTiming(raw.replayTiming);
  return { recordingTimebase, replayTiming };
}

function parseRecordingTimebase(raw: unknown): ParsedRecordingTimebase {
  if (!raw || typeof raw !== 'object') {
    throw new Error('recording_timebase_missing');
  }
  const value = raw as Record<string, unknown>;
  const activeSegments = value.activeSegments;
  if (!Array.isArray(activeSegments) || activeSegments.length === 0) {
    throw new Error('recording_timebase_segments_missing');
  }
  const parsed = activeSegments.map((segment, index) => {
    if (!segment || typeof segment !== 'object') {
      throw new Error(`recording_timebase_segment_${index}_invalid`);
    }
    const candidate = segment as Record<string, unknown>;
    return {
      perfStartMs: requireFiniteNonNegative(candidate.perfStartMs, `timebase_${index}_perfStartMs`),
      perfEndMs: requireFinitePositive(candidate.perfEndMs, `timebase_${index}_perfEndMs`),
      mediaStartMs: requireFiniteNonNegative(candidate.mediaStartMs, `timebase_${index}_mediaStartMs`),
      mediaEndMs: requireFinitePositive(candidate.mediaEndMs, `timebase_${index}_mediaEndMs`),
    };
  });
  for (const segment of parsed) {
    if (segment.perfEndMs <= segment.perfStartMs || segment.mediaEndMs <= segment.mediaStartMs) {
      throw new Error('recording_timebase_segment_order_invalid');
    }
  }
  for (let index = 1; index < parsed.length; index += 1) {
    if (
      parsed[index].perfStartMs < parsed[index - 1].perfEndMs ||
      parsed[index].mediaStartMs < parsed[index - 1].mediaEndMs
    ) {
      throw new Error('recording_timebase_segments_overlap');
    }
  }
  return {
    recordingStartPerfTimeMs: requireFiniteNonNegative(value.recordingStartPerfTimeMs, 'recordingStartPerfTimeMs'),
    recordingEndPerfTimeMs: requireFinitePositive(value.recordingEndPerfTimeMs, 'recordingEndPerfTimeMs'),
    nominalMediaDurationMs: requireFinitePositive(value.nominalMediaDurationMs, 'nominalMediaDurationMs'),
    activeSegments: parsed,
  };
}

function parseReplayTiming(raw: unknown): ShareVideoSession['replayTiming'] {
  if (raw === undefined || raw === null) {
    return undefined;
  }
  if (typeof raw !== 'object') {
    throw new Error('replay_timing_invalid');
  }
  const value = raw as Record<string, unknown>;
  return {
    scopeStartBeat: requireFiniteNonNegative(value.scopeStartBeat, 'replay_scopeStartBeat'),
    scopeStartMs: requireFiniteNonNegative(value.scopeStartMs, 'replay_scopeStartMs'),
    nominalDurationMs: requireFinitePositive(value.nominalDurationMs, 'replay_nominalDurationMs'),
  };
}

function requireFiniteNonNegative(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${field}_invalid`);
  }
  return value;
}

function requireFinitePositive(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${field}_invalid`);
  }
  return value;
}
