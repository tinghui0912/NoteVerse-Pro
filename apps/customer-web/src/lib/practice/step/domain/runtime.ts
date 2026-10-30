import { isPracticePianoKey } from '@/lib/practice/kernel/piano-key';
import { assertPracticeScoreArtifact, type PracticeScoreArtifact } from '@/lib/practice/kernel/artifact';
import { resolvePracticeScope, type PracticeScope } from '@/lib/practice/kernel/scope';
import { createLocalSessionId, type LocalPracticeCompletionReason } from '@/lib/practice/kernel/session';
import type { PracticeTempoSelection } from '@/lib/practice/kernel/tempo';
import { PracticeTimebase, type DurableClock, type LocalClock, type SessionTime } from '@/lib/practice/kernel/timebase';
import { normalizePianoKeySet, pianoKeySetsEqual, STEP_RUNTIME_VERSION, StepDomainError, type StepPianoKeyEvidence, type StepAttemptIdentity, type StepAttemptRecord, type StepAttemptState, type StepTarget } from '@/lib/practice/step/domain/attempt';
import { type LocalStepSessionSnapshot, type StepRuntimeStatus } from '@/lib/practice/step/domain/session';
import { attackKeysForStep, continuationKeysForStep, groupForStep } from './target';

const STEP_MAX_RAW_ATTACK_KEY_ENTRIES = 128;

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
  private readonly inputSource: StepPracticeRuntimeOptions['inputSource'];
  private readonly resolvedScope;
  private readonly timebase: PracticeTimebase;
  private readonly createdAtMs: number;
  private currentIndex: number;
  private generation = 1;
  private boundary: Readonly<SessionTime>;
  private status: StepRuntimeStatus = 'ACTIVE';
  private completed = false;
  private completionReason: LocalPracticeCompletionReason | null = null;
  private attemptState: StepAttemptState = 'READY';
  private active: StepAttemptIdentity | null = null;
  private pendingPostVerdict: StepAttemptRecord | null = null;
  private sequence = 0;
  private inputAvailable = true;
  private metronomeEnabled: boolean;

  constructor(private readonly options: StepPracticeRuntimeOptions) {
    assertPracticeScoreArtifact(options.artifact); this.artifact = options.artifact;
    this.resolvedScope = resolvePracticeScope(this.artifact, options.scope);
    this.inputSource = options.inputSource;
    this.currentIndex = this.resolvedScope.startIndex;
    this.localSessionId = options.localSessionId ?? createLocalSessionId('step');
    this.timebase = options.timebase ?? new PracticeTimebase({ domainId: this.localSessionId });
    if (this.timebase.domainId !== this.localSessionId) throw new StepDomainError('STEP_ATTEMPT_EVIDENCE_INVALID');
    this.boundary = this.now(); this.createdAtMs = this.epoch();
    this.metronomeEnabled = options.metronomeEnabled ?? false;
  }
  currentTarget(): StepTarget | null {
    const step = this.artifact.practiceAttackSteps[this.currentIndex];
    if (!step || this.completed || this.status !== 'ACTIVE') return null;
    return Object.freeze({ stepId: step.stepId, targetGeneration: this.generation, inputEligibleAfter: this.boundary,
      attackKeys: Object.freeze(attackKeysForStep(step)), continuationKeys: Object.freeze(continuationKeysForStep(step)) });
  }
  openAttempt(start: SessionTime): StepAttemptIdentity | null {
    const target = this.currentTarget();
    if (!target || !this.canAcceptAttempt) return null;
    this.validateTime(start);
    // Input eligibility is exclusive: an event at the prior gesture end cannot be
    // rebound to a fresh attempt depending on timer/message callback order.
    if (start.ms <= this.boundary.ms) return null;
    this.active = Object.freeze({ attemptId: `${this.localSessionId}:attempt:${++this.sequence}`,
      localSessionId: this.localSessionId, stepId: target.stepId, targetGeneration: this.generation,
      inputSource: this.inputSource, attemptStartSessionTime: Object.freeze({ ...start }) });
    this.attemptState = 'CAPTURING'; return this.active;
  }
  analyzeAttempt(identity: StepAttemptIdentity): boolean {
    if (!this.owns(identity) || this.attemptState !== 'CAPTURING') return false;
    this.attemptState = 'ANALYZING'; return true;
  }
  completeAttempt(identity: StepAttemptIdentity, evidence: StepPianoKeyEvidence): StepAttemptCompletion {
    if (!this.owns(identity) || this.attemptState !== 'ANALYZING') return Object.freeze({ kind: 'REJECTED', reason: 'STALE_ATTEMPT' });
    this.validateTime(evidence.captureEndSessionTime);
    if (evidence.captureEndSessionTime.ms < identity.attemptStartSessionTime.ms) throw new StepDomainError('STEP_ATTEMPT_EVIDENCE_INVALID');
    if (!Number.isFinite(evidence.confidence) || evidence.confidence < 0 || evidence.confidence > 1
      || !Array.isArray(evidence.observedAttackKeys) || evidence.observedAttackKeys.length < 1
      || evidence.observedAttackKeys.length > STEP_MAX_RAW_ATTACK_KEY_ENTRIES) {
      throw new StepDomainError('STEP_ATTEMPT_EVIDENCE_INVALID');
    }
    const observed = evidence.observedAttackKeys;
    for (let index = 0; index < observed.length; index++) {
      if (!Object.hasOwn(observed, index)) throw new StepDomainError('STEP_ATTEMPT_EVIDENCE_INVALID');
      const pianoKey: unknown = observed[index];
      if (!isPracticePianoKey(pianoKey)) throw new StepDomainError('STEP_ATTEMPT_EVIDENCE_INVALID');
    }
    const normalized = normalizePianoKeySet(evidence.observedAttackKeys);
    const pianoKeys = Object.freeze([normalized[0], ...normalized.slice(1)] as const);
    const expected = this.currentTarget()!.attackKeys;
    const verdict = pianoKeySetsEqual(pianoKeys, expected) ? 'MATCH' : 'MISMATCH';
    const record: StepAttemptRecord = Object.freeze({ ...this.active!, verdict, observedAttackKeys: pianoKeys,
      confidence: evidence.confidence, captureEndSessionTime: Object.freeze({ ...evidence.captureEndSessionTime }) });
    this.active = null; this.attemptState = 'POST_VERDICT';
    this.pendingPostVerdict = record;
    this.boundary = record.captureEndSessionTime;
    return Object.freeze({ kind: 'FINALIZED', record });
  }
  rearm(acceptAfterSessionTime: SessionTime): void {
    if (this.status !== 'ACTIVE' || !this.inputAvailable || this.attemptState !== 'POST_VERDICT' || !this.pendingPostVerdict) throw new StepDomainError('STEP_ATTEMPT_STATE_INVALID');
    this.validateTime(acceptAfterSessionTime);
    if (acceptAfterSessionTime.ms < this.boundary.ms) throw new StepDomainError('STEP_ATTEMPT_EVIDENCE_INVALID');
    // The caller owns physical capture coverage, not model analysis coverage.
    // Busy-period source evidence cannot be
    // rebound merely because its publication arrives after this transition.
    this.boundary = Object.freeze({ ...acceptAfterSessionTime });
    const verdict = this.pendingPostVerdict.verdict;
    this.pendingPostVerdict = null;
    this.attemptState = 'READY';
    if (verdict === 'MATCH') this.advance();
  }
  private cancelAttempt(): void {
    // A finalized verdict is not an unfinished capture and cannot be cancelled by input loss.
    this.active = null;
    if (this.attemptState !== 'POST_VERDICT') this.attemptState = 'READY';
  }
  setInputUnavailable(): void {
    if (this.status !== 'ACTIVE') return;
    this.cancelAttempt(); this.inputAvailable = false;
  }
  acceptInputAfter(capturedThrough: SessionTime): void {
    if (this.status !== 'ACTIVE' || this.inputAvailable || this.active
      || (this.attemptState !== 'READY' && this.attemptState !== 'POST_VERDICT')) throw new StepDomainError('STEP_ATTEMPT_STATE_INVALID');
    this.validateTime(capturedThrough);
    if (capturedThrough.ms < this.boundary.ms) throw new StepDomainError('STEP_ATTEMPT_EVIDENCE_INVALID');
    this.boundary = Object.freeze({ ...capturedThrough }); this.inputAvailable = true;
  }
  skip(capturedThrough?: SessionTime): boolean {
    const target = this.currentTarget(); if (!target || !this.canAcceptAttempt) return false;
    // A physical input owner may retire capture at a different frontier than the live clock.
    // MIDI callers retain their existing clock-based transition.
    const skippedAt = Object.freeze({ ...(capturedThrough ?? this.now()) });
    this.validateTime(skippedAt);
    if (capturedThrough && skippedAt.ms < this.boundary.ms) throw new StepDomainError('STEP_ATTEMPT_EVIDENCE_INVALID');
    this.cancelAttempt();
    if (skippedAt.ms > this.boundary.ms) this.boundary = skippedAt;
    this.advance(); return true;
  }
  end(): void {
    if (this.status === 'ENDED') return;
    this.cancelAttempt(); this.status = 'ENDED'; this.completionReason = 'STOPPED_BY_USER';
  }
  snapshot(): LocalStepSessionSnapshot {
    return Object.freeze({ localSessionId: this.localSessionId, scoreId: this.artifact.scoreId, revisionId: this.artifact.revisionId,
      artifactId: this.artifact.artifactId, mode: 'STEP_BY_STEP', inputSource: this.inputSource,
      practiceScope: Object.freeze({ ...this.options.scope }), tempoSelection: Object.freeze({ ...(this.options.tempoSelection ?? { mode: 'SCORE' }) }),
      metronomeEnabled: this.metronomeEnabled, runtimeStatus: this.status, completionReason: this.completionReason,
      version: STEP_RUNTIME_VERSION, createdAtMs: this.createdAtMs, updatedAtMs: this.epoch(),
      step: Object.freeze({ currentIndex: this.currentIndex, targetGeneration: this.generation,
        inputEligibleAfter: this.boundary, inputAvailable: this.inputAvailable, completed: this.completed,
        attemptState: this.attemptState, activeAttempt: this.active, pendingPostVerdict: this.pendingPostVerdict,
        canAcceptAttempt: this.canAcceptAttempt }) });
  }
  setMetronomeEnabled(enabled: boolean): void { this.metronomeEnabled = enabled; }
  get currentStepIndex(): number { return this.currentIndex; }
  get currentOnsetBeat(): number { return this.artifact.practiceAttackSteps[this.currentIndex]?.onsetBeat ?? this.resolvedScope.terminalBeat; }
  get isCompleted(): boolean { return this.completed; }
  get state(): StepRuntimeStatus { return this.status; }
  get canAcceptAttempt(): boolean {
    return this.status === 'ACTIVE' && this.inputAvailable && this.attemptState === 'READY' && this.currentTarget() !== null;
  }
  private advance(): void {
    this.currentIndex++; this.generation++;
    if (this.currentIndex > this.resolvedScope.endIndex) {
      this.completed = true; this.status = 'ENDED'; this.completionReason = 'SCOPE_COMPLETED';
    }
  }
  private owns(identity: StepAttemptIdentity): boolean {
    return this.status === 'ACTIVE' && this.active !== null && identity.attemptId === this.active.attemptId
      && identity.localSessionId === this.localSessionId && identity.stepId === this.active.stepId
      && identity.targetGeneration === this.generation && identity.inputSource === this.inputSource
      && identity.attemptStartSessionTime.domainId === this.active.attemptStartSessionTime.domainId
      && identity.attemptStartSessionTime.ms === this.active.attemptStartSessionTime.ms;
  }
  private validateTime(time: SessionTime): void {
    if (!time || time.domainId !== this.localSessionId || !Number.isFinite(time.ms)) throw new StepDomainError('STEP_ATTEMPT_EVIDENCE_INVALID');
  }
  private now(): Readonly<SessionTime> { return Object.freeze(this.timebase.runtimeToSessionTime(this.options.clock.nowMs())); }
  private epoch(): number { return this.options.metadataClock?.nowEpochMs() ?? Date.now(); }
}
export function groupForCurrentStep(runtime: StepPracticeRuntime) {
  return runtime.isCompleted ? null : groupForStep(runtime.artifact, runtime.currentStepIndex);
}
