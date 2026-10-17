import { attackPitchesForStep, assertPracticeScoreArtifact, continuationPitchesForStep, groupForStep,
  resolvePracticeScope, type PracticeScoreArtifact, type PracticeScope } from './artifact';
import { normalizePitchSet, pitchSetsEqual } from './evidence';
import { PracticeTimebase, type LocalClock, type DurableClock, type SessionTime } from './timebase';
import { createLocalSessionId, type LocalPracticeCompletionReason, type LocalStepSessionSnapshot,
  type PracticeLifecycleState } from './session';
import type { PracticeTempoSelection } from './practice-tempo';
import { MAX_STEP_HISTORY_RECORDS, STEP_RUNTIME_VERSION, StepDomainError, type StepAttemptEvidence,
  type StepAttemptIdentity, type StepAttemptRecord, type StepAttemptState, type StepSkipRecord, type StepTarget } from './step-attempt';

export type StepPracticeRuntimeOptions = {
  artifact: PracticeScoreArtifact; scope: PracticeScope; inputSource: 'MICROPHONE' | 'MIDI';
  localSessionId?: string; clock: LocalClock; timebase?: PracticeTimebase; metadataClock?: DurableClock;
  tempoSelection?: PracticeTempoSelection; metronomeEnabled?: boolean;
};
export type StepAttemptCompletion = Readonly<{ kind: 'REJECTED'; reason: 'STALE_ATTEMPT' }>
  | Readonly<{ kind: 'FINALIZED'; record: StepAttemptRecord }>;

/** Pure target progression. No input acquisition, timers, or browser resources. */
export class StepPracticeRuntime {
  readonly artifact: PracticeScoreArtifact;
  readonly localSessionId: string;
  private readonly resolvedScope;
  private readonly timebase: PracticeTimebase;
  private readonly createdAtMs: number;
  private currentIndex: number;
  private generation = 1;
  private boundary: Readonly<SessionTime>;
  private lifecycle: PracticeLifecycleState = 'ACTIVE';
  private completed = false;
  private completionReason: LocalPracticeCompletionReason | null = null;
  private attemptState: StepAttemptState = 'READY';
  private active: StepAttemptIdentity | null = null;
  private sequence = 0;
  private readonly attempts: StepAttemptRecord[] = [];
  private readonly skips: StepSkipRecord[] = [];
  private metronomeEnabled: boolean;

  constructor(private readonly options: StepPracticeRuntimeOptions) {
    assertPracticeScoreArtifact(options.artifact); this.artifact = options.artifact;
    this.resolvedScope = resolvePracticeScope(this.artifact, options.scope);
    this.currentIndex = this.resolvedScope.startIndex;
    this.localSessionId = options.localSessionId ?? createLocalSessionId('step');
    this.timebase = options.timebase ?? new PracticeTimebase({ domainId: this.localSessionId });
    if (this.timebase.domainId !== this.localSessionId) throw new StepDomainError('STEP_ATTEMPT_EVIDENCE_INVALID');
    this.boundary = this.now(); this.createdAtMs = this.epoch();
    this.metronomeEnabled = options.metronomeEnabled ?? false;
  }
  currentTarget(): StepTarget | null {
    const step = this.artifact.practiceAttackSteps[this.currentIndex];
    if (!step || this.completed || this.lifecycle !== 'ACTIVE') return null;
    return Object.freeze({ stepId: step.stepId, activationGeneration: this.generation, activationBoundary: this.boundary,
      attackPitches: Object.freeze(attackPitchesForStep(step)), continuationPitches: Object.freeze(continuationPitchesForStep(step)) });
  }
  openAttempt(start: SessionTime): StepAttemptIdentity | null {
    const target = this.currentTarget();
    if (!target || this.attemptState !== 'READY') return null;
    this.validateTime(start);
    // Activation is exclusive: an event at the prior gesture end cannot be
    // rebound to a fresh attempt depending on timer/message callback order.
    if (start.ms <= this.boundary.ms) return null;
    this.assertHistoryRoom();
    this.active = Object.freeze({ attemptId: `${this.localSessionId}:attempt:${++this.sequence}`,
      localSessionId: this.localSessionId, stepId: target.stepId, activationGeneration: this.generation,
      inputSource: this.options.inputSource, attemptStartSessionTime: Object.freeze({ ...start }) });
    this.attemptState = 'CAPTURING'; return this.active;
  }
  analyzeAttempt(identity: StepAttemptIdentity): boolean {
    if (!this.owns(identity) || this.attemptState !== 'CAPTURING') return false;
    this.attemptState = 'ANALYZING'; return true;
  }
  completeAttempt(identity: StepAttemptIdentity, evidence: StepAttemptEvidence): StepAttemptCompletion {
    if (!this.owns(identity) || this.attemptState !== 'ANALYZING') return Object.freeze({ kind: 'REJECTED', reason: 'STALE_ATTEMPT' });
    this.validateTime(evidence.captureEndSessionTime);
    if (evidence.captureEndSessionTime.ms < identity.attemptStartSessionTime.ms) throw new StepDomainError('STEP_ATTEMPT_EVIDENCE_INVALID');
    if (evidence.kind === 'EVIDENCE' && (!Number.isFinite(evidence.confidence) || evidence.confidence < 0 || evidence.confidence > 1
      || evidence.observedAttackPitches.length > 128 || evidence.observedAttackPitches.some(p => !/^[A-G]#?-?\d$/.test(p)))) {
      throw new StepDomainError('STEP_ATTEMPT_EVIDENCE_INVALID');
    }
    if (evidence.kind === 'RETRY' && evidence.reason !== 'UNCERTAIN' && evidence.reason !== 'TOO_QUIET') throw new StepDomainError('STEP_ATTEMPT_EVIDENCE_INVALID');
    const pitches = Object.freeze(evidence.kind === 'EVIDENCE' ? normalizePitchSet(evidence.observedAttackPitches) : []);
    const verdict = evidence.kind === 'RETRY' ? 'RETRY' : pitchSetsEqual(pitches, this.currentTarget()!.attackPitches) ? 'MATCH' : 'MISMATCH';
    const record: StepAttemptRecord = Object.freeze({ ...this.active!, verdict, observedAttackPitches: pitches,
      confidence: evidence.kind === 'EVIDENCE' ? evidence.confidence : null,
      captureEndSessionTime: Object.freeze({ ...evidence.captureEndSessionTime }), retryReason: evidence.kind === 'RETRY' ? evidence.reason : null });
    this.attempts.push(record); this.active = null; this.attemptState = 'RESET';
    this.boundary = record.captureEndSessionTime;
    if (verdict === 'MATCH') this.advance();
    return Object.freeze({ kind: 'FINALIZED', record });
  }
  rearm(): void {
    if (this.lifecycle === 'ACTIVE' && this.attemptState === 'RESET') this.attemptState = 'READY';
  }
  cancelAttempt(): void { this.active = null; this.attemptState = 'READY'; }
  pause(): void {
    if (this.lifecycle !== 'ACTIVE') return;
    this.cancelAttempt(); this.lifecycle = 'PAUSED'; this.generation++;
  }
  resume(): void {
    if (this.lifecycle !== 'PAUSED') return;
    this.lifecycle = 'ACTIVE'; this.generation++; this.boundary = this.now(); this.attemptState = 'READY';
  }
  skip(): boolean {
    const target = this.currentTarget(); if (!target) return false;
    this.assertHistoryRoom(); this.cancelAttempt(); this.boundary = this.now();
    this.skips.push(Object.freeze({ stepId: target.stepId, activationGeneration: this.generation, sessionTime: this.boundary }));
    this.advance(); return true;
  }
  end(reason: LocalPracticeCompletionReason = 'STOPPED_BY_USER'): void {
    if (this.lifecycle === 'ENDED') return;
    this.cancelAttempt(); this.lifecycle = 'ENDED'; this.completionReason = reason; this.generation++;
  }
  snapshot(): LocalStepSessionSnapshot {
    return Object.freeze({ localSessionId: this.localSessionId, scoreId: this.artifact.scoreId, revisionId: this.artifact.revisionId,
      artifactId: this.artifact.artifactId, mode: 'STEP_BY_STEP', inputSource: this.options.inputSource,
      practiceScope: Object.freeze({ ...this.options.scope }), tempoSelection: Object.freeze({ ...(this.options.tempoSelection ?? { mode: 'SCORE' }) }),
      metronomeEnabled: this.metronomeEnabled, lifecycleState: this.lifecycle, completionReason: this.completionReason,
      version: STEP_RUNTIME_VERSION, createdAtMs: this.createdAtMs, updatedAtMs: this.epoch(),
      step: Object.freeze({ currentIndex: this.currentIndex, activationGeneration: this.generation, completed: this.completed,
        attemptState: this.attemptState, activeAttempt: this.active, attempts: Object.freeze([...this.attempts]), skips: Object.freeze([...this.skips]) }) });
  }
  setMetronomeEnabled(enabled: boolean): void { this.metronomeEnabled = enabled; }
  get currentStepIndex(): number { return this.currentIndex; }
  get currentOnsetBeat(): number { return this.artifact.practiceAttackSteps[this.currentIndex]?.onsetBeat ?? this.resolvedScope.terminalBeat; }
  get isCompleted(): boolean { return this.completed; }
  get state(): PracticeLifecycleState { return this.lifecycle; }
  private advance(): void {
    this.currentIndex++; this.generation++;
    if (this.currentIndex > this.resolvedScope.endIndex) { this.completed = true; this.end('SCOPE_COMPLETED'); }
  }
  private owns(identity: StepAttemptIdentity): boolean {
    return this.lifecycle === 'ACTIVE' && this.active !== null && identity.attemptId === this.active.attemptId
      && identity.localSessionId === this.localSessionId && identity.stepId === this.active.stepId
      && identity.activationGeneration === this.generation && identity.inputSource === this.options.inputSource
      && identity.attemptStartSessionTime.domainId === this.active.attemptStartSessionTime.domainId
      && identity.attemptStartSessionTime.ms === this.active.attemptStartSessionTime.ms;
  }
  private assertHistoryRoom(): void {
    if (this.attempts.length + this.skips.length >= MAX_STEP_HISTORY_RECORDS) {
      this.end(); throw new StepDomainError('STEP_HISTORY_LIMIT_EXCEEDED');
    }
  }
  private validateTime(time: SessionTime): void {
    if (time.domainId !== this.localSessionId || !Number.isFinite(time.ms)) throw new StepDomainError('STEP_ATTEMPT_EVIDENCE_INVALID');
  }
  private now(): Readonly<SessionTime> { return Object.freeze(this.timebase.runtimeToSessionTime(this.options.clock.nowMs())); }
  private epoch(): number { return this.options.metadataClock?.nowEpochMs() ?? Date.now(); }
}
export function groupForCurrentStep(runtime: StepPracticeRuntime) {
  return runtime.isCompleted ? null : groupForStep(runtime.artifact, runtime.currentStepIndex);
}
