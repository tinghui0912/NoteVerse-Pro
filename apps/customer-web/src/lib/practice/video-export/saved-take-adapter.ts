import { scoreTick } from '@/lib/practice/kernel/score-time';
import type {
  PerformanceTakeRead,
  RecordingTimebase,
  PerformanceTakeTempoPlan,
} from '@/lib/api/performance-takes';

import { assertRecordingTimebase, type RecordingTimebaseMapping } from '@/lib/practice/recording/recording-timebase';
import type { PracticeScoreArtifact } from '@/lib/practice/kernel/artifact';
import type { PracticeTempoSegmentSource, ResolvedPracticeTempoPlan } from '@/lib/practice/kernel/tempo';
import type { VideoExportSession } from './session';
import type { ResolvedPracticeScope } from '@/lib/practice/kernel/scope';
import { resolvePracticeScope } from '@/lib/practice/kernel/scope';
import { resolvePracticeScopeCursorNoteIds } from '@/lib/practice/score-view/cursor-scope';
import { cursorScopeFromResolvedPracticeScope, type CursorScope } from '@/lib/practice/score-view/cursor-scope';

type ParsedRecordingTimebase = RecordingTimebaseMapping;

export type SavedTakeEligibility =
  | { status: 'supported'; session: VideoExportSession }
  | { status: 'unsupported'; reason: string }
  | { status: 'temporarily_unavailable'; reason: string };

export function hasSavedTakeVideoExportMetadata(take: PerformanceTakeRead): boolean {
  if (
    take.deletion_status === 'DELETING' ||
    take.media_kind !== 'VIDEO'
  ) {
    return false;
  }
  try {
    const scopeStartTick = scoreTick(
      take.scope_start_tick);
    const scopeTerminalTick = requireFinitePositive(
      take.scope_terminal_tick,
      'scope_terminal_tick'
    );
    if (scopeTerminalTick <= scopeStartTick) {
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

export function createVideoExportSessionFromSavedTake(
  take: PerformanceTakeRead,
  videoBlob: Blob,
  source: { sourceId: string; artifact: PracticeScoreArtifact }
): SavedTakeEligibility {
  const { artifact } = source;
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
    !take.source_id || source.sourceId !== take.source_id || artifact.scoreId !== take.source_score_id ||
    artifact.revisionId !== take.source_revision_id ||
    artifact.artifactId !== take.source_artifact_id
  ) {
    return { status: 'unsupported', reason: 'artifact_identity_mismatch' };
  }

  try {
    const scopeStartTick = scoreTick(
      take.scope_start_tick);
    const scopeTerminalTick = requireFinitePositive(
      take.scope_terminal_tick,
      'scope_terminal_tick'
    );
    if (scopeTerminalTick <= scopeStartTick) {
      throw new Error('scope_terminal_tick_invalid');
    }
    const tempoPlan = parseSavedTempoPlan(take.tempo_plan);
    const recordingTimebase = parseSavedRecordingTimebase(take.recording_timebase);
    const isRange = take.scope_type === 'RANGE';
    let resolvedPracticeScope: ResolvedPracticeScope;
    if (isRange) {
      const scopeStartGroupId = take.scope_start_group_id;
      const scopeEndGroupId = take.scope_end_group_id;
      if (!scopeStartGroupId || !scopeEndGroupId) {
        return { status: 'unsupported', reason: 'scope_identity_missing' };
      }
      const startGroup = artifact.moments.find(
        (group) => group.groupId === scopeStartGroupId
      );
      const endGroup = artifact.moments.find(
        (group) => group.groupId === scopeEndGroupId
      );
      if (!startGroup || !endGroup) {
        return { status: 'unsupported', reason: 'scope_identity_invalid' };
      }
      if (
        startGroup.onsetTick !== scopeStartTick ||
        endGroup.canonicalEndTick !== scopeTerminalTick
      ) {
        return { status: 'unsupported', reason: 'scope_identity_mismatch' };
      }
      resolvedPracticeScope = resolvePracticeScope(artifact, {
        kind: 'RANGE',
        startGroupId: scopeStartGroupId,
        endGroupId: scopeEndGroupId,
      });
    } else {
      resolvedPracticeScope = resolvePracticeScope(artifact, { kind: 'FULL' });
    }
    // The Source validates group identity; persisted Take ticks remain the saved truth.
    if (resolvedPracticeScope.startTick !== scopeStartTick ||
        resolvedPracticeScope.terminalTick !== scopeTerminalTick) {
      return { status: 'unsupported', reason: 'scope_identity_mismatch' };
    }
    resolvedPracticeScope = { ...resolvedPracticeScope, startTick: scopeStartTick, terminalTick: scopeTerminalTick };
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
        sessionId: take.take_id,
        sourceId: take.source_id,
        scoreIdentity: {
          scoreId: take.source_score_id,
          revisionId: take.source_revision_id,
          artifactId: take.source_artifact_id,
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
    const startTick = scoreTick(segment.startTick);
    const bpm = requireFinitePositive(segment.bpm, `tempo_segment_${index}_bpm`);
    const source = segment.source;
    if (source !== 'MUSICXML' && source !== 'PRODUCT_DEFAULT' && source !== 'CUSTOM') {
      throw new Error(`tempo_segment_${index}_source_invalid`);
    }
    return { startTick, bpm, source: source as PracticeTempoSegmentSource };
  });
  if (segments[0].startTick !== 0) {
    throw new Error('tempo_plan_must_start_at_tick_zero');
  }
  for (let index = 1; index < segments.length; index += 1) {
    if (segments[index].startTick <= segments[index - 1].startTick) {
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
  const nominalMediaDurationMs = requireFinitePositive(
    raw.nominalMediaDurationMs,
    'nominalMediaDurationMs'
  );
  assertRecordingTimebase({ nominalMediaDurationMs, activeSegments: parsed });
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
