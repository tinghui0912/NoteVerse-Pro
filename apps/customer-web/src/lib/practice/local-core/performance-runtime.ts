import {
  assertPracticeScoreArtifact,
  countInContractAt,
  resolvePracticeScope,
  type PracticeScoreArtifact,
  type PracticeInputSource,
  type PracticeScope,
  type ResolvedPracticeScope,
  type TempoSegment,
} from './artifact';
import type {
  PerformanceEvaluationObservation,
  PerformanceEvidenceObservation,
  PerformanceExpectedEventOutcome,
} from './evidence';
import { PracticeTimebase, type DurableClock, type LocalClock, type RuntimeVersionIdentity, type SessionTime } from './timebase';
import {
  createLocalSessionId,
  type LocalPerformanceSessionSnapshot,
  type LocalPracticeCompletionReason,
} from './session';
import {
  LocalPerformanceEvaluator,
  type PerformanceCoverageInterval,
} from './performance-evaluator';
import {
  beatsToMs,
  PracticeTempoTimeline,
  resolvePracticeTempoPlan,
  type PracticeTempoSelection,
  type ResolvedPracticeTempoPlan,
  type ResolvedPracticeTempoSegment,
} from './practice-tempo';

export type PerformanceRuntimeState = 'READY' | 'COUNT_IN' | 'RUNNING' | 'PAUSED' | 'ENDED';

export type PerformanceClockSnapshot = {
  state: PerformanceRuntimeState;
  nowMs: number;
  musicalBeat: number;
  performanceTimeMs: number;
  countInTotalMs: number;
  countInRemainingMs: number;
  countInBeats: number;
  countInPulses: number;
  countInPulse: number;
  scopeCompleted: boolean;
  scopeStartBeat: number;
  scopeTerminalBeat: number;
  completionReason: LocalPracticeCompletionReason | null;
};

export type PerformancePracticeRuntimeOptions = {
  artifact: PracticeScoreArtifact;
  tempoPlan?: ResolvedPracticeTempoPlan;
  scope: PracticeScope;
  clock: LocalClock;
  timebase?: PracticeTimebase;
  metadataClock?: DurableClock;
  inputSource?: PracticeInputSource;
  countInBeats?: number;
  localSessionId?: string;
  version?: RuntimeVersionIdentity;
  snapshot?: LocalPerformanceSessionSnapshot;
  tempoSelection?: PracticeTempoSelection;
  metronomeEnabled?: boolean;
};

type PerformanceScope = ResolvedPracticeScope & {
  nominalStartTimeMs: number;
  nominalEndTimeMs: number;
};

export class PerformancePracticeRuntime {
  readonly artifact: PracticeScoreArtifact;
  readonly localSessionId: string;
  readonly timebase: PracticeTimebase;
  private readonly timeline: PerformanceTimeline;
  private readonly evaluator: LocalPerformanceEvaluator;
  private readonly clock: LocalClock;
  private readonly metadataClock: DurableClock;
  private readonly version: RuntimeVersionIdentity;
  private readonly createdAtMs: number;
  private readonly scope: PerformanceScope;
  private readonly countInBeats: number;
  private readonly countInPulses: number;
  private readonly countInMs: number;
  private readonly tempoPlan: ResolvedPracticeTempoPlan;
  private readonly tempoSelection: PracticeTempoSelection;
  private metronomeEnabled: boolean;
  private inputSource: PracticeInputSource;
  private state: PerformanceRuntimeState = 'READY';
  private stateBeforePause: PerformanceRuntimeState = 'READY';
  private completionReason: LocalPracticeCompletionReason | null = null;
  private activeElapsedMs = 0;
  private currentSegment: ClockSegment | null = null;
  private clockSegments: ClockSegment[] = [];
  private observations: PerformanceEvaluationObservation[] = [];
  private outcomes: PerformanceExpectedEventOutcome[] = [];
  private evaluationCoverageIntervals: PerformanceCoverageInterval[] = [];

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
      validatePerformanceSnapshot(options.artifact, options.snapshot, options.scope, options.inputSource);
    }
    this.inputSource = options.snapshot?.inputSource ?? options.inputSource ?? 'MICROPHONE';
    this.tempoPlan = options.snapshot?.performance.resolvedTempoPlan
      ?? options.tempoPlan
      ?? resolvePracticeTempoPlan(options.artifact, options.tempoSelection ?? { mode: 'SCORE' });
    if (!this.tempoPlan || !Array.isArray(this.tempoPlan.segments) || this.tempoPlan.segments.length === 0) {
      throw new Error('PerformancePracticeRuntime requires a valid ResolvedPracticeTempoPlan with segments.');
    }
    this.tempoSelection = options.snapshot?.tempoSelection
      ?? options.tempoSelection
      ?? this.tempoPlan.selection;
    this.metronomeEnabled = options.snapshot?.metronomeEnabled ?? options.metronomeEnabled ?? false;
    this.timeline = new PerformanceTimeline(this.artifact, this.tempoPlan.segments);
    this.scope = resolvePerformanceScope(this.artifact, this.timeline, options.scope);
    const countIn = countInContractAt(this.artifact, this.scope.startBeat);
    this.countInBeats = options.snapshot?.performance.countInBeats ?? options.countInBeats ?? countIn.durationBeats;
    this.countInPulses = options.snapshot?.performance.countInPulses ?? countIn.pulses;
    this.countInMs = options.snapshot?.performance.countInMs
      ?? beatsToMs(this.countInBeats, this.timeline.bpmAtBeat(this.scope.startBeat));
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
      this.completionReason = options.snapshot.completionReason;
      this.activeElapsedMs = options.snapshot.performance.activeElapsedMs;
      this.observations = options.snapshot.performance.observations.map((observation) => ({
        ...observation,
      }));
      this.outcomes = options.snapshot.performance.outcomes.map((outcome) => ({
        ...outcome,
        source: outcome.source,
      }));
      this.evaluationCoverageIntervals = mergePerformanceCoverageIntervals(
        options.snapshot.performance.evaluationCoverageIntervals
      );
    }
  }

  start(): PerformanceClockSnapshot {
    if (this.state !== 'READY') {
      throw new Error('Performance runtime can only start from READY.');
    }
    this.completionReason = null;
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

  end(reason: LocalPracticeCompletionReason = 'STOPPED_BY_USER'): PerformanceClockSnapshot {
    if (this.state === 'ENDED') {
      return this.snapshot();
    }
    this.activeElapsedMs = this.activeElapsedAt(this.nowSessionMs());
    this.finishCurrentSegment(this.nowSessionMs());
    this.state = 'ENDED';
    this.completionReason = reason;
    return this.snapshot();
  }

  setMetronomeEnabled(enabled: boolean): void {
    this.metronomeEnabled = enabled;
  }

  snapshot(): PerformanceClockSnapshot {
    const activeElapsedMs = this.advanceState();
    const performanceTimeMs = this.performanceElapsedMs(activeElapsedMs);
    const countInTotalMs = this.countInMs;
    const countInRemainingMs = Math.max(0, this.countInMs - activeElapsedMs);
    const countInPulse = this.countInPulses > 0 && countInTotalMs > 0 && this.state === 'COUNT_IN'
      ? Math.min(
          this.countInPulses,
          Math.max(1, Math.floor(((countInTotalMs - countInRemainingMs) / countInTotalMs) * this.countInPulses) + 1)
        )
      : 1;
    return {
      state: this.state,
      nowMs: this.nowSessionMs(),
      musicalBeat: this.musicalBeat(performanceTimeMs),
      performanceTimeMs,
      countInTotalMs,
      countInRemainingMs,
      countInBeats: this.countInBeats,
      countInPulses: this.countInPulses,
      countInPulse,
      scopeCompleted: this.completionReason === 'SCOPE_COMPLETED',
      scopeStartBeat: this.scope.startBeat,
      scopeTerminalBeat: this.scope.terminalBeat,
      completionReason: this.completionReason,
    };
  }

  observeEvidence(observation: PerformanceEvidenceObservation): PerformanceEvaluationObservation | null {
    this.timebase.assertSameSessionTimeDomain(observation.captureTime, this.timebase.atSessionMs(0));
    const performanceTimeMs = this.performanceTimeAtCapture(observation.captureTime.ms);
    if (performanceTimeMs === null) {
      return null;
    }
    const evaluated: PerformanceEvaluationObservation = {
      ...observation,
      performanceTimeMs,
      musicalBeat: this.musicalBeat(performanceTimeMs),
    };
    this.observations.push(evaluated);
    this.updateEvaluationOutcomes();
    return evaluated;
  }

  markEvaluationCoverageThrough(captureTime: SessionTime): void {
    this.timebase.assertSameSessionTimeDomain(captureTime, this.timebase.atSessionMs(0));
    const performanceTimeMs = this.performanceTimeAtCapture(captureTime.ms);
    if (performanceTimeMs === null) {
      return;
    }
    this.evaluationCoverageIntervals = mergePerformanceCoverageIntervals([
      ...this.evaluationCoverageIntervals,
      { startMs: 0, endMs: performanceTimeMs },
    ]);
    this.updateEvaluationOutcomes();
  }

  markEvaluationCoverageIntervals(
    intervals: readonly {
      start: SessionTime;
      end: SessionTime;
    }[]
  ): void {
    const performanceIntervals: PerformanceCoverageInterval[] = [];
    for (const interval of intervals) {
      this.timebase.assertSameSessionTimeDomain(interval.start, this.timebase.atSessionMs(0));
      this.timebase.assertSameSessionTimeDomain(interval.end, this.timebase.atSessionMs(0));
      performanceIntervals.push(...this.captureIntervalToPerformanceIntervals(interval.start.ms, interval.end.ms));
    }
    if (!performanceIntervals.length) {
      return;
    }
    this.evaluationCoverageIntervals = mergePerformanceCoverageIntervals([
      ...this.evaluationCoverageIntervals,
      ...performanceIntervals,
    ]);
    this.updateEvaluationOutcomes();
  }

  completionCaptureTime(): SessionTime {
    const targetActiveElapsedMs = Math.min(
      this.activeElapsedMs,
      this.countInMs + this.scopeDurationMs()
    );
    return this.timebase.atSessionMs(this.sessionMsForActiveElapsed(targetActiveElapsedMs));
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
      practiceScope:
        this.scope.kind === 'RANGE'
          ? {
              kind: 'RANGE',
              startGroupId: this.scope.startGroupId,
              endGroupId: this.scope.endGroupId,
            }
          : { kind: 'FULL' },
      tempoSelection: this.tempoSelection,
      metronomeEnabled: this.metronomeEnabled,
      lifecycleState: this.state === 'ENDED' ? 'ENDED' : this.state === 'PAUSED' ? 'PAUSED' : 'ACTIVE',
      completionReason: this.completionReason,
      version: this.version,
      createdAtMs: this.createdAtMs,
      updatedAtMs: nowMs,
      performance: {
        state: this.state,
        stateBeforePause: this.stateBeforePause,
        resolvedTempoPlan: this.tempoPlan,
        scopeStartBeat: this.scope.startBeat,
        scopeTerminalBeat: this.scope.terminalBeat,
        activeElapsedMs: this.activeElapsedAt(this.nowSessionMs()),
        countInMs: this.countInMs,
        countInBeats: this.countInBeats,
        countInPulses: this.countInPulses,
        evaluationCoverageIntervals: this.evaluationCoverageIntervals.map((interval) => ({ ...interval })),
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

  get sessionCompletionReason(): LocalPracticeCompletionReason | null {
    return this.completionReason;
  }

  private advanceState(): number {
    if (this.state === 'READY') {
      return 0;
    }
    const activeElapsedMs = this.activeElapsedAt(this.nowSessionMs());
    if (this.state === 'PAUSED' || this.state === 'ENDED') {
      return activeElapsedMs;
    }
    if (activeElapsedMs < this.countInMs) {
      this.state = 'COUNT_IN';
    } else if (this.performanceElapsedMs(activeElapsedMs) >= this.scopeDurationMs()) {
      this.activeElapsedMs = activeElapsedMs;
      this.finishCurrentSegment(this.nowSessionMs());
      this.state = 'ENDED';
      this.completionReason = 'SCOPE_COMPLETED';
    } else {
      this.state = 'RUNNING';
    }
    return activeElapsedMs;
  }

  private updateEvaluationOutcomes(): void {
    this.outcomes = this.evaluator.evaluate(this.observations, {
      coveredPerformanceIntervals: this.evaluationCoverageIntervals,
      naturalTerminalPerformanceTimeMs:
        this.completionReason === 'SCOPE_COMPLETED' ? this.scopeDurationMs() : null,
    });
  }

  private captureIntervalToPerformanceIntervals(
    captureStartMs: number,
    captureEndMs: number
  ): PerformanceCoverageInterval[] {
    if (!Number.isFinite(captureStartMs) || !Number.isFinite(captureEndMs) || captureEndMs <= captureStartMs) {
      return [];
    }
    const intervals: PerformanceCoverageInterval[] = [];
    for (const segment of this.clockSegments) {
      if (segment.state !== 'RUNNING') {
        continue;
      }
      const segmentClockEndMs = segment.clockEndMs ?? (
        this.currentSegment === segment ? this.nowSessionMs() : segment.clockStartMs
      );
      const startMs = Math.max(captureStartMs, segment.clockStartMs);
      const endMs = Math.min(captureEndMs, segmentClockEndMs);
      if (endMs <= startMs) {
        continue;
      }
      const activeStartMs = segment.activeElapsedStartMs + startMs - segment.clockStartMs;
      const activeEndMs = segment.activeElapsedStartMs + endMs - segment.clockStartMs;
      const perfStartMs = this.performanceElapsedMs(activeStartMs);
      const perfEndMs = this.performanceElapsedMs(activeEndMs);
      if (perfEndMs > perfStartMs) {
        intervals.push({ startMs: perfStartMs, endMs: perfEndMs });
      }
    }
    return intervals;
  }

  private activeElapsedAt(nowMs: number): number {
    if (!this.currentSegment || this.state === 'PAUSED' || this.state === 'ENDED') {
      return this.activeElapsedMs;
    }
    return Math.max(0, this.currentSegment.activeElapsedStartMs + nowMs - this.currentSegment.clockStartMs);
  }

  private activeElapsedForCapture(captureTimeMs: number): number | null {
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
    return null;
  }

  private performanceTimeAtCapture(captureTimeMs: number): number | null {
    const activeElapsedMs = this.activeElapsedForCapture(captureTimeMs);
    if (activeElapsedMs === null) {
      return null;
    }
    if (
      activeElapsedMs < this.countInMs
      || activeElapsedMs > this.countInMs + this.scopeDurationMs()
    ) {
      return null;
    }
    return this.performanceElapsedMs(activeElapsedMs);
  }

  private sessionMsForActiveElapsed(activeElapsedMs: number): number {
    for (const segment of this.clockSegments) {
      const segmentEndActiveElapsed = segment.clockEndMs === undefined
        ? this.activeElapsedAt(this.nowSessionMs())
        : segment.activeElapsedStartMs + segment.clockEndMs - segment.clockStartMs;
      if (
        segment.activeElapsedStartMs <= activeElapsedMs
        && activeElapsedMs <= segmentEndActiveElapsed
      ) {
        return segment.clockStartMs + activeElapsedMs - segment.activeElapsedStartMs;
      }
    }
    return this.nowSessionMs();
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
      Math.max(0, activeElapsedMs - this.countInMs),
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

export class PerformanceTimeline extends PracticeTempoTimeline {
  constructor(artifact: PracticeScoreArtifact, tempoSegments: readonly TempoSegment[]) {
    super(
      {
        selection: { mode: 'SCORE' },
        segments: tempoSegments.map((s) => ({
          startBeat: s.startBeat,
          bpm: s.bpm,
          source: 'source' in s ? (s as ResolvedPracticeTempoSegment).source : 'MUSICXML',
        })),
      },
      artifact.scoreEndBeat
    );
  }
}

function resolvePerformanceScope(
  artifact: PracticeScoreArtifact,
  timeline: PerformanceTimeline,
  scope: PracticeScope
): PerformanceScope {
  const resolved = resolvePracticeScope(artifact, scope);
  return {
    ...resolved,
    nominalStartTimeMs: timeline.beatToTimeMs(resolved.startBeat),
    nominalEndTimeMs: timeline.beatToTimeMs(resolved.terminalBeat),
  };
}

function validatePerformanceSnapshot(
  artifact: PracticeScoreArtifact,
  snapshot: LocalPerformanceSessionSnapshot,
  scope: PracticeScope,
  inputSource?: PracticeInputSource
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
  if (JSON.stringify(scope) !== JSON.stringify(snapshot.practiceScope)) {
    throw new Error('Practice session snapshot scope mismatch.');
  }
  if (
    !snapshot.performance.resolvedTempoPlan ||
    !Array.isArray(snapshot.performance.resolvedTempoPlan.segments) ||
    snapshot.performance.resolvedTempoPlan.segments.length === 0
  ) {
    throw new Error('Invalid performance snapshot resolved tempo plan.');
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

function mergePerformanceCoverageIntervals(
  intervals: readonly PerformanceCoverageInterval[]
): PerformanceCoverageInterval[] {
  const ordered = intervals
    .filter((interval) =>
      Number.isFinite(interval.startMs) &&
      Number.isFinite(interval.endMs) &&
      interval.endMs > interval.startMs
    )
    .map((interval) => ({ ...interval }))
    .sort((left, right) => left.startMs - right.startMs);
  const merged: PerformanceCoverageInterval[] = [];
  for (const interval of ordered) {
    const previous = merged[merged.length - 1];
    if (!previous || interval.startMs > previous.endMs) {
      merged.push(interval);
      continue;
    }
    previous.endMs = Math.max(previous.endMs, interval.endMs);
  }
  return merged;
}
