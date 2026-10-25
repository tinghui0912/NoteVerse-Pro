import type { ResolvedPracticeScope } from '@/lib/practice/kernel/scope';
import type { ResolvedPracticeTempoPlan } from '@/lib/practice/kernel/tempo';
import { immutableContinuousValue, type CompletedContinuousEvaluation } from '@/lib/practice/continuous/domain/evaluation/types';

interface PerformanceMediaReadyBase {
  status: 'READY';
  blob: Blob;
  mimeType: string;
  durationMs: number;
  actualMediaDurationMs?: number;
}

export type PerformanceMediaReady =
  | (PerformanceMediaReadyBase & { kind: 'AUDIO' })
  | (PerformanceMediaReadyBase & { kind: 'VIDEO' });

interface PerformanceMediaUnavailable {
  status: 'UNAVAILABLE';
  reason: string;
}

interface PerformanceMediaNotRecorded {
  status: 'NOT_RECORDED';
}

export type PerformanceMedia =
  | PerformanceMediaReady
  | PerformanceMediaNotRecorded
  | PerformanceMediaUnavailable;

interface RecordingActiveSegment {
  perfStartMs: number;
  perfEndMs: number;
  mediaStartMs: number;
  mediaEndMs: number;
}

export interface RecordingTimebaseMapping {
  activeSegments: RecordingActiveSegment[];
  nominalMediaDurationMs: number;
}

/**
 * Maps audio media playback time (ms) to practice performanceTimeMs (ms).
 * Takes into account recording start offset, pause/resume intervals, and actual media duration scaling.
 * Returns null if synchronization cannot be reliably determined (allowing explicit degradation).
 */
export function mediaTimeToPerformanceTimeMs(
  mediaTimeMs: number,
  timebase?: RecordingTimebaseMapping | null,
  actualMediaDurationMs?: number | null
): number | null {
  if (!timebase || timebase.activeSegments.length === 0) {
    return null;
  }

  const { activeSegments, nominalMediaDurationMs } = timebase;

  let scaledMediaTimeMs = mediaTimeMs;
  if (
    actualMediaDurationMs &&
    actualMediaDurationMs > 0 &&
    nominalMediaDurationMs > 0
  ) {
    scaledMediaTimeMs = (mediaTimeMs / actualMediaDurationMs) * nominalMediaDurationMs;
  }

  const firstSeg = activeSegments[0];
  const lastSeg = activeSegments[activeSegments.length - 1];

  if (scaledMediaTimeMs <= firstSeg.mediaStartMs) {
    return firstSeg.perfStartMs;
  }
  if (scaledMediaTimeMs >= lastSeg.mediaEndMs) {
    return lastSeg.perfEndMs;
  }

  for (let i = 0; i < activeSegments.length; i++) {
    const seg = activeSegments[i];
    if (scaledMediaTimeMs >= seg.mediaStartMs && scaledMediaTimeMs <= seg.mediaEndMs) {
      const offsetInSeg = scaledMediaTimeMs - seg.mediaStartMs;
      return seg.perfStartMs + offsetInSeg;
    }
  }

  return null;
}

export interface CompletedPerformance {
  localSessionId: string;
  scoreId: string;
  revisionId: string;
  artifactId: string;
  scope: ResolvedPracticeScope;
  tempoPlan: ResolvedPracticeTempoPlan;
  inputSource: 'MICROPHONE' | 'MIDI';
  activeElapsedMs: number;
  evaluation: CompletedContinuousEvaluation;
  media: PerformanceMedia;
  recordingTimebase: RecordingTimebaseMapping;
  completedAt: string;
}

function assertCompletedPerformance(performance: CompletedPerformance): void {
  if (performance.evaluation.status === 'UNAVAILABLE') {
    return;
  }
  const isArray = (value: unknown): boolean => Array.isArray(value);
  if (!isArray(performance.evaluation.groups) || !isArray(performance.evaluation.extras)) {
    throw new Error('CompletedPerformance evaluation is corrupt.');
  }
  for (const group of performance.evaluation.groups) {
    if (!['CORRECT', 'MISSING', 'WRONG', 'INCOMPLETE_CHORD', 'NOT_REACHED'].includes(group.verdict)
      || !group.finality) throw new Error('CompletedPerformance group must be final.');
    for (const strike of group.strikes) {
      if (!Array.isArray(strike.renderNoteIds)) {
        throw new Error('CompletedPerformance strike renderNoteIds are required.');
      }
      if (!['MATCHED', 'MISSING', 'NOT_REACHED'].includes(strike.state)) throw new Error('CompletedPerformance strike must be final.');
      if (strike.state === 'MATCHED') {
        if (
          !strike.match?.observation.observationId ||
          !Number.isFinite(strike.match.observation.confidence) ||
          !Number.isFinite(strike.match.timingOffsetMs)
        ) {
          throw new Error('CompletedPerformance matched strike metadata is required.');
        }
      }
    }
  }
  const declarations = performance.evaluation.groups.flatMap(group => [
    ...group.strikes.flatMap(strike => strike.state === 'MATCHED'
      ? [{ observationId: strike.match.observation.observationId, disposition: 'MATCHED', ownerId: strike.strikeId }] : []),
    ...group.wrongObservations.map(observation => ({ observationId: observation.observationId, disposition: 'WRONG', ownerId: group.groupId })),
  ]).concat(performance.evaluation.extras.map(extra => ({ observationId: extra.observation.observationId, disposition: 'EXTRA', ownerId: extra.observation.observationId })));
  const owners = performance.evaluation.observationOwnership;
  if (new Set(declarations.map(owner => owner.observationId)).size !== declarations.length
    || owners.length !== declarations.length || declarations.some(owner => !owners.some(other =>
      other.observationId === owner.observationId && other.disposition === owner.disposition && other.ownerId === owner.ownerId))) {
    throw new Error('CompletedPerformance observation ownership is corrupt.');
  }
}

class CompletedPerformanceStore {
  private performance: CompletedPerformance | null = null;
  private listeners = new Set<(performance: CompletedPerformance | null) => void>();

  getPerformance(): CompletedPerformance | null {
    return this.performance;
  }

  setPerformance(performance: CompletedPerformance): void {
    assertCompletedPerformance(performance);
    this.performance = { ...performance,
      evaluation: Object.isFrozen(performance.evaluation) ? performance.evaluation
        : immutableContinuousValue(structuredClone(performance.evaluation)) };
    this.notify();
  }

  clearPerformance(): void {
    this.performance = null;
    this.notify();
  }

  subscribe(listener: (performance: CompletedPerformance | null) => void): () => void {
    this.listeners.add(listener);
    listener(this.performance);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener(this.performance);
    }
  }
}

export const completedPerformanceStore = new CompletedPerformanceStore();
