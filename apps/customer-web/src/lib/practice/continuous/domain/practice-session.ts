import type { ContinuousPracticePlan } from "@/lib/practice/planning/practice-plan";
import { ContinuousEvaluationSession } from "@/lib/practice/continuous/domain/evaluation/session";
import type { CompletedContinuousEvaluation } from "@/lib/practice/continuous/domain/evaluation/evaluation-types";
import type { ContinuousTargetFeedback } from "./evaluation/target-feedback";
import type { ContinuousEvaluationSnapshot } from "@/lib/practice/continuous/domain/evaluation/evaluation-types";
import type { ContinuousEvidencePublication } from "@/lib/practice/continuous/domain/evaluation/evidence-types";
import {
  PerformanceClockRuntime,
  type PerformanceClockRuntimeOptions,
  type PerformanceClockSnapshot,
} from "@/lib/practice/continuous/domain/performance-clock";
import { type ContinuousPracticeSessionSnapshot } from "@/lib/practice/continuous/domain/session";
import {
  createLocalSessionId,
  type LocalPracticeCompletionReason,
} from "@/lib/practice/session/session";
import { PracticeTempoTimeline } from "@/lib/practice/planning/tempo";
import {
  PracticeTimebase,
  type DurableClock,
  type SessionTime,
} from "@/lib/practice/session/timebase";
import type {
  ContinuousClockDrivenEvidencePort,
  ContinuousMidiAttack,
} from "./clock-evidence-port";

export type ContinuousPracticeSessionOptions = {
  plan: ContinuousPracticePlan;
  clock: PerformanceClockRuntimeOptions["clock"];
  timebase?: PracticeTimebase;
  metadataClock?: DurableClock;
  localSessionId?: string;
  createClockEvidence?: (
    sessionDomainId: string,
  ) => ContinuousClockDrivenEvidencePort;
};

class ContinuousAnalysisPublicationDomainError extends Error {
  readonly code = "CONTINUOUS_ANALYSIS_PUBLICATION_DOMAIN_MISMATCH" as const;

  constructor(
    message = "Continuous analysis publication belongs to a different session domain.",
  ) {
    super(message);
    this.name = "ContinuousAnalysisPublicationDomainError";
  }
}

export class ContinuousPracticeSession {
  readonly clock: PerformanceClockRuntime;
  private readonly evaluator: ContinuousEvaluationSession;
  private get inputSource() {
    return this.plan.resources.input.kind;
  }
  private syncedCompletionReason: LocalPracticeCompletionReason | null = null;
  private readonly clockEvidence: ContinuousClockDrivenEvidencePort | null;
  readonly localSessionId: string;
  readonly plan: ContinuousPracticePlan;
  private readonly metadataClock: DurableClock;
  private readonly createdAtMs: number;
  private metronomeEnabled: boolean;

  constructor(options: ContinuousPracticeSessionOptions) {
    if (
      options.plan.resources.input.kind === "MIDI" &&
      typeof options.createClockEvidence !== "function"
    ) {
      throw new Error("MIDI sessions require a clock evidence input.");
    }
    if (
      options.plan.resources.input.kind === "MICROPHONE" &&
      options.createClockEvidence !== undefined
    ) {
      throw new Error(
        "Microphone sessions do not accept MIDI evidence ownership.",
      );
    }
    this.plan = options.plan;
    this.localSessionId = options.localSessionId ?? createLocalSessionId();
    const timebase =
      options.timebase ??
      new PracticeTimebase({ domainId: this.localSessionId });
    this.clock = new PerformanceClockRuntime({
      artifact: this.plan.source.artifact,
      scope: this.plan.scope,
      tempoPlan: this.plan.tempoPlan,
      clock: options.clock,
      timebase,
      countIn: this.plan.countIn,
    });
    this.metadataClock = options.metadataClock ?? {
      nowEpochMs: () => Date.now(),
    };
    this.createdAtMs = this.metadataClock.nowEpochMs();
    this.metronomeEnabled = options.plan.metronomePlan.initiallyEnabled;
    this.clockEvidence =
      options.plan.resources.input.kind === "MIDI"
        ? options.createClockEvidence!(this.clock.timebase.domainId)
        : null;
    if (options.plan.resources.input.kind === "MIDI" && !this.clockEvidence) {
      throw new Error("MIDI sessions require a clock evidence input.");
    }
    this.evaluator = new ContinuousEvaluationSession({
      artifact: this.plan.source.artifact,
      timeline: new PracticeTempoTimeline(
        this.plan.tempoPlan,
        this.plan.source.artifact.scoreEndTick,
        this.plan.source.artifact.ticksPerQuarter,
      ),
      scope: this.plan.scope,
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
  abandon(): PerformanceClockSnapshot {
    return this.clock.end("STOPPED_BY_USER");
  }

  end(
    reason: LocalPracticeCompletionReason = "STOPPED_BY_USER",
  ): PerformanceClockSnapshot {
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
    if (this.inputSource !== "MIDI") {
      throw new Error("MIDI attacks require the MIDI evidence boundary.");
    }
    this.clock.timebase.assertSameSessionTimeDomain(
      attack.captureTime,
      this.clock.timebase.atSessionMs(0),
    );
    const beforeSnapshot = this.advanceToNow();
    if (beforeSnapshot.state === "ENDED") {
      return false;
    }
    const performanceTimeMs = this.clock.performanceTimeAtCapture(
      attack.captureTime.ms,
    );
    if (performanceTimeMs === null) {
      return false;
    }
    this.clockEvidence!.observe(
      attack.pianoKey,
      performanceTimeMs,
      attack.confidence,
      beforeSnapshot.performanceTimeMs,
    );
    return true;
  }

  publishAnalysis(publication: ContinuousEvidencePublication): void {
    if (this.inputSource === "MIDI")
      throw new Error("MIDI coverage is owned by the local clock adapter.");
    if (publication.sessionDomainId !== this.clock.timebase.domainId) {
      throw new ContinuousAnalysisPublicationDomainError();
    }
    if (
      !Number.isFinite(publication.analyzedThroughPerformanceMs) ||
      publication.analyzedThroughPerformanceMs < 0 ||
      publication.analyzedThroughPerformanceMs > this.clock.scopeDurationMs()
    ) {
      throw new Error(
        "Continuous analysis frontier must be finite, non-negative, and within the resolved scope.",
      );
    }
    const snapshot = this.clock.advanceToNow();
    if (
      snapshot.state === "READY" ||
      (snapshot.state === "COUNT_IN" && snapshot.countInKind === "INITIAL")
    ) {
      throw new Error(
        "Continuous analysis publication requires captured performance evidence time.",
      );
    }
    const maxAvailablePerformanceMs =
      this.maxAvailableAnalysisPerformanceTime(snapshot);
    if (publication.analyzedThroughPerformanceMs > maxAvailablePerformanceMs) {
      throw new Error(
        "Continuous analysis frontier cannot advance beyond captured performance time.",
      );
    }
    this.evaluator.publish(publication);
  }

  snapshotSession(): ContinuousPracticeSessionSnapshot {
    const nowMs = this.metadataClock.nowEpochMs();
    const timing = this.clock.transportSnapshot();
    return {
      localSessionId: this.localSessionId,
      plan: this.plan,
      lifecycleState:
        timing.state === "ENDED"
          ? "ENDED"
          : timing.state === "PAUSED"
            ? "PAUSED"
            : "ACTIVE",
      completionReason: this.clock.terminationReason,
      createdAtMs: this.createdAtMs,
      updatedAtMs: nowMs,
      performance: {
        metronomeEnabled: this.metronomeEnabled,
        state: timing.state,
        stateBeforePause: timing.stateBeforePause,
        activeElapsedMs: timing.activeElapsedMs,
        countInMs: timing.countInMs,
        countInTicks: timing.countInTicks,
        countInPulses: timing.countInPulses,
      },
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

  get targetFeedback(): ContinuousTargetFeedback {
    return this.evaluator.targetFeedback();
  }

  get evaluationSnapshot(): ContinuousEvaluationSnapshot {
    return this.evaluator.snapshot();
  }

  private syncFromClockSnapshot(
    snapshot: PerformanceClockSnapshot,
  ): PerformanceClockSnapshot {
    this.advanceClockEvidence(snapshot);
    if (
      snapshot.state === "ENDED" &&
      snapshot.completionReason &&
      this.syncedCompletionReason === null
    ) {
      const availabilitySessionTimeMs =
        this.clockEvidence && snapshot.completionReason === "SCOPE_COMPLETED"
          ? this.clock.completionCaptureTime().ms
          : snapshot.nowMs;
      this.publishClockEvidence(
        this.clockEvidence?.complete(
          snapshot.performanceTimeMs,
          availabilitySessionTimeMs,
        ) ?? null,
      );
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
    if (
      !this.clockEvidence ||
      snapshot.state === "READY" ||
      this.syncedCompletionReason !== null
    )
      return;
    for (;;) {
      const deadline = this.clockEvidence.nextDeadline(
        this.evaluator.nextRequiredAnalysisFrontier(),
      );
      if (
        !deadline ||
        deadline.duePerformanceTimeMs > snapshot.performanceTimeMs
      )
        return;
      const available = this.clock.sessionTimeAtReachedPerformance(
        deadline.duePerformanceTimeMs,
      );
      if (!available)
        throw new Error("MIDI_COVERAGE_CLOCK_MAPPING_UNAVAILABLE");
      const publication = this.clockEvidence.cover(
        deadline.analyzedThroughPerformanceMs,
        available.ms,
      );
      if (!publication)
        throw new Error("MIDI_COVERAGE_DEADLINE_DID_NOT_ADVANCE");
      this.publishClockEvidence(publication);
    }
  }

  private publishClockEvidence(
    publication: ContinuousEvidencePublication | null,
  ): void {
    if (publication) this.evaluator.publish(publication);
  }

  private maxAvailableAnalysisPerformanceTime(
    snapshot: PerformanceClockSnapshot,
  ): number {
    if (
      snapshot.state === "READY" ||
      (snapshot.state === "COUNT_IN" && snapshot.countInKind === "INITIAL")
    ) {
      return 0;
    }
    if (
      snapshot.state === "ENDED" &&
      snapshot.completionReason === "SCOPE_COMPLETED"
    ) {
      return this.clock.scopeDurationMs();
    }
    return snapshot.performanceTimeMs;
  }
}
