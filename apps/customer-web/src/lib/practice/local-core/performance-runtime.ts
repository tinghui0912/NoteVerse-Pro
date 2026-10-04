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
import type { CapturedAttack } from './evidence';
import { PracticeTimebase, type DurableClock, type LocalClock, type RuntimeVersionIdentity, type SessionTime } from './timebase';
import {
  createLocalSessionId,
  type LocalPerformanceSessionSnapshot,
  type LocalPracticeCompletionReason,
} from './session';
import {
  ContinuousEvaluationSession,
  type ContinuousEvaluationSnapshot,
} from './continuous-evaluation-session';
import {
  beatsToMs,
  PracticeTempoTimeline,
  resolvePracticeTempoPlan,
  type PracticeTempoSelection,
  type ResolvedPracticeTempoPlan,
  type ResolvedPracticeTempoSegment,
} from './practice-tempo';
import type { CompletedContinuousEvaluation } from '../completed-performance';

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

export type PerformanceClockRuntimeOptions = {
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
  tempoSelection?: PracticeTempoSelection;
  metronomeEnabled?: boolean;
};

export type ContinuousPracticeSessionOptions = PerformanceClockRuntimeOptions;

export type ContinuousAnalysisPublication = {
  sessionDomainId: string;
  attacks: readonly CapturedAttack[];
  analyzedThroughPerformanceMs: number;
};

class ContinuousAnalysisPublicationDomainError extends Error {
  readonly code = 'CONTINUOUS_ANALYSIS_PUBLICATION_DOMAIN_MISMATCH' as const;

  constructor(message = 'Continuous analysis publication belongs to a different session domain.') {
    super(message);
    this.name = 'ContinuousAnalysisPublicationDomainError';
  }
}

type PerformanceScope = ResolvedPracticeScope & {
  nominalStartTimeMs: number;
  nominalEndTimeMs: number;
};

export class PerformanceClockRuntime {
  readonly artifact: PracticeScoreArtifact;
  readonly localSessionId: string;
  readonly timebase: PracticeTimebase;
  private readonly timeline: PerformanceTimeline;
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
  private readonly inputSource: PracticeInputSource;
  private state: PerformanceRuntimeState = 'READY';
  private stateBeforePause: PerformanceRuntimeState = 'READY';
  private completionReason: LocalPracticeCompletionReason | null = null;
  private activeElapsedMs = 0;
  private currentSegment: ClockSegment | null = null;
  private clockSegments: ClockSegment[] = [];

  constructor(options: PerformanceClockRuntimeOptions) {
    assertPracticeScoreArtifact(options.artifact);
    this.artifact = options.artifact;
    this.clock = options.clock;
    this.metadataClock = options.metadataClock ?? { nowEpochMs: () => Date.now() };
    this.version = options.version ?? {
      schemaVersion: 1,
      runtimeVersion: 'local-practice-core-v1',
    };
    this.inputSource = options.inputSource ?? 'MICROPHONE';
    this.tempoPlan = options.tempoPlan
      ?? resolvePracticeTempoPlan(options.artifact, options.tempoSelection ?? { mode: 'SCORE' });
    if (!this.tempoPlan || !Array.isArray(this.tempoPlan.segments) || this.tempoPlan.segments.length === 0) {
      throw new Error('PerformanceClockRuntime requires a valid ResolvedPracticeTempoPlan with segments.');
    }
    this.tempoSelection = options.tempoSelection ?? this.tempoPlan.selection;
    this.metronomeEnabled = options.metronomeEnabled ?? false;
    this.timeline = new PerformanceTimeline(this.artifact, this.tempoPlan.segments);
    this.scope = resolvePerformanceScope(this.artifact, this.timeline, options.scope);
    const countIn = countInContractAt(this.artifact, this.scope.startBeat);
    this.countInBeats = options.countInBeats ?? countIn.durationBeats;
    this.countInPulses = countIn.pulses;
    this.countInMs = beatsToMs(this.countInBeats, this.timeline.bpmAtBeat(this.scope.startBeat));
    this.localSessionId = options.localSessionId ?? createLocalSessionId();
    this.timebase = options.timebase ?? new PracticeTimebase({ domainId: this.localSessionId });
    this.createdAtMs = this.metadataClock.nowEpochMs();
  }

  start(): PerformanceClockSnapshot {
    if (this.state !== 'READY') {
      throw new Error('Performance clock can only start from READY.');
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
      throw new Error('Performance clock can only pause while active.');
    }
    this.activeElapsedMs = this.activeElapsedAt(this.nowSessionMs());
    this.finishCurrentSegment(this.nowSessionMs());
    this.stateBeforePause = this.state;
    this.state = 'PAUSED';
    return this.snapshot();
  }

  resume(): PerformanceClockSnapshot {
    if (this.state !== 'PAUSED') {
      throw new Error('Performance clock can only resume from PAUSED.');
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

  performanceTimeAtCapture(captureTimeMs: number): number | null {
    const activeElapsedMs = this.activeElapsedForCapture(captureTimeMs);
    if (activeElapsedMs === null) {
      return null;
    }
    if (
      activeElapsedMs < this.countInMs ||
      activeElapsedMs > this.countInMs + this.scopeDurationMs()
    ) {
      return null;
    }
    return this.performanceElapsedMs(activeElapsedMs);
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
      },
    };
  }

  get sessionCompletionReason(): LocalPracticeCompletionReason | null {
    return this.completionReason;
  }

  scopeDurationMs(): number {
    return Math.max(0, this.scope.nominalEndTimeMs - this.scope.nominalStartTimeMs);
  }

  private advanceState(): number {
    if (this.state === 'READY') {
      return 0;
    }
    const activeElapsedMs = this.activeElapsedAt(this.nowSessionMs());
    if (this.state === 'PAUSED' || this.state === 'ENDED') {
      return activeElapsedMs;
    }
    if (this.state === 'COUNT_IN' && activeElapsedMs >= this.countInMs) {
      const boundarySessionMs = this.sessionMsForActiveElapsed(this.countInMs);
      this.finishCurrentSegment(boundarySessionMs);
      this.state = 'RUNNING';
      this.currentSegment = this.startClockSegmentAt('RUNNING', this.countInMs, boundarySessionMs);
    }
    const terminalActiveElapsedMs = this.countInMs + this.scopeDurationMs();
    if (this.state === 'RUNNING' && activeElapsedMs >= terminalActiveElapsedMs) {
      const boundarySessionMs = this.sessionMsForActiveElapsed(terminalActiveElapsedMs);
      this.activeElapsedMs = terminalActiveElapsedMs;
      this.finishCurrentSegment(boundarySessionMs);
      this.state = 'ENDED';
      this.completionReason = 'SCOPE_COMPLETED';
    } else if (activeElapsedMs < this.countInMs) {
      this.state = 'COUNT_IN';
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

  private sessionMsForActiveElapsed(activeElapsedMs: number): number {
    for (const segment of this.clockSegments) {
      const segmentEndActiveElapsed = segment.clockEndMs === undefined
        ? this.activeElapsedAt(this.nowSessionMs())
        : segment.activeElapsedStartMs + segment.clockEndMs - segment.clockStartMs;
      if (
        segment.activeElapsedStartMs <= activeElapsedMs &&
        activeElapsedMs <= segmentEndActiveElapsed
      ) {
        return segment.clockStartMs + activeElapsedMs - segment.activeElapsedStartMs;
      }
    }
    return this.nowSessionMs();
  }

  private startClockSegment(state: PerformanceRuntimeState, activeElapsedStartMs: number): ClockSegment {
    return this.startClockSegmentAt(state, activeElapsedStartMs, this.nowSessionMs());
  }

  private startClockSegmentAt(
    state: PerformanceRuntimeState,
    activeElapsedStartMs: number,
    clockStartMs: number
  ): ClockSegment {
    const segment = {
      state,
      clockStartMs,
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

  private nowSessionMs(): number {
    return this.timebase.runtimeToSessionTime(this.clock.nowMs()).ms;
  }
}

export class ContinuousPracticeSession {
  readonly clock: PerformanceClockRuntime;
  private readonly evaluator: ContinuousEvaluationSession;
  private readonly inputSource: PracticeInputSource;
  private syncedCompletionReason: LocalPracticeCompletionReason | null = null;

  constructor(options: ContinuousPracticeSessionOptions) {
    this.clock = new PerformanceClockRuntime(options);
    this.inputSource = options.inputSource ?? 'MICROPHONE';
    const tempoPlan = options.tempoPlan
      ?? resolvePracticeTempoPlan(options.artifact, options.tempoSelection ?? { mode: 'SCORE' });
    this.evaluator = new ContinuousEvaluationSession({
      artifact: options.artifact,
      timeline: new PerformanceTimeline(options.artifact, tempoPlan.segments),
      scope: options.scope,
    });
  }

  start(): PerformanceClockSnapshot {
    const snapshot = this.clock.start();
    return this.syncFromClockSnapshot(snapshot);
  }

  pause(): PerformanceClockSnapshot {
    const snapshot = this.clock.pause();
    return this.syncFromClockSnapshot(snapshot);
  }

  resume(): PerformanceClockSnapshot {
    const snapshot = this.clock.resume();
    return this.syncFromClockSnapshot(snapshot);
  }

  end(reason: LocalPracticeCompletionReason = 'STOPPED_BY_USER'): PerformanceClockSnapshot {
    const snapshot = this.clock.end(reason);
    return this.syncFromClockSnapshot(snapshot);
  }

  setMetronomeEnabled(enabled: boolean): void {
    this.clock.setMetronomeEnabled(enabled);
  }

  snapshot(): PerformanceClockSnapshot {
    const snapshot = this.clock.snapshot();
    return this.syncFromClockSnapshot(snapshot);
  }

  observeCapturedAttack(attack: CapturedAttack): boolean {
    this.clock.timebase.assertSameSessionTimeDomain(attack.captureTime, this.clock.timebase.atSessionMs(0));
    const performanceTimeMs = this.clock.performanceTimeAtCapture(attack.captureTime.ms);
    if (performanceTimeMs === null) {
      return false;
    }
    this.evaluator.observeAttack({
      observationId: `${attack.captureTime.domainId}:${attack.captureTime.ms}:${attack.pitch}`,
      pitch: attack.pitch,
      performanceTimeMs,
      confidence: attack.confidence,
      source: attack.source,
    });
    this.advanceMidiFrontier(this.clock.snapshot());
    return true;
  }

  publishAnalysis(publication: ContinuousAnalysisPublication): void {
    if (publication.sessionDomainId !== this.clock.timebase.domainId) {
      throw new ContinuousAnalysisPublicationDomainError();
    }
    for (const attack of publication.attacks) {
      if (attack.captureTime.domainId !== this.clock.timebase.domainId) {
        throw new ContinuousAnalysisPublicationDomainError(
          'Continuous analysis attack belongs to a different session domain.'
        );
      }
      if (attack.source === 'MIDI') {
        this.observeCapturedAttack(attack);
        continue;
      }
      const performanceTimeMs = this.clock.performanceTimeAtCapture(attack.captureTime.ms);
      if (performanceTimeMs === null) {
        continue;
      }
      this.evaluator.observeAttack({
        observationId: `${attack.captureTime.domainId}:${attack.captureTime.ms}:${attack.pitch}`,
        pitch: attack.pitch,
        performanceTimeMs,
        confidence: attack.confidence,
        source: attack.source,
      });
    }
    this.evaluator.advanceAnalysisThrough(publication.analyzedThroughPerformanceMs);
  }

  snapshotSession(): LocalPerformanceSessionSnapshot {
    return this.clock.snapshotSession();
  }

  completionCaptureTime(): SessionTime {
    return this.clock.completionCaptureTime();
  }

  completedEvaluation(): CompletedContinuousEvaluation {
    return this.evaluator.completedEvaluation();
  }

  get timebase(): PracticeTimebase {
    return this.clock.timebase;
  }

  get sessionCompletionReason(): LocalPracticeCompletionReason | null {
    return this.clock.sessionCompletionReason;
  }

  get evaluationSnapshot(): ContinuousEvaluationSnapshot {
    this.syncFromClockSnapshot(this.clock.snapshot());
    return this.evaluator.snapshot();
  }

  private syncFromClockSnapshot(snapshot: PerformanceClockSnapshot): PerformanceClockSnapshot {
    this.advanceMidiFrontier(snapshot);
    if (snapshot.state === 'ENDED' && snapshot.completionReason && this.syncedCompletionReason === null) {
      this.evaluator.complete({
        reason: snapshot.completionReason,
        performanceTimeMs: snapshot.performanceTimeMs,
        terminalPerformanceMs: this.clock.scopeDurationMs(),
      });
      this.syncedCompletionReason = snapshot.completionReason;
    }
    return snapshot;
  }

  private advanceMidiFrontier(snapshot: PerformanceClockSnapshot): void {
    if (this.inputSource === 'MIDI' && (snapshot.state === 'RUNNING' || snapshot.state === 'ENDED')) {
      this.evaluator.advanceAnalysisThrough(snapshot.performanceTimeMs);
    }
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
