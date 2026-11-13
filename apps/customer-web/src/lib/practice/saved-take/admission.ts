import type {
  PerformanceTakeRead,
  PerformanceTakeTempoPlan,
} from '@/lib/api/performance-takes';
import type { PracticePlanBundle } from '@/lib/practice/planning/practice-plan';
import type { ExecutedPerformance } from '@/lib/practice/run/executed-performance';
import {
  recordedPerformance,
  type RecordedPerformance,
} from '@/lib/practice/recording/recorded-performance';
import type { LocalMediaAsset } from '@/lib/practice/media/local-media-asset';
import { decodeRecordingTimebase } from '@/lib/practice/recording/recording-timebase';
import { normalizeRecordingMime } from '@/lib/practice/recording/media-admission';
import { scoreTick, ticksPerQuarter } from '@/lib/practice/score/score-time';
import { resolvePracticeScope } from '@/lib/practice/planning/scope';
import type {
  PracticeTempoSegmentSource,
  ResolvedPracticeTempoPlan,
} from '@/lib/practice/planning/tempo';

export type SavedTakeAdmission =
  | { status: 'supported'; recordedPerformance: RecordedPerformance }
  | { status: 'unsupported' | 'temporarily_unavailable'; reason: string };

/** Display eligibility only; semantic admission happens once after all owners are available. */
export function isSavedCompositeVideoCandidate(
  take: PerformanceTakeRead,
): boolean {
  return ['AUDIO', 'VIDEO'].includes(take.manifest.capture.kind);
}
export function admitSavedRecordedPerformance(
  take: PerformanceTakeRead,
  bundle: PracticePlanBundle,
  media: LocalMediaAsset,
): SavedTakeAdmission {
  try {
    const { manifest, recording_media: recordingMedia } = take;
    const { artifact, binding } = bundle;
    const saved = manifest.practice_binding;
    if (
      !saved.bundle_id ||
      binding.bundleId !== saved.bundle_id ||
      binding.scoreId !== saved.score_id ||
      binding.revisionId !== saved.revision_id ||
      artifact.artifactId !== manifest.artifact_id
    )
      throw new Error('artifact_identity_mismatch');
    if (
      ticksPerQuarter(manifest.score_timebase.ticks_per_quarter) !==
      artifact.ticksPerQuarter
    )
      throw new Error('score_timebase_mismatch');
    if (!['FULL', 'RANGE'].includes(manifest.scope.kind))
      throw new Error('scope_kind_invalid');
    exactFields(
      manifest.scope,
      manifest.scope.kind === 'FULL'
        ? ['kind', 'start_tick', 'terminal_tick']
        : [
            'kind',
            'start_tick',
            'terminal_tick',
            'start_group_id',
            'end_group_id',
          ],
    );
    const startTick = scoreTick(manifest.scope.start_tick),
      terminalTick = scoreTick(manifest.scope.terminal_tick);
    const scope = resolvePracticeScope(
      artifact,
      manifest.scope.kind === 'RANGE'
        ? {
            kind: 'RANGE',
            startGroupId: manifest.scope.start_group_id,
            endGroupId: manifest.scope.end_group_id,
          }
        : { kind: 'FULL' },
    );
    if (
      terminalTick <= startTick ||
      scope.startTick !== startTick ||
      scope.terminalTick !== terminalTick
    )
      throw new Error('scope_identity_mismatch');
    const tempoPlan = parseSavedTempoPlan(manifest.tempo_plan);
    if (
      tempoPlan.segments.some(
        (segment) => segment.startTick > artifact.scoreEndTick,
      )
    )
      throw new Error('tempo_extent_invalid');
    const timebase = decodeRecordingTimebase(manifest.recording_timebase);
    const capture = manifest.capture;
    if (
      capture.mime_type !== normalizeRecordingMime(capture.mime_type) ||
      recordingMedia.mime_type !== capture.mime_type ||
      recordingMedia.byte_size !== capture.byte_size ||
      media.byteSize !== recordingMedia.byte_size
    )
      throw new Error('capture_recording_mismatch');
    const executed: ExecutedPerformance = Object.freeze({
      bundle: Object.freeze({ binding, artifact }),
      scope: Object.freeze(scope),
      tempoPlan,
    });
    return {
      status: 'supported',
      recordedPerformance: recordedPerformance(
        executed,
        Object.freeze({
          status: 'READY',
          kind: capture.kind,
          mimeType: capture.mime_type,
          media,
          timebase,
        }),
      ),
    };
  } catch (error) {
    return {
      status: 'unsupported',
      reason:
        error instanceof Error ? error.message : 'saved_performance_invalid',
    };
  }
}
function parseSavedTempoPlan(
  raw: PerformanceTakeTempoPlan | null | undefined,
): ResolvedPracticeTempoPlan {
  if (!raw) {
    throw new Error('tempo_plan_missing');
  }
  exactFields(raw, ['selection', 'segments']);
  const selection = raw.selection;
  if (!selection) {
    throw new Error('tempo_plan_selection_missing');
  }
  const mode = selection.mode;
  if (mode !== 'SCORE' && mode !== 'CUSTOM_FIXED_BPM') {
    throw new Error('tempo_plan_selection_invalid');
  }
  exactFields(selection, mode === 'SCORE' ? ['mode'] : ['mode', 'bpm']);
  const rawSegments = raw.segments;
  if (!Array.isArray(rawSegments) || rawSegments.length === 0) {
    throw new Error('tempo_plan_segments_missing');
  }
  const segments = rawSegments.map((segment, index) => {
    exactFields(segment, ['startTick', 'bpm', 'source']);
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
  if (mode === 'CUSTOM_FIXED_BPM') {
    if (
      segments.length !== 1 ||
      segments[0].source !== 'CUSTOM' ||
      segments[0].bpm !== selection.bpm
    )
      throw new Error('custom_tempo_mismatch');
  } else if (segments.some((segment) => segment.source === 'CUSTOM'))
    throw new Error('score_tempo_source_invalid');
  return Object.freeze({
    selection: Object.freeze(
      mode === 'SCORE'
        ? { mode: 'SCORE' as const }
        : {
            mode: 'CUSTOM_FIXED_BPM' as const,
            bpm: requireFinitePositive(
              selection.bpm,
              'tempo_plan_selection_bpm',
            ),
          },
    ),
    segments: Object.freeze(segments.map((segment) => Object.freeze(segment))),
  });
}

function requireFinitePositive(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${field}_invalid`);
  }
  return value;
}

function exactFields(value: object, fields: string[]): void {
  if (Object.keys(value).sort().join() !== fields.sort().join())
    throw new Error('saved_fields_invalid');
}
