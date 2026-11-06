import type { PracticeBundleBinding } from '@/lib/practice/bundle/admitted-practice-bundle';
import type { LocalMediaAsset } from '@/lib/practice/media/local-media-asset';
import { scoreTick, ticksPerQuarter } from '@/lib/practice/score/score-time';
import type {
  PerformanceTakeRead,
  PerformanceTakeTempoPlan,
} from '@/lib/api/performance-takes';

import { decodeRecordingTimebase } from '@/lib/practice/recording/recording-timebase';
import type { PracticeScoreArtifact } from '@/lib/practice/score/artifact';
import type {
  PracticeTempoSegmentSource,
  ResolvedPracticeTempoPlan,
} from '@/lib/practice/planning/tempo';
import type { VideoExportSession } from './session';
import type { ResolvedPracticeScope } from '@/lib/practice/planning/scope';
import { resolvePracticeScope } from '@/lib/practice/planning/scope';
import { resolvePracticeScopeCursorNoteIds } from '@/lib/practice/score-view/cursor-scope';
import {
  cursorScopeFromResolvedPracticeScope,
  type CursorScope,
} from '@/lib/practice/score-view/cursor-scope';

export type SavedTakeEligibility =
  | { status: 'supported'; session: VideoExportSession }
  | { status: 'unsupported'; reason: string }
  | { status: 'temporarily_unavailable'; reason: string };

export function hasSavedTakeVideoExportMetadata(
  take: PerformanceTakeRead,
): boolean {
  if (take.deletion_status === 'DELETING' || take.media_kind !== 'VIDEO') {
    return false;
  }
  try {
    ticksPerQuarter(take.score_timebase?.ticks_per_quarter);
    const scopeStartTick = scoreTick(take.scope_start_tick);
    const scopeTerminalTick = scoreTick(take.scope_terminal_tick);
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
    decodeRecordingTimebase(take.recording_timebase);
    return true;
  } catch {
    return false;
  }
}

export function createVideoExportSessionFromSavedTake(
  take: PerformanceTakeRead,
  media: LocalMediaAsset,
  bundle: { binding: PracticeBundleBinding; artifact: PracticeScoreArtifact },
): SavedTakeEligibility {
  const { artifact } = bundle;
  if (take.deletion_status === 'DELETING') {
    return { status: 'unsupported', reason: 'take_deleting' };
  }
  if (take.media_kind !== 'VIDEO') {
    return { status: 'unsupported', reason: 'video_required' };
  }
  if (!media.byteSize) {
    return { status: 'temporarily_unavailable', reason: 'empty_media' };
  }
  if (
    !take.bundle_id ||
    bundle.binding.bundleId !== take.bundle_id ||
    bundle.binding.scoreId !== take.score_id ||
    bundle.binding.revisionId !== take.revision_id ||
    artifact.artifactId !== take.artifact_id
  ) {
    return { status: 'unsupported', reason: 'artifact_identity_mismatch' };
  }

  try {
    if (
      ticksPerQuarter(take.score_timebase?.ticks_per_quarter) !==
      artifact.ticksPerQuarter
    ) {
      return { status: 'unsupported', reason: 'score_timebase_mismatch' };
    }
  } catch {
    return { status: 'unsupported', reason: 'score_timebase_mismatch' };
  }

  try {
    const scopeStartTick = scoreTick(take.scope_start_tick);
    const scopeTerminalTick = scoreTick(take.scope_terminal_tick);
    if (scopeTerminalTick <= scopeStartTick) {
      throw new Error('scope_terminal_tick_invalid');
    }
    const tempoPlan = parseSavedTempoPlan(take.tempo_plan);
    const recordingTimebase = decodeRecordingTimebase(take.recording_timebase);
    const isRange = take.scope_type === 'RANGE';
    let resolvedPracticeScope: ResolvedPracticeScope;
    if (isRange) {
      const scopeStartGroupId = take.scope_start_group_id;
      const scopeEndGroupId = take.scope_end_group_id;
      if (!scopeStartGroupId || !scopeEndGroupId) {
        return { status: 'unsupported', reason: 'scope_identity_missing' };
      }
      const startGroup = artifact.moments.find(
        (group) => group.groupId === scopeStartGroupId,
      );
      const endGroup = artifact.moments.find(
        (group) => group.groupId === scopeEndGroupId,
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
    // The reauthorized Bundle artifact validates group identity; persisted Take ticks remain the saved truth.
    if (
      resolvedPracticeScope.startTick !== scopeStartTick ||
      resolvedPracticeScope.terminalTick !== scopeTerminalTick
    ) {
      return { status: 'unsupported', reason: 'scope_identity_mismatch' };
    }
    resolvedPracticeScope = {
      ...resolvedPracticeScope,
      startTick: scopeStartTick,
      terminalTick: scopeTerminalTick,
    };
    const resolvedScope = resolvePracticeScopeCursorNoteIds(
      artifact,
      resolvedPracticeScope,
    );
    const scope: CursorScope = isRange
      ? cursorScopeFromResolvedPracticeScope(
          resolvedPracticeScope,
          resolvedScope,
        )
      : cursorScopeFromResolvedPracticeScope(resolvedPracticeScope);
    return {
      status: 'supported',
      session: {
        sessionId: take.take_id,
        bundleId: take.bundle_id,
        scoreIdentity: {
          scoreId: take.score_id,
          revisionId: take.revision_id,
          artifactId: take.artifact_id,
        },
        video: {
          status: 'READY',
          kind: 'VIDEO',
          media,
          mimeType: take.media_mime_type,
        },
        scope,
        tempoPlan,
        recordingTimebase,
      },
    };
  } catch (error) {
    return {
      status: 'unsupported',
      reason:
        error instanceof Error ? error.message : 'recording_timebase_invalid',
    };
  }
}

export function parseSavedTempoPlan(
  raw: PerformanceTakeTempoPlan | null | undefined,
): ResolvedPracticeTempoPlan {
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
    const bpm = requireFinitePositive(
      segment.bpm,
      `tempo_segment_${index}_bpm`,
    );
    const source = segment.source;
    if (
      source !== 'MUSICXML' &&
      source !== 'PRODUCT_DEFAULT' &&
      source !== 'CUSTOM'
    ) {
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
    selection:
      mode === 'SCORE'
        ? { mode: 'SCORE' }
        : {
            mode: 'CUSTOM_FIXED_BPM',
            bpm: requireFinitePositive(
              selection.bpm,
              'tempo_plan_selection_bpm',
            ),
          },
    segments,
  };
}

function requireFinitePositive(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${field}_invalid`);
  }
  return value;
}
