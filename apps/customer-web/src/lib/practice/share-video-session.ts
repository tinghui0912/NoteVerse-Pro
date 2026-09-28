import type { PerformanceTakeRead } from '@/lib/api/performance-takes';

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
import { cursorScopeFromResolvedPracticeScope, type CursorScope } from './cursor-scope';

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
    take.media_kind !== 'VIDEO' ||
    !take.score_id ||
    !take.revision_id ||
    !take.artifact_id
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
    parseSavedTempoPlan(take.resolved_tempo_plan);
    const syncMetadata = parseSavedSyncMetadata(take.sync_metadata);
    if (
      take.scope_type === 'RANGE' &&
      !syncMetadata.scopeIdentity
    ) {
      return false;
    }
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
  if (!take.score_id || !take.revision_id || !take.artifact_id) {
    return { status: 'unsupported', reason: 'score_revision_artifact_missing' };
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
    const tempoPlan = parseSavedTempoPlan(take.resolved_tempo_plan);
    const syncMetadata = parseSavedSyncMetadata(take.sync_metadata);
    const isRange = take.scope_type === 'RANGE';
    if (isRange && !syncMetadata.scopeIdentity) {
      return { status: 'unsupported', reason: 'scope_identity_missing' };
    }
    const startGroup = artifact.expectedPracticeGroups.find(
      (group) => group.groupId === syncMetadata.scopeIdentity?.startGroupId
    );
    const endGroup = artifact.expectedPracticeGroups.find(
      (group) => group.groupId === syncMetadata.scopeIdentity?.endGroupId
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
          startGroupId: syncMetadata.scopeIdentity?.startGroupId ?? '',
          endGroupId: syncMetadata.scopeIdentity?.endGroupId ?? '',
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
        recordingTimebase: syncMetadata.recordingTimebase,
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
  scopeIdentity?: { startGroupId: string; endGroupId: string };
} {
  if (!raw || typeof raw !== 'object') {
    throw new Error('sync_metadata_missing');
  }
  const recordingTimebase = parseRecordingTimebase(raw.recordingTimebase);
  const rawIdentity = raw.scopeIdentity;
  const scopeIdentity =
    rawIdentity && typeof rawIdentity === 'object'
      ? {
          startGroupId: String((rawIdentity as Record<string, unknown>).startGroupId ?? ''),
          endGroupId: String((rawIdentity as Record<string, unknown>).endGroupId ?? ''),
        }
      : undefined;
  if (
    scopeIdentity &&
    (!scopeIdentity.startGroupId || !scopeIdentity.endGroupId)
  ) {
    throw new Error('scope_identity_invalid');
  }
  return { recordingTimebase, scopeIdentity };
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
  const recordingStartPerfTimeMs = requireFiniteNonNegative(
    value.recordingStartPerfTimeMs,
    'recordingStartPerfTimeMs'
  );
  const recordingEndPerfTimeMs = requireFinitePositive(
    value.recordingEndPerfTimeMs,
    'recordingEndPerfTimeMs'
  );
  const nominalMediaDurationMs = requireFinitePositive(
    value.nominalMediaDurationMs,
    'nominalMediaDurationMs'
  );
  if (recordingEndPerfTimeMs <= recordingStartPerfTimeMs) {
    throw new Error('recording_timebase_range_invalid');
  }
  if (
    parsed[0].perfStartMs < recordingStartPerfTimeMs ||
    parsed[parsed.length - 1].perfEndMs > recordingEndPerfTimeMs
  ) {
    throw new Error('recording_timebase_segment_outside_recording_range');
  }
  if (parsed[parsed.length - 1].mediaEndMs > nominalMediaDurationMs) {
    throw new Error('recording_timebase_media_outside_nominal_duration');
  }
  return {
    recordingStartPerfTimeMs,
    recordingEndPerfTimeMs,
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
