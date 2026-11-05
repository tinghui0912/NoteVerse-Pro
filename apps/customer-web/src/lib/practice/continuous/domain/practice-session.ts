import { ContinuousEvaluationSession } from '@/lib/practice/continuous/domain/evaluation/session';
import type { CompletedContinuousEvaluation } from '@/lib/practice/continuous/domain/evaluation/evaluation-types';
import type { ContinuousTargetFeedback } from './evaluation/target-feedback';
import type { ContinuousEvaluationSnapshot } from '@/lib/practice/continuous/domain/evaluation/evaluation-types';
import type { ContinuousEvidencePublication } from '@/lib/practice/continuous/domain/evaluation/evidence-types';
import { PerformanceClockRuntime, type PerformanceClockRuntimeOptions, type PerformanceClockSnapshot } from '@/lib/practice/continuous/domain/performance-clock';
import { type LocalPerformanceSessionSnapshot } from '@/lib/practice/continuous/domain/session';
import { createLocalSessionId, type LocalPracticeCompletionReason, type PracticeInputSource } from '@/lib/practice/kernel/session';
import { PracticeTempoTimeline, type ResolvedPracticeTempoPlan } from '@/lib/practice/kernel/tempo';
import { PracticeTimebase, type DurableClock, type RuntimeVersionIdentity, type SessionTime } from '@/lib/practice/kernel/timebase';
import type { ContinuousClockDrivenEvidencePort, ContinuousMidiAttack } from './clock-evidence-port';

type ContinuousSessionConfiguration = Omit<PerformanceClockRuntimeOptions, 'timebase'> & {
  timebase?: PracticeTimebase;
  sourceId: string;
  metadataClock?: DurableClock;
  localSessionId?: string;
  version?: RuntimeVersionIdentity;
  metronomeEnabled?: boolean;
};

export type ContinuousPracticeSessionOptions = ContinuousSessionConfiguration & (
  | { inputSource: 'MIDI'; createClockEvidence: (sessionDomainId: string) => ContinuousClockDrivenEvidencePort }
  | { inputSource: 'MICROPHONE'; createClockEvidence?: never }
);

class ContinuousAnalysisPublicationDomainError extends Error {
  readonly code = 'CONTINUOUS_ANALYSIS_PUBLICATION_DOMAIN_MISMATCH' as const;

  constructor(message = 'Continuous analysis publication belongs to a different session domain.') {
    super(message);
    this.name = 'ContinuousAnalysisPublicationDomainError';
  }
}

export class ContinuousPracticeSession {
  readonly clock: PerformanceClockRuntime;
  private readonly evaluator: ContinuousEvaluationSession;
  private readonly inputSource: PracticeInputSource;
  private syncedCompletionReason: LocalPracticeCompletionReason | null = null;
  private readonly clockEvidence: ContinuousClockDrivenEvidencePort | null;
  readonly localSessionId: string;
  private readonly artifact: PerformanceClockRuntimeOptions['artifact'];
  private readonly practiceScope: PerformanceClockRuntimeOptions['scope'];
  private readonly metadataClock: DurableClock;
  private readonly version: RuntimeVersionIdentity;
  private readonly createdAtMs: number;
  private readonly tempoPlan: ResolvedPracticeTempoPlan;
  private readonly sourceId: string;
  private metronomeEnabled: boolean;

  constructor(options: ContinuousPracticeSessionOptions) {
    if (options.inputSource === 'MIDI' && typeof options.createClockEvidence !== 'function') {
      throw new Error('MIDI sessions require a clock evidence input.');
    }
    if (options.inputSource === 'MICROPHONE' && options.createClockEvidence !== undefined) {
      throw new Error('Microphone sessions do not accept MIDI evidence ownership.');
    }
    this.artifact = options.artifact;
    this.tempoPlan = options.tempoPlan;
    this.sourceId = options.sourceId;
    this.localSessionId = options.localSessionId ?? createLocalSessionId();
    const timebase = options.timebase ?? new PracticeTimebase({ domainId: this.localSessionId });
    this.clock = new PerformanceClockRuntime({
      artifact: options.artifact, scope: options.scope, tempoPlan: this.tempoPlan,
      clock: options.clock, timebase, countInTicks: options.countInTicks,
    });
    this.practiceScope = options.scope;
    this.metadataClock = options.metadataClock ?? { nowEpochMs: () => Date.now() };
    this.version = options.version ?? { schemaVersion: 1, runtimeVersion: 'local-practice-core-v1' };
    this.createdAtMs = this.metadataClock.nowEpochMs();
    this.metronomeEnabled = options.metronomeEnabled ?? false;
    this.inputSource = options.inputSource;
    this.clockEvidence = options.inputSource === 'MIDI'
      ? options.createClockEvidence(this.clock.timebase.domainId)
      : null;
    if (options.inputSource === 'MIDI' && !this.clockEvidence) {
      throw new Error('MIDI sessions require a clock evidence input.');
    }
    this.evaluator = new ContinuousEvaluationSession({
      artifact: options.artifact,
      timeline: new PracticeTempoTimeline(this.tempoPlan, options.artifact.scoreEndTick, options.artifact.ticksPerQuarter),
      scope: options.scope,
      sessionDomainId: this.clock.timebase.domainId,
      inputSource: this.inputSource,
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

  /** Discard transport without publishing terminal evidence for an unwanted result. */
  abandon(): PerformanceClockSnapshot { return this.clock.end('STOPPED_BY_USER'); }

  end(reason: LocalPracticeCompletionReason = 'STOPPED_BY_USER'): PerformanceClockSnapshot {
    this.clock.advanceToNow();
    const snapshot = this.clock.end(reason);
    return this.syncFromClockSnapshot(snapshot);
  }

  setMetronomeEnabled(enabled: boolean): void {
    this.metronomeEnabled = enabled;
  }

  snapshot(): PerformanceClockSnapshot {
    return this.clock.snapshot();
  }

  /** Materialize reached semantic coverage deadlines independently of caller cadence. */
  advanceToNow(): PerformanceClockSnapshot {
    return this.syncFromClockSnapshot(this.clock.advanceToNow());
  }

  observeMidiAttack(attack: ContinuousMidiAttack): boolean {
    if (this.inputSource !== 'MIDI') {
      throw new Error('MIDI attacks require the MIDI evidence boundary.');
    }
    this.clock.timebase.assertSameSessionTimeDomain(attack.captureTime, this.clock.timebase.atSessionMs(0));
    const beforeSnapshot = this.advanceToNow();
    if (beforeSnapshot.state === 'ENDED') {
      return false;
    }
    const performanceTimeMs = this.clock.performanceTimeAtCapture(attack.captureTime.ms);
    if (performanceTimeMs === null) {
      return false;
    }
    this.clockEvidence!.observe(attack.pianoKey, performanceTimeMs, attack.confidence, beforeSnapshot.performanceTimeMs);
    return true;
  }

  publishAnalysis(publication: ContinuousEvidencePublication): void {
    if (this.inputSource === 'MIDI') throw new Error('MIDI coverage is owned by the local clock adapter.');
    if (publication.sessionDomainId !== this.clock.timebase.domainId) {
      throw new ContinuousAnalysisPublicationDomainError();
    }
    if (
      !Number.isFinite(publication.analyzedThroughPerformanceMs)
      || publication.analyzedThroughPerformanceMs < 0
      || publication.analyzedThroughPerformanceMs > this.clock.scopeDurationMs()
    ) {
      throw new Error('Continuous analysis frontier must be finite, non-negative, and within the resolved scope.');
    }
    const snapshot = this.clock.advanceToNow();
    if (snapshot.state === 'READY' || snapshot.state === 'COUNT_IN' && snapshot.countInKind === 'INITIAL') {
      throw new Error('Continuous analysis publication requires captured performance evidence time.');
    }
    const maxAvailablePerformanceMs = this.maxAvailableAnalysisPerformanceTime(snapshot);
    if (publication.analyzedThroughPerformanceMs > maxAvailablePerformanceMs) {
      throw new Error('Continuous analysis frontier cannot advance beyond captured performance time.');
    }
    this.evaluator.publish(publication);
  }

  snapshotSession(): LocalPerformanceSessionSnapshot {
    const nowMs = this.metadataClock.nowEpochMs();
    const timing = this.clock.transportSnapshot();
    return {
      localSessionId: this.localSessionId,
      scoreId: this.artifact.scoreId,
      revisionId: this.artifact.revisionId,
      artifactId: this.artifact.artifactId,
      mode: 'CONTINUOUS_PLAY',
      inputSource: this.inputSource,
      sourceId: this.sourceId, scope: this.practiceScope,
      tempoPlan: this.tempoPlan,
      metronomeEnabled: this.metronomeEnabled,
      lifecycleState: timing.state === 'ENDED' ? 'ENDED' : timing.state === 'PAUSED' ? 'PAUSED' : 'ACTIVE',
      completionReason: this.clock.terminationReason,
      version: this.version,
      createdAtMs: this.createdAtMs,
      updatedAtMs: nowMs,
      performance: { state: timing.state, stateBeforePause: timing.stateBeforePause,
        activeElapsedMs: timing.activeElapsedMs, countInMs: timing.countInMs,
        countInTicks: timing.countInTicks, countInPulses: timing.countInPulses },
    };
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
    return this.clock.terminationReason;
  }

  get targetFeedback(): ContinuousTargetFeedback { return this.evaluator.targetFeedback(); }

  get evaluationSnapshot(): ContinuousEvaluationSnapshot {
    return this.evaluator.snapshot();
  }

  private syncFromClockSnapshot(snapshot: PerformanceClockSnapshot): PerformanceClockSnapshot {
    this.advanceClockEvidence(snapshot);
    if (snapshot.state === 'ENDED' && snapshot.completionReason && this.syncedCompletionReason === null) {
      const availabilitySessionTimeMs = this.clockEvidence && snapshot.completionReason === 'SCOPE_COMPLETED'
        ? this.clock.completionCaptureTime().ms : snapshot.nowMs;
      this.publishClockEvidence(this.clockEvidence?.complete(snapshot.performanceTimeMs, availabilitySessionTimeMs) ?? null);
      this.evaluator.complete({
        reason: snapshot.completionReason,
        performanceTimeMs: snapshot.performanceTimeMs,
        availabilitySessionTimeMs,
      });
      this.syncedCompletionReason = snapshot.completionReason;
      return snapshot;
    }
    return snapshot;
  }

  private advanceClockEvidence(snapshot: PerformanceClockSnapshot): void {
    if (!this.clockEvidence || snapshot.state === 'READY' || this.syncedCompletionReason !== null) return;
    for (;;) {
      const deadline = this.clockEvidence.nextDeadline(this.evaluator.nextRequiredAnalysisFrontier());
      if (!deadline || deadline.duePerformanceTimeMs > snapshot.performanceTimeMs) return;
      const available = this.clock.sessionTimeAtReachedPerformance(deadline.duePerformanceTimeMs);
      if (!available) throw new Error('MIDI_COVERAGE_CLOCK_MAPPING_UNAVAILABLE');
      const publication = this.clockEvidence.cover(deadline.analyzedThroughPerformanceMs, available.ms);
      if (!publication) throw new Error('MIDI_COVERAGE_DEADLINE_DID_NOT_ADVANCE');
      this.publishClockEvidence(publication);
    }
  }

  private publishClockEvidence(publication: ContinuousEvidencePublication | null): void {
    if (publication) this.evaluator.publish(publication);
  }

  private maxAvailableAnalysisPerformanceTime(snapshot: PerformanceClockSnapshot): number {
    if (snapshot.state === 'READY' || snapshot.state === 'COUNT_IN' && snapshot.countInKind === 'INITIAL') {
      return 0;
    }
    if (snapshot.state === 'ENDED' && snapshot.completionReason === 'SCOPE_COMPLETED') {
      return this.clock.scopeDurationMs();
    }
    return snapshot.performanceTimeMs;
  }
}
