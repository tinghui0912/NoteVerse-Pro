import type { RecordingTimebase as RecordingTimebaseValue } from '@/lib/practice/recording/recording-timebase';
import type { RecordedPerformance } from '@/lib/practice/recording/recorded-performance';
import type { ResolvedPracticeTempoPlan } from '@/lib/practice/planning/tempo';
import { normalizeRecordingMime } from '@/lib/practice/recording/media-admission';
import type {
  RecordingTimebase,
  PerformanceTakeManifestRead,
  PerformanceTakeRead,
  PerformanceTakeTempoPlan,
  PerformanceTakeUploadReservationRequest,
} from '@/lib/api/performance-takes';
export type SavePerformanceTakeInput = Readonly<{
  clientRequestId: string;
  recordedPerformance: RecordedPerformance;
}>;
export function performanceTakeUploadRequest(
  input: SavePerformanceTakeInput,
): PerformanceTakeUploadReservationRequest {
  const { executed, recording } = input.recordedPerformance;
  const { binding } = executed.bundle;
  return {
    client_request_id: input.clientRequestId,
    practice_binding: {
      score_id: binding.scoreId,
      revision_id: binding.revisionId,
      bundle_id: binding.bundleId,
    },
    media: {
      kind: recording.kind,
      byte_size: recording.media.byteSize,
      mime_type: normalizeRecordingMime(recording.mimeType),
    },
    scope:
      executed.scope.kind === 'RANGE'
        ? {
            kind: 'RANGE',
            start_group_id: executed.scope.startGroupId,
            end_group_id: executed.scope.endGroupId,
          }
        : { kind: 'FULL' },
    tempo_selection: executed.tempoPlan.selection,
    recording_timebase: {
      nominalMediaDurationUs: recording.timebase.nominalMediaDurationUs,
      activeSegments: recording.timebase.activeSegments.map((segment) => ({
        ...segment,
      })),
    },
  };
}
function tempoMatchesExecution(
  actual: PerformanceTakeTempoPlan | undefined,
  expected: ResolvedPracticeTempoPlan,
): boolean {
  if (!actual?.selection || !Array.isArray(actual.segments)) return false;
  if (actual.selection.mode !== expected.selection.mode) return false;
  if (
    expected.selection.mode === 'CUSTOM_FIXED_BPM' &&
    (actual.selection.mode !== 'CUSTOM_FIXED_BPM' ||
      actual.selection.bpm !== expected.selection.bpm)
  )
    return false;
  return (
    actual.segments.length === expected.segments.length &&
    actual.segments.every((segment, index) => {
      const executed = expected.segments[index];
      return (
        segment?.startTick === executed.startTick &&
        segment.bpm === executed.bpm &&
        segment.source === executed.source
      );
    })
  );
}

export function takeManifestAgreesWithRecordedPerformance(
  manifest: PerformanceTakeManifestRead | undefined,
  performance: RecordedPerformance,
): boolean {
  const { executed, recording } = performance;
  const { binding, artifact } = executed.bundle;
  const scope = manifest?.scope;
  return Boolean(
    manifest &&
      scope &&
      manifest.artifact_id === artifact.artifactId &&
      scoreTimebaseMatchesExecution(
        manifest.score_timebase?.ticks_per_quarter,
        artifact.ticksPerQuarter,
      ) &&
      manifest.practice_binding?.bundle_id === binding.bundleId &&
      manifest.practice_binding.score_id === binding.scoreId &&
      manifest.practice_binding.revision_id === binding.revisionId &&
      manifest.capture?.kind === recording.kind &&
      manifest.capture.byte_size === recording.media.byteSize &&
      manifest.capture.mime_type === normalizeRecordingMime(recording.mimeType) &&
      recordingTimebaseMatchesExecution(
        manifest.recording_timebase,
        recording.timebase,
      ) &&
      scope.kind === executed.scope.kind &&
      scope.start_tick === executed.scope.startTick &&
      scope.terminal_tick === executed.scope.terminalTick &&
      (executed.scope.kind !== 'RANGE' ||
        (scope.kind === 'RANGE' &&
          scope.start_group_id === executed.scope.startGroupId &&
          scope.end_group_id === executed.scope.endGroupId)) &&
      tempoMatchesExecution(manifest.tempo_plan, executed.tempoPlan),
  );
}

function scoreTimebaseMatchesExecution(
  actual: number | undefined,
  expected: number,
): boolean {
  return Number.isSafeInteger(expected) && expected > 0 && actual === expected;
}

function recordingTimebaseMatchesExecution(
  actual: RecordingTimebase | undefined,
  expected: RecordingTimebaseValue,
): boolean {
  return Boolean(
    actual &&
      actual.nominalMediaDurationUs === expected.nominalMediaDurationUs &&
      Array.isArray(actual.activeSegments) &&
      actual.activeSegments.length === expected.activeSegments.length &&
      actual.activeSegments.every((segment, index) => {
        const executed = expected.activeSegments[index];
        return (
          segment.performanceStartUs === executed.performanceStartUs &&
          segment.performanceEndUs === executed.performanceEndUs &&
          segment.mediaStartUs === executed.mediaStartUs &&
          segment.mediaEndUs === executed.mediaEndUs
        );
      }),
  );
}

export function performanceTakeAgreesWithRecordedPerformance(
  take: PerformanceTakeRead,
  performance: RecordedPerformance,
): boolean {
  return (
    takeManifestAgreesWithRecordedPerformance(take.manifest, performance) &&
    take.recording_media?.mime_type === take.manifest.capture.mime_type &&
    take.recording_media.byte_size === take.manifest.capture.byte_size
  );
}
