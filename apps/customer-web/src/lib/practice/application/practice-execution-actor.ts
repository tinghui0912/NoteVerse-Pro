import {
  DeviceFailure,
  MidiFailure,
  isPracticeCausalFailure,
} from "@/lib/practice/failure/causal-failure";
import { projectStepFailure } from "@/lib/practice/step/step-errors";
import { projectContinuousFailure } from "@/lib/practice/continuous/continuous-errors";
import {
  StepPracticeController,
  type StepControllerOptions,
} from "@/lib/practice/step/step-practice-controller";
import {
  ContinuousPracticeController,
  type ContinuousControllerOptions,
} from "@/lib/practice/continuous/continuous-practice-controller";
import { browserStepPlatform } from "@/lib/practice/step/step-platform";
import { browserContinuousPlatform } from "@/lib/practice/continuous/continuous-platform";
import { PracticeStartupTimings } from "@/lib/practice/diagnostics/startup-timings";
import type { PracticePlan } from "@/lib/practice/planning/practice-plan";
import type {
  PracticeDeviceRoots,
  PracticeRootHealthPort,
} from "@/lib/practice/device/device-contract";
import type { AcousticInferencePort } from "@/lib/practice/acoustic/runtime/inference-types";
import {
  initialExecutionState,
  ownedExecution,
  transitionExecution,
  type AcceptedExecution,
  type ExecutionEffect,
  type ExecutionId,
  type PracticeExecutionActorState,
  type PracticeExecutionEvent,
} from "./execution-machine";
import type {
  ExecutionCompletion,
  ExecutionFailure,
  ExecutionObservation,
} from "./execution-observation";
import {
  projectExecutionView,
  sameExecutionView,
  type PracticeExecutionView,
} from "./execution-view";

type StepController = Pick<
  StepPracticeController,
  | "start"
  | "dispose"
  | "abandon"
  | "subscribe"
  | "snapshot"
  | "skip"
  | "setMetronomeEnabled"
>;
type ContinuousController = Pick<
  ContinuousPracticeController,
  | "start"
  | "dispose"
  | "abandon"
  | "subscribe"
  | "snapshot"
  | "pause"
  | "resume"
  | "continueWithoutAnalysis"
  | "continueWithoutRecording"
  | "continueAfterRecovery"
  | "setMetronomeEnabled"
>;
export type PracticeExecutionPorts = Readonly<{
  borrowRoots(): PracticeDeviceRoots | null;
  rootHealth: PracticeRootHealthPort;
  acquireInference?: (signal: AbortSignal) => Promise<AcousticInferencePort>;
}>;
export type PracticeExecutionFactories = Readonly<{
  step(
    options: StepControllerOptions,
    acquire?: PracticeExecutionPorts["acquireInference"],
  ): StepController;
  continuous(
    options: ContinuousControllerOptions,
    acquire?: PracticeExecutionPorts["acquireInference"],
  ): ContinuousController;
}>;
const browserFactories: PracticeExecutionFactories = {
  step: (options, acquire) =>
    new StepPracticeController({
      ...options,
      platform: browserStepPlatform(acquire),
    }),
  continuous: (options, acquire) =>
    new ContinuousPracticeController(
      options,
      browserContinuousPlatform(acquire),
    ),
};
type Controller =
  | Readonly<{ mode: "STEP_BY_STEP"; controller: StepController }>
  | Readonly<{ mode: "CONTINUOUS_PLAY"; controller: ContinuousController }>;
type RuntimeHandle = {
  executionId: ExecutionId;
  adapter: Controller;
  detach(): void;
  preparation: Promise<void>;
};
type Waiter = Readonly<{
  promise: Promise<void>;
  resolve(): void;
  done(state: PracticeExecutionActorState): boolean;
}>;
const settled = Promise.resolve();

/** Application effect owner. Musical truth and ownership transitions belong to the machine. */
export class PracticeExecutionActor {
  private state = initialExecutionState();
  private handle: RuntimeHandle | null = null;
  private readonly events: {
    event: PracticeExecutionEvent;
    acknowledged?: () => void;
  }[] = [];
  private dispatching = false;
  // Command acknowledgements only: these do not decide lifecycle or release policy.
  private readonly acknowledgements = new Map<string, Waiter>();
  private completionListener:
    | ((snapshot: ExecutionCompletion) => void)
    | undefined;
  private readonly listeners = new Set<() => void>();
  private view: PracticeExecutionView = projectExecutionView(this.state);
  constructor(
    private readonly ports: PracticeExecutionPorts,
    private readonly factories = browserFactories,
  ) {}
  snapshot = (): PracticeExecutionView => this.view;
  engineeringSnapshot() {
    return {
      failureCause:
        this.state.tag === "ERROR"
          ? this.state.error.failure.cause
          : this.state.tag === "DISPOSED"
            ? (this.state.failure?.cause ?? null)
            : null,
    };
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  setCompletionListener(
    listener: ((snapshot: ExecutionCompletion) => void) | undefined,
  ): void {
    this.completionListener = listener;
  }
  setCandidate(
    plan: PracticePlan | null,
    admitted: boolean,
    composition: string,
  ): void {
    this.dispatch({ type: "CANDIDATE_CHANGED", plan, admitted, composition });
  }
  start(): Promise<void> {
    return this.command({ type: "START_REQUESTED" }, () =>
      this.startAcknowledgement(),
    );
  }
  retry(): Promise<void> {
    return this.command({ type: "RETRY_REQUESTED" }, () =>
      this.startAcknowledgement(),
    );
  }
  end(): Promise<void> {
    return this.command({ type: "END_REQUESTED" }, () =>
      this.releaseAcknowledgement(),
    );
  }
  dispose(): Promise<void> {
    this.completionListener = undefined;
    const release = this.command({ type: "DISPOSE_REQUESTED" }, () =>
      this.releaseAcknowledgement(),
    );
    this.listeners.clear();
    return release;
  }
  private startAcknowledgement(): Promise<void> {
    const id =
      this.state.tag === "STARTING"
        ? this.state.execution.executionId
        : this.state.tag === "RELEASING" &&
            this.state.destination.kind === "RESTART"
          ? this.state.destination.execution.executionId
          : null;
    return id === null
      ? settled
      : this.acknowledge(
          `start:${id}`,
          (state) =>
            !(state.tag === "STARTING" && state.execution.executionId === id) &&
            !(
              state.tag === "RELEASING" &&
              state.destination.kind === "RESTART" &&
              state.destination.execution.executionId === id
            ),
        );
  }
  private releaseAcknowledgement(): Promise<void> {
    if (this.state.tag !== "RELEASING") return settled;
    const id = this.state.execution.executionId;
    return this.acknowledge(
      `release:${id}`,
      (state) =>
        state.tag !== "RELEASING" || state.execution.executionId !== id,
    );
  }
  private acknowledge(key: string, done: Waiter["done"]): Promise<void> {
    const existing = this.acknowledgements.get(key);
    if (existing) return existing.promise;
    let resolve!: () => void;
    const promise = new Promise<void>((complete) => {
      resolve = complete;
    });
    this.acknowledgements.set(key, { promise, resolve, done });
    return promise;
  }
  private command(
    event: PracticeExecutionEvent,
    acknowledgement: () => Promise<void>,
  ): Promise<void> {
    // Reentrant commands acknowledge their accepted transition, not the caller's preceding state.
    if (this.dispatching)
      return new Promise<void>((resolve) => {
        this.dispatch(event, () => resolve(acknowledgement()));
      });
    this.dispatch(event);
    return acknowledgement();
  }
  private dispatch(
    event: PracticeExecutionEvent,
    acknowledged?: () => void,
  ): void {
    this.events.push({ event, acknowledged });
    if (this.dispatching) return;
    this.dispatching = true;
    try {
      while (this.events.length) {
        const queued = this.events.shift()!;
        const transition = transitionExecution(this.state, queued.event);
        if (transition.state !== this.state) {
          this.state = transition.state;
          const next = projectExecutionView(this.state);
          if (!sameExecutionView(next, this.view)) {
            this.view = next;
            for (const listener of this.listeners) listener();
          }
          for (const [key, waiter] of this.acknowledgements)
            if (waiter.done(this.state)) {
              this.acknowledgements.delete(key);
              waiter.resolve();
            }
        }
        for (const effect of transition.effects) this.run(effect);
        queued.acknowledged?.();
      }
    } finally {
      this.dispatching = false;
    }
  }
  private run(effect: ExecutionEffect): void {
    switch (effect.kind) {
      case "PREPARE":
        queueMicrotask(() =>
          this.dispatch({
            type: "PREPARATION_READY",
            executionId: effect.execution.executionId,
          }),
        );
        break;
      case "START_CONTROLLER":
        this.constructAndStart(effect.execution);
        break;
      case "RELEASE":
        this.release(effect.execution);
        break;
      case "NOTIFY_COMPLETION":
        this.completionListener?.(effect.session);
        break;
    }
  }
  private constructAndStart(execution: AcceptedExecution): void {
    const { plan, executionId } = execution;
    try {
      const devices = this.ports.borrowRoots();
      if (!devices)
        throw plan.resources.input.kind === "MIDI"
          ? new MidiFailure("ACCESS_UNAVAILABLE")
          : new DeviceFailure("UNAVAILABLE", "MICROPHONE");
      const shared = {
        devices,
        rootHealth: this.ports.rootHealth,
        startupTimings: new PracticeStartupTimings(),
        onNaturalCompletion: (session: ExecutionCompletion) => {
          this.dispatch({
            type: "NATURAL_COMPLETION",
            executionId,
            session,
            observation: observe(adapter),
          });
        },
      };
      const adapter: Controller =
        plan.mode === "STEP_BY_STEP"
          ? {
              mode: plan.mode,
              controller: this.factories.step(
                { ...shared, plan },
                this.ports.acquireInference,
              ),
            }
          : {
              mode: plan.mode,
              controller: this.factories.continuous(
                { ...shared, plan },
                this.ports.acquireInference,
              ),
            };
      let prepared!: () => void;
      const handle: RuntimeHandle = {
        executionId,
        adapter,
        detach: () => {},
        preparation: new Promise<void>((resolve) => {
          prepared = resolve;
        }),
      };
      this.handle = handle;
      const changed = () =>
        this.dispatch({
          type: "CONTROLLER_CHANGED",
          executionId,
          observation: observe(adapter),
        });
      try {
        handle.detach = adapter.controller.subscribe(changed);
        changed();
        const preparation = adapter.controller.start();
        changed();
        Promise.resolve(preparation)
          .then(
            () => {
              changed();
              this.dispatch({ type: "START_SUCCEEDED", executionId });
            },
            (cause) =>
              this.dispatch({
                type: "START_FAILED",
                executionId,
                failure: startFailure(plan, cause),
              }),
          )
          .finally(prepared);
      } catch (cause) {
        prepared();
        this.dispatch({
          type: "START_FAILED",
          executionId,
          failure: startFailure(plan, cause),
        });
      }
    } catch (cause) {
      this.dispatch({
        type: "START_FAILED",
        executionId,
        failure: startFailure(plan, cause),
      });
    }
  }
  private release(execution: AcceptedExecution): void {
    const handle = this.handle;
    // The machine fences first; detach and both release requests happen synchronously.
    this.handle = null;
    const operations: Promise<unknown>[] = [];
    const request = (action: () => unknown) => {
      try {
        operations.push(Promise.resolve(action()));
      } catch (cause) {
        operations.push(Promise.reject(cause));
      }
    };
    if (handle) {
      request(() => handle.detach());
      request(() => handle.adapter.controller.abandon());
      request(() => handle.adapter.controller.dispose());
      operations.push(handle.preparation);
    }
    // Wait for every operation, including late Start, even when one cleanup rejects early.
    void Promise.allSettled(operations)
      .then((results) => {
        const rejection = results.find(
          (result) => result.status === "rejected",
        );
        if (rejection?.status === "rejected") throw rejection.reason;
        if (handle) {
          const observation = observe(handle.adapter);
          if (
            observation.error === "STEP_RESOURCE_CLEANUP_FAILED" ||
            observation.error === "RESOURCE_CLEANUP_FAILED"
          )
            throw new Error(observation.error);
        }
        this.dispatch({
          type: "RELEASE_SUCCEEDED",
          executionId: execution.executionId,
        });
      })
      .catch((cause) =>
        this.dispatch({
          type: "RELEASE_FAILED",
          executionId: execution.executionId,
          failure:
            execution.plan.mode === "STEP_BY_STEP"
              ? {
                  mode: "STEP_BY_STEP",
                  code: "STEP_RESOURCE_CLEANUP_FAILED",
                  cause,
                }
              : {
                  mode: "CONTINUOUS_PLAY",
                  code: "RESOURCE_CLEANUP_FAILED",
                  cause,
                },
        }),
      );
  }
  private commandHandle(): Controller | null {
    const execution = ownedExecution(this.state);
    return execution && this.handle?.executionId === execution.executionId
      ? this.handle.adapter
      : null;
  }
  setMetronomeEnabled(enabled: boolean): void {
    this.commandHandle()?.controller.setMetronomeEnabled(enabled);
  }
  skip(): void {
    const adapter = this.commandHandle();
    if (adapter?.mode === "STEP_BY_STEP") adapter.controller.skip();
  }
  pause(): void {
    const adapter = this.commandHandle();
    if (adapter?.mode === "CONTINUOUS_PLAY") adapter.controller.pause();
  }
  resume(): void {
    const adapter = this.commandHandle();
    if (adapter?.mode === "CONTINUOUS_PLAY") adapter.controller.resume();
  }
  continueWithoutAnalysis(): Promise<void> {
    const adapter = this.commandHandle();
    return adapter?.mode === "CONTINUOUS_PLAY"
      ? adapter.controller.continueWithoutAnalysis()
      : settled;
  }
  continueWithoutRecording(): void {
    const adapter = this.commandHandle();
    if (adapter?.mode === "CONTINUOUS_PLAY")
      adapter.controller.continueWithoutRecording();
  }
  continueAfterRecovery(): boolean {
    const adapter = this.commandHandle();
    return (
      adapter?.mode === "CONTINUOUS_PLAY" &&
      adapter.controller.continueAfterRecovery()
    );
  }
}
function startFailure(plan: PracticePlan, cause: unknown): ExecutionFailure {
  return plan.mode === "STEP_BY_STEP"
    ? {
        mode: plan.mode,
        code: isPracticeCausalFailure(cause)
          ? projectStepFailure(cause, "PREPARING")
          : "STEP_ATTEMPT_FAILED",
        cause,
      }
    : {
        mode: plan.mode,
        code: isPracticeCausalFailure(cause)
          ? projectContinuousFailure(cause, "PREPARING")
          : "ANALYSIS_FAILED",
        cause,
      };
}
function observe(adapter: Controller): ExecutionObservation {
  if (adapter.mode === "STEP_BY_STEP") {
    const snapshot = adapter.controller.snapshot();
    return Object.freeze({
      mode: adapter.mode,
      error: snapshot.error,
      activeStepGroup: snapshot.activeStepGroup,
      stepInteractionPhase: snapshot.stepInteractionPhase,
      pendingPostVerdict: snapshot.pendingPostVerdict,
      canAcceptAttempt: snapshot.canAcceptAttempt,
      analysisIntervention: snapshot.analysisIntervention,
      infrastructureIntervention: snapshot.infrastructureIntervention,
    });
  }
  const snapshot = adapter.controller.snapshot();
  return Object.freeze({
    mode: adapter.mode,
    error: snapshot.inputError,
    phase:
      snapshot.session === "FINALIZING"
        ? "FINALIZING"
        : ["FAILED", "FAILED_BEFORE_START"].includes(snapshot.session)
          ? "ERROR"
          : snapshot.session === "PREPARING"
            ? "PREPARING"
            : snapshot.transport?.state === "PAUSED"
              ? "PAUSED"
              : "ACTIVE",
    transport: snapshot.transport,
    evaluation: snapshot.evaluation,
    recordingIndicator: snapshot.recording?.indicatorVisible
      ? Math.floor(snapshot.recording.elapsedMs / 1000)
      : null,
    analysisIntervention: snapshot.analysisIntervention,
    resourceIntervention: snapshot.resourceIntervention,
    completion: snapshot.completed,
  });
}
