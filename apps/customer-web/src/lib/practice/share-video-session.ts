import type {
  PerformanceTakeRead,
  RecordingTimebase,
  PerformanceTakeTempoPlan,
} from '@/lib/api/performance-takes';

import type {
  CompletedPerformance,
  PerformanceMediaReady,
  RecordingTimebaseMapping,
} from './completed-performance';
import type {
  PracticeScoreArtifact,
  PracticeTempoSegmentSource,
  ResolvedPracticeTempoPlan,
} from './local-core';
import {
  resolvePracticeScope,
  resolvePracticeScopeCursorNoteIds,
} from './local-core/artifact';
import { cursorScopeFromResolvedPracticeScope, type CursorScope } from './local-core/cursor-scope';

export type ShareVideoSession = {
  sourceId: string;
  scoreIdentity: {
    scoreId: string;
    revisionId: string;
    artifactId: string;
  };
  video: PerformanceMediaReady & { kind: 'VIDEO' };
  scope: CursorScope;
  tempoPlan: ResolvedPracticeTempoPlan;
  recordingTimebase: RecordingTimebaseMapping;
};

export function createShareVideoSessionFromCompletedPerformance(
  draft: CompletedPerformance,
  artifact: PracticeScoreArtifact
): ShareVideoSession {
  const media = draft.media;
  if (media.status !== 'READY' || media.kind !== 'VIDEO') {
    throw new Error('Share video requires a ready video recording.');
  }
  if (
    artifact.scoreId !== draft.scoreId ||
    artifact.revisionId !== draft.revisionId ||
    artifact.artifactId !== draft.artifactId
  ) {
    throw new Error('Share video score artifact identity mismatch.');
  }
  const scope = cursorScopeFromResolvedPracticeScope(
    draft.scope,
    resolvePracticeScopeCursorNoteIds(artifact, draft.scope)
  );
  return {
    sourceId: draft.localSessionId,
    scoreIdentity: {
      scoreId: draft.scoreId,
      revisionId: draft.revisionId,
      artifactId: draft.artifactId,
    },
    video: media,
    scope,
    tempoPlan: draft.tempoPlan,
    recordingTimebase: draft.recordingTimebase,
  };
}

type ParsedRecordingTimebase = RecordingTimebaseMapping;

export type SavedTakeEligibility =
  | { status: 'supported'; session: ShareVideoSession }
  | { status: 'unsupported'; reason: string }
  | { status: 'temporarily_unavailable'; reason: string };

export function hasSavedTakeShareVideoMetadata(take: PerformanceTakeRead): boolean {
  if (
    take.deletion_status === 'DELETING' ||
    take.media_kind !== 'VIDEO'
  ) {
    return false;
  }
  try {
    const scopeStartBeat = requireFiniteNonNegative(
      take.scope_start_beat,
      'scope_start_beat'
    );
    const scopeTerminalBeat = requireFinitePositive(
      take.scope_terminal_beat,
      'scope_terminal_beat'
    );
    if (scopeTerminalBeat <= scopeStartBeat) {
      return false;
    }
    parseSavedTempoPlan(take.tempo_plan);
    if (
      take.scope_type === 'RANGE' &&
      (!take.scope_start_group_id || !take.scope_end_group_id)
    ) {
      return false;
    }
    parseSavedRecordingTimebase(take.recording_timebase);
    return true;
  } catch {
    return false;
  }
}

export function createShareVideoSessionFromSavedTake(
  take: PerformanceTakeRead,
  videoBlob: Blob,
  artifact: PracticeScoreArtifact
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
  if (
    artifact.scoreId !== take.score_id ||
    artifact.revisionId !== take.revision_id ||
    artifact.artifactId !== take.artifact_id
  ) {
    return { status: 'unsupported', reason: 'artifact_identity_mismatch' };
  }

  try {
    const scopeStartBeat = requireFiniteNonNegative(
      take.scope_start_beat,
      'scope_start_beat'
    );
    const scopeTerminalBeat = requireFinitePositive(
      take.scope_terminal_beat,
      'scope_terminal_beat'
    );
    if (scopeTerminalBeat <= scopeStartBeat) {
      throw new Error('scope_terminal_beat_invalid');
    }
    const tempoPlan = parseSavedTempoPlan(take.tempo_plan);
    const recordingTimebase = parseSavedRecordingTimebase(take.recording_timebase);
    const isRange = take.scope_type === 'RANGE';
    if (isRange && (!take.scope_start_group_id || !take.scope_end_group_id)) {
      return { status: 'unsupported', reason: 'scope_identity_missing' };
    }
    const startGroup = artifact.expectedPracticeGroups.find(
      (group) => group.groupId === take.scope_start_group_id
    );
    const endGroup = artifact.expectedPracticeGroups.find(
      (group) => group.groupId === take.scope_end_group_id
    );
    if (isRange && (!startGroup || !endGroup)) {
      return { status: 'unsupported', reason: 'scope_identity_invalid' };
    }
    if (
      isRange &&
      (!startGroup ||
        !endGroup ||
        Math.abs(startGroup.onsetBeat - scopeStartBeat) > 1e-6 ||
        Math.abs(endGroup.canonicalEndBeat - scopeTerminalBeat) > 1e-6)
    ) {
      return { status: 'unsupported', reason: 'scope_identity_mismatch' };
    }
    const resolvedPracticeScope = isRange
      ? resolvePracticeScope(artifact, {
          kind: 'RANGE',
          startGroupId: take.scope_start_group_id ?? '',
          endGroupId: take.scope_end_group_id ?? '',
        })
      : resolvePracticeScope(artifact, { kind: 'FULL' });
    const resolvedScope = resolvePracticeScopeCursorNoteIds(
      artifact,
      resolvedPracticeScope
    );
    const scope: CursorScope = isRange
      ? cursorScopeFromResolvedPracticeScope(resolvedPracticeScope, resolvedScope)
      : cursorScopeFromResolvedPracticeScope(resolvedPracticeScope);
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
          kind: 'VIDEO',
          blob: videoBlob,
          mimeType: take.media_mime_type,
          durationMs: take.duration_ms,
        },
        scope,
        tempoPlan,
        recordingTimebase,
      },
    };
  } catch (error) {
    return {
      status: 'unsupported',
      reason: error instanceof Error ? error.message : 'recording_timebase_invalid',
    };
  }
}

export function parseSavedTempoPlan(raw: PerformanceTakeTempoPlan | null | undefined): ResolvedPracticeTempoPlan {
  if (!raw) {
    throw new Error('tempo_plan_missing');
  }
  const selection = raw.selection;
  if (!selection) {
    throw new Error('tempo_plan_selection_missing');
  }
  const mode = selection.mode;
  if (mode !== 'SCORE' && mode !== 'CUSTOM_FIXED_BPM') {
    throw new Error('tempo_plan_selection_invalid');
  }
  const rawSegments = raw.segments;
  if (!Array.isArray(rawSegments) || rawSegments.length === 0) {
    throw new Error('tempo_plan_segments_missing');
  }
  const segments = rawSegments.map((segment, index) => {
    const startBeat = requireFiniteNonNegative(segment.startBeat, `tempo_segment_${index}_startBeat`);
    const bpm = requireFinitePositive(segment.bpm, `tempo_segment_${index}_bpm`);
    const source = segment.source;
    if (source !== 'MUSICXML' && source !== 'PRODUCT_DEFAULT' && source !== 'CUSTOM') {
      throw new Error(`tempo_segment_${index}_source_invalid`);
    }
    return { startBeat, bpm, source: source as PracticeTempoSegmentSource };
  });
  if (segments[0].startBeat !== 0) {
    throw new Error('tempo_plan_must_start_at_beat_zero');
  }
  for (let index = 1; index < segments.length; index += 1) {
    if (segments[index].startBeat <= segments[index - 1].startBeat) {
      throw new Error('tempo_plan_segments_not_sorted');
    }
  }
  return {
    selection: mode === 'SCORE'
      ? { mode: 'SCORE' }
      : { mode: 'CUSTOM_FIXED_BPM', bpm: requireFinitePositive(selection.bpm, 'tempo_plan_selection_bpm') },
    segments,
  };
}

export function parseSavedRecordingTimebase(
  raw: RecordingTimebase | null | undefined
): ParsedRecordingTimebase {
  if (!raw) {
    throw new Error('recording_timebase_missing');
  }
  return parseRecordingTimebase(raw);
}

function parseRecordingTimebase(raw: RecordingTimebase): ParsedRecordingTimebase {
  if (!raw) {
    throw new Error('recording_timebase_missing');
  }
  const activeSegments = raw.activeSegments;
  if (!Array.isArray(activeSegments) || activeSegments.length === 0) {
    throw new Error('recording_timebase_segments_missing');
  }
  const parsed = activeSegments.map((segment, index) => {
    return {
      perfStartMs: requireFiniteNonNegative(segment.perfStartMs, `timebase_${index}_perfStartMs`),
      perfEndMs: requireFinitePositive(segment.perfEndMs, `timebase_${index}_perfEndMs`),
      mediaStartMs: requireFiniteNonNegative(segment.mediaStartMs, `timebase_${index}_mediaStartMs`),
      mediaEndMs: requireFinitePositive(segment.mediaEndMs, `timebase_${index}_mediaEndMs`),
    };
  });
  for (const segment of parsed) {
    if (segment.perfEndMs <= segment.perfStartMs || segment.mediaEndMs <= segment.mediaStartMs) {
      throw new Error('recording_timebase_segment_order_invalid');
    }
  }
  for (let index = 1; index < parsed.length; index += 1) {
    if (parsed[index].perfStartMs < parsed[index - 1].perfEndMs) {
      throw new Error('recording_timebase_segments_overlap');
    }
    if (Math.abs(parsed[index].mediaStartMs - parsed[index - 1].mediaEndMs) > 1) {
      throw new Error('recording_timebase_media_segments_not_continuous');
    }
  }
  const nominalMediaDurationMs = requireFinitePositive(
    raw.nominalMediaDurationMs,
    'nominalMediaDurationMs'
  );
  if (parsed[0].mediaStartMs !== 0) {
    throw new Error('recording_timebase_first_media_segment_invalid');
  }
  if (Math.abs(parsed[parsed.length - 1].mediaEndMs - nominalMediaDurationMs) > 1) {
    throw new Error('recording_timebase_nominal_duration_mismatch');
  }
  return {
    nominalMediaDurationMs,
    activeSegments: parsed,
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
