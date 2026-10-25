import { ContinuousEvaluationSession } from '@/lib/practice/continuous/domain/evaluation/session';
import type { CompletedContinuousEvaluation, ContinuousEvaluationSnapshot, ContinuousEvidencePublication } from '@/lib/practice/continuous/domain/evaluation/types';
import { PerformanceClockRuntime, PerformanceTimeline, type PerformanceClockRuntimeOptions, type PerformanceClockSnapshot } from '@/lib/practice/continuous/domain/performance-clock';
import type { CapturedAttack } from '@/lib/practice/continuous/domain/session';
import { type LocalPerformanceSessionSnapshot } from '@/lib/practice/continuous/domain/session';
import { type LocalPracticeCompletionReason, type PracticeInputSource } from '@/lib/practice/kernel/session';
import { resolvePracticeTempoPlan } from '@/lib/practice/kernel/tempo';
import { PracticeTimebase, type SessionTime } from '@/lib/practice/kernel/timebase';

export type ContinuousClockEvidence = {
  observe(pitch: string, performanceTimeMs: number, confidence: number): void;
  advance(snapshot: PerformanceClockSnapshot): ContinuousEvidencePublication | null;
  complete(snapshot: PerformanceClockSnapshot): ContinuousEvidencePublication | null;
};

export type ContinuousPracticeSessionOptions = PerformanceClockRuntimeOptions & {
  createClockEvidence?: (sessionDomainId: string) => ContinuousClockEvidence;
};

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
  private readonly clockEvidence: ContinuousClockEvidence | null;

  constructor(options: ContinuousPracticeSessionOptions) {
    this.clock = new PerformanceClockRuntime(options);
    this.inputSource = options.inputSource ?? 'MICROPHONE';
    this.clockEvidence = this.inputSource === 'MIDI'
      ? options.createClockEvidence?.(this.clock.timebase.domainId) ?? null
      : null;
    if (this.inputSource === 'MIDI' && !this.clockEvidence) {
      throw new Error('MIDI sessions require a clock evidence input.');
    }
    const tempoPlan = options.tempoPlan
      ?? resolvePracticeTempoPlan(options.artifact, options.tempoSelection ?? { mode: 'SCORE' });
    this.evaluator = new ContinuousEvaluationSession({
      artifact: options.artifact,
      timeline: new PerformanceTimeline(options.artifact, tempoPlan.segments),
      scope: options.scope,
      sessionDomainId: this.clock.timebase.domainId,
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
    if (this.inputSource !== 'MIDI' || attack.source !== 'MIDI') {
      throw new Error('Captured attacks require the MIDI evidence boundary.');
    }
    this.clock.timebase.assertSameSessionTimeDomain(attack.captureTime, this.clock.timebase.atSessionMs(0));
    const beforeSnapshot = this.clock.snapshot();
    if (beforeSnapshot.state === 'ENDED') {
      return false;
    }
    const performanceTimeMs = this.clock.performanceTimeAtCapture(attack.captureTime.ms);
    if (performanceTimeMs === null) {
      return false;
    }
    this.clockEvidence!.observe(attack.pitch, performanceTimeMs, attack.confidence);
    this.advanceClockEvidence(this.clock.snapshot());
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
    const snapshot = this.clock.snapshot();
    if (snapshot.state === 'READY' || snapshot.state === 'COUNT_IN') {
      throw new Error('Continuous analysis publication requires captured performance evidence time.');
    }
    const maxAvailablePerformanceMs = this.maxAvailableAnalysisPerformanceTime(snapshot);
    if (publication.analyzedThroughPerformanceMs > maxAvailablePerformanceMs) {
      throw new Error('Continuous analysis frontier cannot advance beyond captured performance time.');
    }
    this.evaluator.publish(publication);
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
    if (snapshot.state === 'ENDED' && snapshot.completionReason && this.syncedCompletionReason === null) {
      this.publishClockEvidence(this.clockEvidence?.complete(snapshot) ?? null);
      this.evaluator.complete({
        reason: snapshot.completionReason,
        performanceTimeMs: snapshot.performanceTimeMs,
        availabilityTimeMs: snapshot.performanceTimeMs,
      });
      this.syncedCompletionReason = snapshot.completionReason;
      return snapshot;
    }
    this.advanceClockEvidence(snapshot);
    return snapshot;
  }

  private advanceClockEvidence(snapshot: PerformanceClockSnapshot): void {
    this.publishClockEvidence(this.clockEvidence?.advance(snapshot) ?? null);
  }

  private publishClockEvidence(publication: ContinuousEvidencePublication | null): void {
    if (publication) this.evaluator.publish(publication);
  }

  private maxAvailableAnalysisPerformanceTime(snapshot: PerformanceClockSnapshot): number {
    if (snapshot.state === 'READY' || snapshot.state === 'COUNT_IN') {
      return 0;
    }
    if (snapshot.state === 'ENDED' && snapshot.completionReason === 'SCOPE_COMPLETED') {
      return this.clock.scopeDurationMs();
    }
    return snapshot.performanceTimeMs;
  }
}
