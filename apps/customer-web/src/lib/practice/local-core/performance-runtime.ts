import {
  assertPracticeScoreArtifact,
  countInContractAt,
  entryGroupEndBeat,
  resolvePracticeScope,
  roundBeat,
  type PracticeScoreArtifact,
  type PracticeInputSource,
  type PracticeScope,
  type TempoSegment,
} from './artifact';
import type {
  PerformanceEvaluationObservation,
  PerformanceEvidenceObservation,
  PerformanceExpectedEventOutcome,
} from './evidence';
import { PracticeTimebase, type DurableClock, type LocalClock, type RuntimeVersionIdentity } from './timebase';
import {
  createLocalSessionId,
  type LocalPerformanceSessionSnapshot,
} from './session';
import { LocalPerformanceEvaluator } from './performance-evaluator';

export type PerformanceRuntimeState = 'READY' | 'COUNT_IN' | 'RUNNING' | 'PAUSED' | 'ENDED';

export type PerformanceClockSnapshot = {
  state: PerformanceRuntimeState;
  nowMs: number;
  musicalBeat: number;
  performanceTimeMs: number;
  countInRemainingMs: number;
  countInBeats: number;
  countInPulses: number;
  scopeCompleted: boolean;
  scopeStartBeat: number;
  scopeTerminalBeat: number;
  speedRatio: number;
};

export type PerformancePracticeRuntimeOptions = {
  artifact: PracticeScoreArtifact;
  scope?: PracticeScope;
  clock: LocalClock;
  timebase?: PracticeTimebase;
  metadataClock?: DurableClock;
  inputSource?: PracticeInputSource;
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
  private readonly timebase: PracticeTimebase;
  private readonly metadataClock: DurableClock;
  private readonly version: RuntimeVersionIdentity;
  private readonly inputSource: PracticeInputSource;
  private readonly speedRatio: number;
  private readonly timeline: PerformanceTimeline;
  private readonly scope: PerformanceScope;
  private readonly countInMs: number;
  private readonly countInBeats: number;
  private readonly countInPulses: number;
  private readonly evaluator: LocalPerformanceEvaluator;
  private readonly createdAtMs: number;
  private state: PerformanceRuntimeState = 'READY';
  private stateBeforePause: PerformanceRuntimeState = 'READY';
  private activeElapsedMs = 0;
  private currentSegment: ClockSegment | null = null;
  private clockSegments: ClockSegment[] = [];
  private observations: PerformanceEvaluationObservation[] = [];
  private outcomes: PerformanceExpectedEventOutcome[] = [];

  constructor(options: PerformancePracticeRuntimeOptions) {
    assertPracticeScoreArtifact(options.artifact);
    this.artifact = options.artifact;
    this.clock = options.clock;
    this.metadataClock = options.metadataClock ?? { nowEpochMs: () => Date.now() };
    this.version = options.version ?? {
      schemaVersion: 1,
      runtimeVersion: 'local-practice-core-v1',
    };
    if (options.snapshot) {
      validatePerformanceSnapshot(options.artifact, options.snapshot, options.inputSource, options.scope);
    }
    this.inputSource = options.snapshot?.inputSource ?? options.inputSource ?? 'MICROPHONE';
    this.speedRatio = options.snapshot?.performance.speedRatio ?? options.speedRatio ?? 1;
    if (this.speedRatio <= 0) {
      throw new Error('Performance speed ratio must be positive.');
    }
    this.timeline = new PerformanceTimeline(this.artifact);
    this.scope = resolvePerformanceScope(this.artifact, this.timeline, options.snapshot?.practiceScope ?? options.scope);
    const countIn = countInContractAt(this.artifact, this.scope.startBeat);
    this.countInBeats = options.snapshot?.performance.countInBeats ?? options.countInBeats ?? countIn.durationBeats;
    this.countInPulses = options.snapshot?.performance.countInPulses ?? countIn.pulses;
    this.countInMs = options.snapshot?.performance.countInMs
      ?? beatsToMs(this.countInBeats, this.timeline.bpmAtBeat(this.scope.startBeat)) / this.speedRatio;
    this.evaluator = new LocalPerformanceEvaluator({
      artifact: this.artifact,
      timeline: this.timeline,
      scope: this.scope,
    });
    this.localSessionId = options.snapshot?.localSessionId ?? options.localSessionId ?? createLocalSessionId();
    this.timebase = options.timebase ?? new PracticeTimebase({ domainId: this.localSessionId });
    this.createdAtMs = options.snapshot?.createdAtMs ?? this.metadataClock.nowEpochMs();

    if (options.snapshot) {
      this.state = options.snapshot.performance.state === 'READY' || options.snapshot.performance.state === 'ENDED'
        ? options.snapshot.performance.state
        : 'PAUSED';
      this.stateBeforePause = options.snapshot.performance.state === 'PAUSED'
        ? options.snapshot.performance.stateBeforePause
        : options.snapshot.performance.state;
      this.activeElapsedMs = options.snapshot.performance.activeElapsedMs;
      this.observations = options.snapshot.performance.observations.map((observation) => ({
        ...observation,
      }));
      this.outcomes = options.snapshot.performance.outcomes.map((outcome) => ({
        ...outcome,
        source: outcome.source,
      }));
    }
  }

  start(): PerformanceClockSnapshot {
    if (this.state !== 'READY') {
      throw new Error('Performance runtime can only start from READY.');
    }
    this.state = this.countInMs > 0 ? 'COUNT_IN' : 'RUNNING';
    this.activeElapsedMs = 0;
    this.currentSegment = this.startClockSegment(this.state, this.activeElapsedMs);
    return this.snapshot();
  }

  pause(): PerformanceClockSnapshot {
    this.advanceState();
    if (this.state !== 'COUNT_IN' && this.state !== 'RUNNING') {
      throw new Error('Performance runtime can only pause while active.');
    }
    this.activeElapsedMs = this.activeElapsedAt(this.nowSessionMs());
    this.finishCurrentSegment(this.nowSessionMs());
    this.stateBeforePause = this.state;
    this.state = 'PAUSED';
    return this.snapshot();
  }

  resume(): PerformanceClockSnapshot {
    if (this.state !== 'PAUSED') {
      throw new Error('Performance runtime can only resume from PAUSED.');
    }
    this.state = this.stateBeforePause;
    this.currentSegment = this.startClockSegment(this.state, this.activeElapsedMs);
    return this.snapshot();
  }

  snapshot(): PerformanceClockSnapshot {
    const activeElapsedMs = this.advanceState();
    const performanceTimeMs = this.performanceElapsedMs(activeElapsedMs);
    return {
      state: this.state,
      nowMs: this.nowSessionMs(),
      musicalBeat: this.musicalBeat(performanceTimeMs),
      performanceTimeMs,
      countInRemainingMs: Math.max(0, this.countInMs - activeElapsedMs),
      countInBeats: this.countInBeats,
      countInPulses: this.countInPulses,
      scopeCompleted: this.state === 'ENDED',
      scopeStartBeat: this.scope.startBeat,
      scopeTerminalBeat: this.scope.terminalBeat,
      speedRatio: this.speedRatio,
    };
  }

  observeEvidence(observation: PerformanceEvidenceObservation): PerformanceEvaluationObservation {
    this.timebase.assertSameSessionTimeDomain(observation.captureTime, this.timebase.atSessionMs(0));
    const performanceTimeMs = this.performanceTimeAtCapture(observation.captureTime.ms);
    const evaluated: PerformanceEvaluationObservation = {
      ...observation,
      performanceTimeMs,
      musicalBeat: this.musicalBeat(performanceTimeMs),
    };
    this.observations.push(evaluated);
    this.outcomes = this.evaluator.evaluate(this.observations);
    return evaluated;
  }

  snapshotSession(): LocalPerformanceSessionSnapshot {
    const nowMs = this.metadataClock.nowEpochMs();
    return {
      localSessionId: this.localSessionId,
      scoreId: this.artifact.scoreId,
      revisionId: this.artifact.revisionId,
      artifactId: this.artifact.artifactId,
      mode: 'CONTINUOUS_PLAY',
      inputSource: this.inputSource,
      practiceScope: {
        startGroupId: this.scope.startGroupId,
        endGroupId: this.scope.endGroupId,
      },
      lifecycleState: this.state === 'ENDED' ? 'ENDED' : this.state === 'PAUSED' ? 'PAUSED' : 'ACTIVE',
      version: this.version,
      createdAtMs: this.createdAtMs,
      updatedAtMs: nowMs,
      performance: {
        state: this.state,
        stateBeforePause: this.stateBeforePause,
        speedRatio: this.speedRatio,
        scopeStartBeat: this.scope.startBeat,
        scopeTerminalBeat: this.scope.terminalBeat,
        activeElapsedMs: this.activeElapsedAt(this.nowSessionMs()),
        countInMs: this.countInMs,
        countInBeats: this.countInBeats,
        countInPulses: this.countInPulses,
        observations: this.observations.map((observation) => ({
          source: observation.source,
          captureTime: observation.captureTime,
          inferenceCompletedAtMs: observation.inferenceCompletedAtMs,
          pitches: observation.pitches,
          confidence: observation.confidence,
          performanceTimeMs: observation.performanceTimeMs,
          musicalBeat: observation.musicalBeat,
        })),
        outcomes: this.outcomes,
      },
    };
  }

  get evaluationObservations(): PerformanceEvaluationObservation[] {
    return [...this.observations];
  }

  get evaluationOutcomes(): PerformanceExpectedEventOutcome[] {
    return [...this.outcomes];
  }

  private advanceState(): number {
    if (this.state === 'READY') {
      return 0;
    }
    const activeElapsedMs = this.activeElapsedAt(this.nowSessionMs());
    if (this.state === 'PAUSED') {
      return activeElapsedMs;
    }
    if (activeElapsedMs < this.countInMs) {
      this.state = 'COUNT_IN';
    } else if (this.performanceElapsedMs(activeElapsedMs) >= this.scopeDurationMs()) {
      this.activeElapsedMs = activeElapsedMs;
      this.finishCurrentSegment(this.nowSessionMs());
      this.state = 'ENDED';
    } else {
      this.state = 'RUNNING';
    }
    return activeElapsedMs;
  }

  private activeElapsedAt(nowMs: number): number {
    if (!this.currentSegment || this.state === 'PAUSED' || this.state === 'ENDED') {
      return this.activeElapsedMs;
    }
    return Math.max(0, this.currentSegment.activeElapsedStartMs + nowMs - this.currentSegment.clockStartMs);
  }

  private activeElapsedForCapture(captureTimeMs: number): number {
    for (const segment of this.clockSegments) {
      const end = segment.clockEndMs ?? (
        this.currentSegment === segment ? this.nowSessionMs() : segment.clockStartMs
      );
      if (segment.clockStartMs <= captureTimeMs && captureTimeMs <= end) {
        return Math.max(0, segment.activeElapsedStartMs + captureTimeMs - segment.clockStartMs);
      }
    }
    if (this.currentSegment
      && this.currentSegment.clockStartMs <= captureTimeMs
      && captureTimeMs <= this.nowSessionMs()) {
      return Math.max(0, this.currentSegment.activeElapsedStartMs + captureTimeMs - this.currentSegment.clockStartMs);
    }
    return this.activeElapsedAt(captureTimeMs);
  }

  private performanceTimeAtCapture(captureTimeMs: number): number {
    const activeElapsedMs = this.activeElapsedForCapture(captureTimeMs);
    return this.performanceElapsedMs(activeElapsedMs);
  }

  private startClockSegment(state: PerformanceRuntimeState, activeElapsedStartMs: number): ClockSegment {
    const segment = {
      state,
      clockStartMs: this.nowSessionMs(),
      activeElapsedStartMs,
    };
    this.clockSegments.push(segment);
    return segment;
  }

  private finishCurrentSegment(clockEndMs: number): void {
    if (this.currentSegment) {
      this.currentSegment.clockEndMs = clockEndMs;
      this.currentSegment = null;
    }
  }

  private performanceElapsedMs(activeElapsedMs: number): number {
    return Math.min(
      Math.max(0, activeElapsedMs - this.countInMs) * this.speedRatio,
      this.scopeDurationMs()
    );
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

  private nowSessionMs(): number {
    return this.timebase.runtimeToSessionTime(this.clock.nowMs()).ms;
  }
}

type ClockSegment = {
  state: PerformanceRuntimeState;
  clockStartMs: number;
  clockEndMs?: number;
  activeElapsedStartMs: number;
};

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

function validatePerformanceSnapshot(
  artifact: PracticeScoreArtifact,
  snapshot: LocalPerformanceSessionSnapshot,
  inputSource?: PracticeInputSource,
  scope?: PracticeScope
): void {
  if (snapshot.mode !== 'CONTINUOUS_PLAY') {
    throw new Error('Cannot restore non-performance snapshot into PerformancePracticeRuntime.');
  }
  if (snapshot.scoreId !== artifact.scoreId
    || snapshot.revisionId !== artifact.revisionId
    || snapshot.artifactId !== artifact.artifactId) {
    throw new Error('Practice session snapshot does not belong to this score artifact.');
  }
  if (snapshot.version.schemaVersion !== 1 || snapshot.version.runtimeVersion !== 'local-practice-core-v1') {
    throw new Error('Unsupported local practice runtime snapshot version.');
  }
  if (inputSource && snapshot.inputSource !== inputSource) {
    throw new Error('Practice session snapshot input source mismatch.');
  }
  if (scope && JSON.stringify(scope) !== JSON.stringify(snapshot.practiceScope ?? {})) {
    throw new Error('Practice session snapshot scope mismatch.');
  }
  if (snapshot.performance.speedRatio <= 0) {
    throw new Error('Invalid performance snapshot speed ratio.');
  }
  if (snapshot.performance.activeElapsedMs < 0 || !Number.isFinite(snapshot.performance.activeElapsedMs)) {
    throw new Error('Invalid performance snapshot active elapsed time.');
  }
  if (snapshot.performance.countInMs < 0
    || snapshot.performance.countInBeats < 0
    || snapshot.performance.countInPulses < 0) {
    throw new Error('Invalid performance snapshot count-in state.');
  }
}
