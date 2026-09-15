import {
  assertPracticeScoreArtifact,
  entryGroupEndBeat,
  resolvePracticeScope,
  roundBeat,
  type PracticeScoreArtifact,
  type PracticeScope,
  type TempoSegment,
} from './artifact';
import type {
  PerformanceEvaluationObservation,
  PerformanceEvidenceObservation,
} from './evidence';
import type { LocalClock, RuntimeVersionIdentity } from './timebase';
import {
  createLocalSessionId,
  type LocalPerformanceSessionSnapshot,
} from './session';

export type PerformanceRuntimeState = 'READY' | 'COUNT_IN' | 'RUNNING' | 'PAUSED' | 'ENDED';

export type PerformanceClockSnapshot = {
  state: PerformanceRuntimeState;
  nowMs: number;
  musicalBeat: number;
  performanceTimeMs: number;
  countInRemainingMs: number;
  scopeCompleted: boolean;
  scopeStartBeat: number;
  scopeTerminalBeat: number;
  speedRatio: number;
};

export type PerformancePracticeRuntimeOptions = {
  artifact: PracticeScoreArtifact;
  scope?: PracticeScope;
  clock: LocalClock;
  speedRatio?: number;
  countInBeats?: number;
  localSessionId?: string;
  version?: RuntimeVersionIdentity;
  snapshot?: LocalPerformanceSessionSnapshot;
};

type PerformanceScope = {
  startBeat: number;
  terminalBeat: number;
  nominalStartTimeMs: number;
  nominalEndTimeMs: number;
  startGroupId?: string;
  endGroupId?: string;
};

export class PerformancePracticeRuntime {
  readonly artifact: PracticeScoreArtifact;
  readonly localSessionId: string;

  private readonly clock: LocalClock;
  private readonly version: RuntimeVersionIdentity;
  private readonly speedRatio: number;
  private readonly timeline: PerformanceTimeline;
  private readonly scope: PerformanceScope;
  private readonly countInMs: number;
  private state: PerformanceRuntimeState = 'READY';
  private startedAtMs: number | null = null;
  private pausedAtMs: number | null = null;
  private pausedAccumulatedMs = 0;
  private stateBeforePause: PerformanceRuntimeState = 'READY';
  private observations: PerformanceEvaluationObservation[] = [];

  constructor(options: PerformancePracticeRuntimeOptions) {
    assertPracticeScoreArtifact(options.artifact);
    this.artifact = options.artifact;
    this.clock = options.clock;
    this.version = options.version ?? {
      schemaVersion: 1,
      runtimeVersion: 'local-practice-core-v1',
    };
    this.speedRatio = options.snapshot?.performance.speedRatio ?? options.speedRatio ?? 1;
    if (this.speedRatio <= 0) {
      throw new Error('Performance speed ratio must be positive.');
    }
    this.timeline = new PerformanceTimeline(this.artifact);
    this.scope = resolvePerformanceScope(this.artifact, this.timeline, options.scope);
    const countInBeats = options.countInBeats ?? 4;
    this.countInMs = beatsToMs(countInBeats, this.timeline.bpmAtBeat(this.scope.startBeat)) / this.speedRatio;
    this.localSessionId = options.snapshot?.localSessionId ?? options.localSessionId ?? createLocalSessionId();

    if (options.snapshot) {
      this.state = options.snapshot.performance.state;
      this.startedAtMs = options.snapshot.performance.startedAtMs;
      this.pausedAtMs = options.snapshot.performance.pausedAtMs;
      this.pausedAccumulatedMs = options.snapshot.performance.pausedAccumulatedMs;
      this.observations = options.snapshot.performance.observations.map((observation) => ({
        ...observation,
        source: 'FAKE',
      }));
    }
  }

  start(): PerformanceClockSnapshot {
    if (this.state !== 'READY') {
      throw new Error('Performance runtime can only start from READY.');
    }
    this.startedAtMs = this.clock.nowMs();
    this.state = this.countInMs > 0 ? 'COUNT_IN' : 'RUNNING';
    return this.snapshot();
  }

  pause(): PerformanceClockSnapshot {
    this.advanceState();
    if (this.state !== 'COUNT_IN' && this.state !== 'RUNNING') {
      throw new Error('Performance runtime can only pause while active.');
    }
    this.stateBeforePause = this.state;
    this.state = 'PAUSED';
    this.pausedAtMs = this.clock.nowMs();
    return this.snapshot();
  }

  resume(): PerformanceClockSnapshot {
    if (this.state !== 'PAUSED' || this.pausedAtMs === null) {
      throw new Error('Performance runtime can only resume from PAUSED.');
    }
    this.pausedAccumulatedMs += Math.max(0, this.clock.nowMs() - this.pausedAtMs);
    this.pausedAtMs = null;
    this.state = this.stateBeforePause;
    return this.snapshot();
  }

  snapshot(): PerformanceClockSnapshot {
    const activeElapsedMs = this.advanceState();
    const performanceTimeMs = this.performanceElapsedMs(activeElapsedMs);
    return {
      state: this.state,
      nowMs: this.clock.nowMs(),
      musicalBeat: this.musicalBeat(performanceTimeMs),
      performanceTimeMs,
      countInRemainingMs: Math.max(0, this.countInMs - activeElapsedMs),
      scopeCompleted: this.state === 'ENDED',
      scopeStartBeat: this.scope.startBeat,
      scopeTerminalBeat: this.scope.terminalBeat,
      speedRatio: this.speedRatio,
    };
  }

  observeEvidence(observation: PerformanceEvidenceObservation): PerformanceEvaluationObservation {
    const performanceTimeMs = this.performanceTimeAtCapture(observation.captureTimeMs);
    const evaluated: PerformanceEvaluationObservation = {
      ...observation,
      performanceTimeMs,
      musicalBeat: this.musicalBeat(performanceTimeMs),
    };
    this.observations.push(evaluated);
    return evaluated;
  }

  snapshotSession(): LocalPerformanceSessionSnapshot {
    const nowMs = this.clock.nowMs();
    return {
      localSessionId: this.localSessionId,
      scoreId: this.artifact.scoreId,
      revisionId: this.artifact.revisionId,
      artifactId: this.artifact.artifactId,
      mode: 'CONTINUOUS_PLAY',
      inputSource: 'MICROPHONE',
      practiceScope: {
        startGroupId: this.scope.startGroupId,
        endGroupId: this.scope.endGroupId,
      },
      lifecycleState: this.state === 'ENDED' ? 'ENDED' : 'ACTIVE',
      version: this.version,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      performance: {
        state: this.state,
        speedRatio: this.speedRatio,
        scopeStartBeat: this.scope.startBeat,
        scopeTerminalBeat: this.scope.terminalBeat,
        startedAtMs: this.startedAtMs,
        pausedAtMs: this.pausedAtMs,
        pausedAccumulatedMs: this.pausedAccumulatedMs,
        countInMs: this.countInMs,
        observations: this.observations.map((observation) => ({
          captureTimeMs: observation.captureTimeMs,
          inferenceCompletedAtMs: observation.inferenceCompletedAtMs,
          pitches: observation.pitches,
          confidence: observation.confidence,
          performanceTimeMs: observation.performanceTimeMs,
          musicalBeat: observation.musicalBeat,
        })),
      },
    };
  }

  get evaluationObservations(): PerformanceEvaluationObservation[] {
    return [...this.observations];
  }

  private advanceState(): number {
    if (this.state === 'READY') {
      return 0;
    }
    const activeElapsedMs = this.activeElapsedMs(this.clock.nowMs());
    if (this.state === 'PAUSED') {
      return activeElapsedMs;
    }
    if (activeElapsedMs < this.countInMs) {
      this.state = 'COUNT_IN';
    } else if (this.performanceElapsedMs(activeElapsedMs) >= this.scopeDurationMs()) {
      this.state = 'ENDED';
    } else {
      this.state = 'RUNNING';
    }
    return activeElapsedMs;
  }

  private activeElapsedMs(nowMs: number): number {
    if (this.startedAtMs === null) {
      return 0;
    }
    const pauseElapsed =
      this.state === 'PAUSED' && this.pausedAtMs !== null
        ? Math.max(0, nowMs - this.pausedAtMs)
        : 0;
    return Math.max(0, nowMs - this.startedAtMs - this.pausedAccumulatedMs - pauseElapsed);
  }

  private performanceElapsedMs(activeElapsedMs: number): number {
    return Math.min(
      Math.max(0, activeElapsedMs - this.countInMs) * this.speedRatio,
      this.scopeDurationMs()
    );
  }

  private performanceTimeAtCapture(captureTimeMs: number): number {
    const activeElapsedMs = this.activeElapsedMs(captureTimeMs);
    return this.performanceElapsedMs(activeElapsedMs);
  }

  private musicalBeat(performanceTimeMs: number): number {
    if (performanceTimeMs >= this.scopeDurationMs()) {
      return this.scope.terminalBeat;
    }
    return this.timeline.timeMsToBeat(this.scope.nominalStartTimeMs + performanceTimeMs);
  }

  private scopeDurationMs(): number {
    return Math.max(0, this.scope.nominalEndTimeMs - this.scope.nominalStartTimeMs);
  }
}

export class PerformanceTimeline {
  private readonly segments: TimelineSegment[];
  readonly endBeat: number;

  constructor(artifact: PracticeScoreArtifact) {
    this.endBeat = artifact.scoreEndBeat;
    this.segments = buildTimelineSegments(artifact.scoreEndBeat, artifact.tempoSegments);
  }

  beatToTimeMs(beat: number): number {
    if (this.segments.length === 0) {
      return 0;
    }
    const bounded = Math.min(Math.max(beat, 0), this.endBeat);
    const segment = this.segmentForBeat(bounded);
    return segment.startTimeMs + beatsToMs(bounded - segment.startBeat, segment.bpm);
  }

  timeMsToBeat(timeMs: number): number {
    if (this.segments.length === 0) {
      return 0;
    }
    const durationMs = this.segments[this.segments.length - 1]?.endTimeMs ?? 0;
    const bounded = Math.min(Math.max(timeMs, 0), durationMs);
    const segment = this.segmentForTimeMs(bounded);
    return roundBeat(segment.startBeat + msToBeats(bounded - segment.startTimeMs, segment.bpm));
  }

  bpmAtBeat(beat: number): number {
    if (this.segments.length === 0) {
      return 120;
    }
    return this.segmentForBeat(Math.min(Math.max(beat, 0), this.endBeat)).bpm;
  }

  private segmentForBeat(beat: number): TimelineSegment {
    return this.segments.find((segment) => segment.startBeat <= beat && beat < segment.endBeat)
      ?? this.segments[this.segments.length - 1];
  }

  private segmentForTimeMs(timeMs: number): TimelineSegment {
    return this.segments.find((segment) => segment.startTimeMs <= timeMs && timeMs < segment.endTimeMs)
      ?? this.segments[this.segments.length - 1];
  }
}

type TimelineSegment = {
  startBeat: number;
  endBeat: number;
  startTimeMs: number;
  endTimeMs: number;
  bpm: number;
};

function resolvePerformanceScope(
  artifact: PracticeScoreArtifact,
  timeline: PerformanceTimeline,
  scope?: PracticeScope
): PerformanceScope {
  const resolved = resolvePracticeScope(artifact, scope);
  const terminalBeat = scope?.endGroupId
    ? entryGroupEndBeat(artifact, scope.endGroupId)
    : resolved.terminalBeat;
  return {
    startBeat: resolved.startBeat,
    terminalBeat,
    nominalStartTimeMs: timeline.beatToTimeMs(resolved.startBeat),
    nominalEndTimeMs: timeline.beatToTimeMs(terminalBeat),
    startGroupId: resolved.startGroupId,
    endGroupId: resolved.endGroupId,
  };
}

function buildTimelineSegments(endBeat: number, tempoSegments: TempoSegment[]): TimelineSegment[] {
  if (endBeat <= 0) {
    return [];
  }
  const byBeat = new Map<number, TempoSegment>();
  for (const segment of tempoSegments) {
    if (segment.startBeat >= 0 && segment.bpm > 0) {
      byBeat.set(roundBeat(segment.startBeat), { startBeat: roundBeat(segment.startBeat), bpm: segment.bpm });
    }
  }
  if (!byBeat.has(0)) {
    byBeat.set(0, { startBeat: 0, bpm: 120 });
  }
  const normalized = Array.from(byBeat.values()).sort((a, b) => a.startBeat - b.startBeat);
  let currentTimeMs = 0;
  return normalized.flatMap((tempo, index) => {
    const nextStart = normalized[index + 1]?.startBeat ?? endBeat;
    const startBeat = Math.min(Math.max(tempo.startBeat, 0), endBeat);
    const end = Math.min(Math.max(nextStart, startBeat), endBeat);
    if (end <= startBeat) {
      return [];
    }
    const startTimeMs = currentTimeMs;
    const endTimeMs = startTimeMs + beatsToMs(end - startBeat, tempo.bpm);
    currentTimeMs = endTimeMs;
    return [{ startBeat, endBeat: end, startTimeMs, endTimeMs, bpm: tempo.bpm }];
  });
}

function beatsToMs(beats: number, bpm: number): number {
  return beats * 60_000 / bpm;
}

function msToBeats(milliseconds: number, bpm: number): number {
  return milliseconds * bpm / 60_000;
}
