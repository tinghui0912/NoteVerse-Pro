import { DeviceFailure, MidiFailure, isPracticeCausalFailure } from '@/lib/practice/failure/causal-failure';
import { projectStepFailure, type StepApplicationErrorCode } from '@/lib/practice/step/step-errors';
import { projectContinuousFailure, type ContinuousErrorCode } from '@/lib/practice/continuous/continuous-errors';
import { StepPracticeController, type StepControllerOptions } from '@/lib/practice/step/step-practice-controller';
import { ContinuousPracticeController, type ContinuousControllerOptions } from '@/lib/practice/continuous/continuous-practice-controller';
import { browserStepPlatform } from '@/lib/practice/step/step-platform';
import { browserContinuousPlatform } from '@/lib/practice/continuous/continuous-platform';
import type { ContinuousPracticeCompletion } from '@/lib/practice/continuous/completion';
import { projectPracticeMomentView } from '@/lib/practice/score-view/moment-view';
import { PracticeStartupTimings } from '@/lib/practice/diagnostics/startup-timings';
import type { PracticePlan } from '@/lib/practice/planning/practice-plan';
import type { PracticeDeviceRoots, PracticeRootHealthPort } from '@/lib/practice/device/device-contract';
import type { AcousticInferencePort } from '@/lib/practice/acoustic/runtime/inference-types';
import type { StepPracticeSessionSnapshot } from '@/lib/practice/step/domain/session';
import type { ContinuousPracticeSessionSnapshot } from '@/lib/practice/continuous/domain/session';
import type { LocalPracticeInputState } from '@/lib/practice/input-state';

export type PracticeExecutionLifecycle = 'READY' | 'PREPARING' | 'ACTIVE' | 'PAUSED' | 'FINALIZING' | 'COMPLETED' | 'ERROR';
type StepController = Pick<StepPracticeController, 'start' | 'dispose' | 'abandon' | 'subscribe' | 'snapshot' | 'skip' | 'setMetronomeEnabled'>;
type ContinuousController = Pick<ContinuousPracticeController, 'start' | 'dispose' | 'abandon' | 'subscribe' | 'snapshot'
  | 'pause' | 'resume' | 'continueWithoutAnalysis' | 'continueWithoutRecording' | 'continueAfterRecovery' | 'setMetronomeEnabled'>;
export type PracticeExecutionPorts = Readonly<{
  borrowRoots(): PracticeDeviceRoots | null;
  rootHealth: PracticeRootHealthPort;
  acquireInference?: (signal: AbortSignal) => Promise<AcousticInferencePort>;
}>;
export type PracticeExecutionFactories = Readonly<{
  step(options: StepControllerOptions, acquire?: PracticeExecutionPorts['acquireInference']): StepController;
  continuous(options: ContinuousControllerOptions, acquire?: PracticeExecutionPorts['acquireInference']): ContinuousController;
}>;
const browserFactories: PracticeExecutionFactories = {
  step: (options, acquire) => new StepPracticeController({ ...options, platform: browserStepPlatform(acquire) }),
  continuous: (options, acquire) => new ContinuousPracticeController(options, browserContinuousPlatform(acquire)),
};
type Owned = ({ mode: 'STEP_BY_STEP'; controller: StepController } | { mode: 'CONTINUOUS_PLAY'; controller: ContinuousController }) & {
  plan: PracticePlan; token: number; preparation: Promise<void>; detach: () => void; completed: boolean;
};
type CommonView = Readonly<{
  lifecycle: PracticeExecutionLifecycle; inputState: LocalPracticeInputState;
  executedPlan: PracticePlan | null; canStart: boolean;
}>;
type StepView = CommonView & Readonly<{
  completion: null;
  mode: 'STEP_BY_STEP'; inputError: StepApplicationErrorCode | null;
  activeStepGroup: ReturnType<typeof projectPracticeMomentView> | null;
  stepInteractionPhase: ReturnType<StepController['snapshot']>['stepInteractionPhase'];
  pendingPostVerdict: ReturnType<StepController['snapshot']>['pendingPostVerdict'];
  canAcceptAttempt: boolean;
  analysisIntervention: ReturnType<StepController['snapshot']>['analysisIntervention'];
  infrastructureIntervention: ReturnType<StepController['snapshot']>['infrastructureIntervention'];
  performanceClock: null; performanceEvaluation: null; recordingIndicator: null;
}>;
type ContinuousView = CommonView & Readonly<{
  completion: ContinuousPracticeCompletion | null;
  mode: 'CONTINUOUS_PLAY'; inputError: ContinuousErrorCode | null; activeStepGroup: null;
  performanceClock: ReturnType<ContinuousController['snapshot']>['transport'];
  performanceEvaluation: ReturnType<ContinuousController['snapshot']>['evaluation'];
  recordingIndicator: number | null;
  analysisIntervention: ReturnType<ContinuousController['snapshot']>['analysisIntervention'];
  resourceIntervention: ReturnType<ContinuousController['snapshot']>['resourceIntervention'];
}>;
export type PracticeExecutionView = StepView | ContinuousView;
type Completion = StepPracticeSessionSnapshot | ContinuousPracticeSessionSnapshot;

/** Owns one explicitly started attempt and serializes its complete release before another construction. */
type ApplicationFailure = { mode: 'STEP_BY_STEP'; code: StepApplicationErrorCode } | { mode: 'CONTINUOUS_PLAY'; code: ContinuousErrorCode };
export type PracticeExecutionErrorCode = StepApplicationErrorCode | ContinuousErrorCode;

export class PracticeExecutionOwner {
  private candidate: PracticePlan | null = null;
  private admitted = false;
  private composition: string | null = null;
  private owned: Owned | null = null;
  private startingPlan: PracticePlan | null = null;
  private generation = 0;
  private disposed = false;
  private pendingStart: Promise<void> | null = null;
  private pendingRetry: Promise<void> | null = null;
  private released: Promise<void> = Promise.resolve();
  private releaseFailure: ApplicationFailure | null = null;
  private error: ApplicationFailure | null = null;
  private failureCause: unknown = null;
  private completionListener: ((snapshot: Completion) => void) | undefined;
  private readonly listeners = new Set<() => void>();
  private view: PracticeExecutionView;
  constructor(private readonly ports: PracticeExecutionPorts, private readonly factories = browserFactories) {
    this.view = this.project();
  }
  snapshot = (): PracticeExecutionView => this.view;
  engineeringSnapshot() { return { failureCause: this.failureCause }; }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  setCompletionListener(listener: ((snapshot: Completion) => void) | undefined): void { this.completionListener = listener; }
  setCandidate(plan: PracticePlan | null, admitted: boolean, composition: string): void {
    if (this.disposed || this.candidate === plan && this.admitted === admitted && this.composition === composition) return;
    const replacement = this.composition !== null && this.composition !== composition;
    this.composition = composition; this.candidate = plan; this.admitted = admitted;
    if (replacement) { void this.end(); return; }
    if (!this.owned && !this.startingPlan) this.publish();
  }
  start(): Promise<void> {
    if (this.pendingStart) return this.pendingStart;
    if (this.disposed || this.owned || !this.candidate || !this.admitted || this.releaseFailure) return Promise.resolve();
    const plan = this.candidate, token = ++this.generation;
    this.startingPlan = plan; this.error = null; this.publish();
    const operation = this.begin(plan, token); this.pendingStart = operation;
    return operation;
  }
  private async begin(plan: PracticePlan, token: number): Promise<void> {
    const startupTimings = new PracticeStartupTimings();
    try {
      await startupTimings.measure('waitPreviousRelease', () => this.released);
      if (!this.current(token)) return;
      if (this.releaseFailure) { this.error = this.releaseFailure; return; }
      if (!this.admitted) throw plan.resources.input.kind === 'MIDI' ? new MidiFailure('ACCESS_UNAVAILABLE') : new DeviceFailure('UNAVAILABLE', 'MICROPHONE');
      const devices = this.ports.borrowRoots();
      if (!devices) throw plan.resources.input.kind === 'MIDI' ? new MidiFailure('ACCESS_UNAVAILABLE') : new DeviceFailure('UNAVAILABLE', 'MICROPHONE');
      const completed = (snapshot: Completion) => this.complete(token, snapshot);
      const shared = { devices, rootHealth: this.ports.rootHealth, startupTimings, onNaturalCompletion: completed };
      const selected = plan.mode === 'STEP_BY_STEP'
        ? { mode: plan.mode, controller: this.factories.step({ ...shared, plan }, this.ports.acquireInference) } as const
        : { mode: plan.mode, controller: this.factories.continuous({ ...shared, plan }, this.ports.acquireInference) } as const;
      const owned: Owned = { ...selected, plan, token, preparation: Promise.resolve(), detach: () => {}, completed: false };
      this.owned = owned;
      owned.detach = owned.controller.subscribe(() => { if (this.current(token) && this.owned === owned) this.publish(); });
      owned.preparation = owned.controller.start(); this.publish();
      await owned.preparation;
      if (this.current(token) && this.owned === owned) this.publish();
    } catch (failure) {
      if (this.current(token)) {
        this.failureCause = failure;
        this.error = plan.mode === 'STEP_BY_STEP'
          ? { mode: plan.mode, code: isPracticeCausalFailure(failure) ? projectStepFailure(failure, 'PREPARING') : 'STEP_ATTEMPT_FAILED' }
          : { mode: plan.mode, code: isPracticeCausalFailure(failure) ? projectContinuousFailure(failure, 'PREPARING') : 'ANALYSIS_FAILED' };
      }
    } finally {
      if (this.current(token)) { this.startingPlan = null; this.pendingStart = null; this.publish(); }
    }
  }
  private complete(token: number, snapshot: Completion): void {
    const owned = this.owned;
    if (!this.current(token) || !owned || owned.token !== token || owned.completed || snapshot.completionReason !== 'SCOPE_COMPLETED') return;
    if (owned.mode === 'CONTINUOUS_PLAY') {
      const completion = owned.controller.snapshot().completed;
      if (!completion) throw new Error('Continuous completion is unavailable.');
    }
    owned.completed = true;
    this.publish(); this.completionListener?.(snapshot);
  }
  /** Detach/fence immediately; cleanup may settle asynchronously while READY waits for release. */
  end(): Promise<void> {
    ++this.generation;
    const owned = this.owned, starting = this.pendingStart;
    this.owned = null; this.startingPlan = null; this.pendingStart = null;
    this.error = null;
    if (owned) {
      owned.detach();
      const settle = (action: () => void | Promise<void>) => { try { return Promise.resolve(action()); } catch (error) { return Promise.reject(error); } };
      const abandoned = settle(() => owned.controller.abandon()), disposed = settle(() => owned.controller.dispose());
      this.released = Promise.all([this.released, abandoned, disposed, owned.preparation, starting]).then(() => {
        const state = owned.controller.snapshot();
        const failure = owned.mode === 'STEP_BY_STEP' ? (state as ReturnType<StepController['snapshot']>).error
          : (state as ReturnType<ContinuousController['snapshot']>).inputError;
        if (failure === 'STEP_RESOURCE_CLEANUP_FAILED' || failure === 'RESOURCE_CLEANUP_FAILED') throw new Error(failure);
      }).catch(cause => {
        this.failureCause = cause;
        this.releaseFailure = owned.mode === 'STEP_BY_STEP' ? { mode: owned.mode, code: 'STEP_RESOURCE_CLEANUP_FAILED' }
          : { mode: owned.mode, code: 'RESOURCE_CLEANUP_FAILED' };
        this.error = this.releaseFailure; this.publish();
      });
    } else if (starting) this.released = Promise.all([this.released, starting]).then(() => {});
    this.publish(); return this.released;
  }
  retry(): Promise<void> {
    if (this.pendingRetry) return this.pendingRetry;
    if (!this.owned?.completed || !this.admitted || this.disposed) return Promise.resolve();
    void this.end();
    const retry = this.start(); this.pendingRetry = retry;
    void retry.finally(() => { if (this.pendingRetry === retry) this.pendingRetry = null; });
    return retry;
  }
  setMetronomeEnabled(enabled: boolean): void { this.owned?.controller.setMetronomeEnabled(enabled); this.publish(); }
  skip(): void { if (this.owned?.mode === 'STEP_BY_STEP') this.owned.controller.skip(); }
  pause(): void { if (this.owned?.mode === 'CONTINUOUS_PLAY') this.owned.controller.pause(); }
  resume(): void { if (this.owned?.mode === 'CONTINUOUS_PLAY') this.owned.controller.resume(); }
  continueWithoutAnalysis(): Promise<void> { return this.owned?.mode === 'CONTINUOUS_PLAY' ? this.owned.controller.continueWithoutAnalysis() : Promise.resolve(); }
  continueWithoutRecording(): void { if (this.owned?.mode === 'CONTINUOUS_PLAY') this.owned.controller.continueWithoutRecording(); }
  continueAfterRecovery(): boolean { return this.owned?.mode === 'CONTINUOUS_PLAY' && this.owned.controller.continueAfterRecovery(); }
  dispose(): Promise<void> { this.disposed = true; this.completionListener = undefined; const released = this.end(); this.listeners.clear(); return released; }
  private current(token: number): boolean { return !this.disposed && token === this.generation; }
  private publish(): void {
    const next = this.project();
    if (Object.keys(next).every(key => Object.is(Reflect.get(next, key), Reflect.get(this.view, key)))) return;
    this.view = next; for (const listener of this.listeners) listener();
  }
  private project(): PracticeExecutionView {
    const owned = this.owned, plan = owned?.plan ?? this.startingPlan ?? this.candidate;
    const common = { executedPlan: owned?.plan ?? this.startingPlan, canStart: !owned && !this.startingPlan && this.admitted && Boolean(this.candidate) && !this.disposed && !this.releaseFailure,
    };
    if (owned?.mode === 'CONTINUOUS_PLAY') {
      const snapshot = owned.controller.snapshot(), error = this.error?.mode === 'CONTINUOUS_PLAY' ? this.error.code : snapshot.inputError;
      const lifecycle: PracticeExecutionLifecycle = owned.completed ? 'COMPLETED' : this.error?.mode === 'CONTINUOUS_PLAY' ? 'ERROR' : snapshot.session === 'FINALIZING' ? 'FINALIZING'
        : ['FAILED', 'FAILED_BEFORE_START'].includes(snapshot.session) ? 'ERROR'
        : this.startingPlan || snapshot.session === 'PREPARING' ? 'PREPARING' : snapshot.transport?.state === 'PAUSED' ? 'PAUSED' : 'ACTIVE';
      return Object.freeze({ ...common, completion: owned.completed ? snapshot.completed : null, mode: 'CONTINUOUS_PLAY', lifecycle, inputError: error,
        inputState: lifecycle === 'PREPARING' ? 'STARTING' : error || lifecycle === 'ERROR' ? 'ERROR' : lifecycle === 'ACTIVE' ? 'RUNNING' : 'IDLE',
        activeStepGroup: null, performanceClock: snapshot.transport, performanceEvaluation: snapshot.evaluation,
        recordingIndicator: snapshot.recording?.indicatorVisible ? Math.floor(snapshot.recording.elapsedMs / 1000) : null,
        analysisIntervention: snapshot.analysisIntervention, resourceIntervention: snapshot.resourceIntervention });
    }
    const snapshot = owned?.mode === 'STEP_BY_STEP' ? owned.controller.snapshot() : null;
    const stepError = this.error?.mode === 'STEP_BY_STEP' ? this.error.code : this.releaseFailure ? 'STEP_RESOURCE_CLEANUP_FAILED' : snapshot?.error ?? null;
    const continuousError = this.error?.mode === 'CONTINUOUS_PLAY' ? this.error.code : this.releaseFailure ? 'RESOURCE_CLEANUP_FAILED' : null;
    const error = plan?.mode === 'CONTINUOUS_PLAY' ? continuousError : stepError;
    const lifecycle: PracticeExecutionLifecycle = owned?.completed ? 'COMPLETED' : this.startingPlan ? 'PREPARING' : error ? 'ERROR' : owned ? 'ACTIVE' : 'READY';
    const base = { ...common, lifecycle, inputError: error,
      inputState: (lifecycle === 'PREPARING' ? 'STARTING' : error ? 'ERROR' : lifecycle === 'ACTIVE' ? 'RUNNING' : 'IDLE') as LocalPracticeInputState };
    if (plan?.mode === 'CONTINUOUS_PLAY') return Object.freeze({ ...base, completion: null, mode: 'CONTINUOUS_PLAY', inputError: continuousError, activeStepGroup: null,
      performanceClock: null, performanceEvaluation: null, recordingIndicator: null, analysisIntervention: null, resourceIntervention: null });
    return Object.freeze({ ...base, completion: null, mode: 'STEP_BY_STEP', inputError: stepError, activeStepGroup: snapshot?.activeStepGroup && plan ? projectPracticeMomentView(plan.source.artifact, snapshot.activeStepGroup) : null,
      stepInteractionPhase: snapshot?.stepInteractionPhase ?? null, pendingPostVerdict: snapshot?.pendingPostVerdict ?? null,
      canAcceptAttempt: snapshot?.canAcceptAttempt ?? false, analysisIntervention: snapshot?.analysisIntervention ?? null,
      infrastructureIntervention: snapshot?.infrastructureIntervention ?? null, performanceClock: null, performanceEvaluation: null, recordingIndicator: null });
  }
}
