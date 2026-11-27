import {
  initialExecutionState,
  transitionExecution,
  type AcceptedExecution,
  type ExecutionEffect,
  type ExecutionId,
  type PracticeExecutionActorState,
  type PracticeExecutionEvent,
} from "./execution-machine";
import type {
  ExecutionCompletion,
} from "./execution-observation";
import {
  projectExecutionView,
  sameExecutionView,
  type PracticeExecutionView,
} from "./execution-view";

import type { PracticePlan } from '@/lib/practice/planning/practice-plan';
import type { PracticeExecutionPorts, PracticeExecutionSessionFactory, PracticeExecutionSession, ModeExecutionCommands } from './execution-session';

type RuntimeHandle = {
  executionId: ExecutionId;
  session: PracticeExecutionSession;
  detach(): void;
  preparation: Promise<void>;
  retirement?: Promise<void>;
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
    private readonly createSession: PracticeExecutionSessionFactory,
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
  /** Immediately hard-fence a React lifetime; a remount may reuse the actor after release. */
  releaseForTeardown(): Promise<void> {
    this.completionListener = undefined;
    return this.command({ type: "TEARDOWN_REQUESTED" }, () =>
      this.releaseAcknowledgement(),
    );
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
      case "RETIRE_CONTROLLER":
        this.retire(effect.execution);
        break;
      case "DISPOSE_CONTROLLER":
        this.hardDispose(effect.execution);
        break;
      case "NOTIFY_COMPLETION":
        this.completionListener?.(effect.session);
        break;
    }
  }
  private constructAndStart(execution: AcceptedExecution): void {
    const { executionId } = execution;
    let handle: RuntimeHandle | null = null;
    const construction = this.createSession({
      plan: execution.plan, ports: this.ports,
      isCommandAccepted: () => this.state.tag === 'RUNNING'
        && this.state.execution.executionId === executionId && this.handle === handle,
      onNaturalCompletion: completion => {
        if (!handle) return;
        this.dispatch({ type: 'NATURAL_COMPLETION', executionId, session: completion,
          observation: handle.session.observe() });
      },
    });
    if (construction.status === 'FAILED') {
      this.dispatch({ type: 'START_FAILED', executionId, failure: construction.failure });
      return;
    }
    const session = construction.session;
    let prepared!: () => void;
    handle = { executionId, session, detach: () => {},
      preparation: new Promise<void>(resolve => { prepared = resolve; }) };
    this.handle = handle;
    const changed = () => this.dispatch({ type: 'CONTROLLER_CHANGED', executionId, observation: session.observe() });
    try {
      handle.detach = session.subscribe(changed);
      changed();
      const preparation = session.start();
      changed();
      Promise.resolve(preparation).then(() => {
        changed(); this.dispatch({ type: 'START_SUCCEEDED', executionId });
      }, cause => this.dispatch({ type: 'START_FAILED', executionId, failure: session.failure(cause, 'START') }))
        .finally(prepared);
    } catch (cause) {
      prepared();
      this.dispatch({ type: 'START_FAILED', executionId, failure: session.failure(cause, 'START') });
    }
  }
  private retire(execution: AcceptedExecution): void {
    const handle =
      this.handle?.executionId === execution.executionId ? this.handle : null;
    const operations: Promise<unknown>[] = [];
    if (handle) {
      operations.push(this.requestDetach(handle));
      operations.push(
        requestOperation(() => handle.session.retire()),
      );
      operations.push(handle.preparation);
    }
    const retirement = this.settleRelease(
      execution,
      handle,
      operations,
      "RETIREMENT",
    );
    // A completed leaf retains its completion owner until Review handoff / explicit hard release.
    if (handle) handle.retirement = retirement;
  }
  private hardDispose(execution: AcceptedExecution): void {
    const handle =
      this.handle?.executionId === execution.executionId ? this.handle : null;
    if (handle) this.handle = null;
    const operations: Promise<unknown>[] = [];
    if (handle) {
      operations.push(this.requestDetach(handle));
      operations.push(
        requestOperation(() => handle.session.dispose()),
      );
      operations.push(handle.preparation);
      if (handle.retirement) operations.push(handle.retirement);
    }
    void this.settleRelease(execution, handle, operations, "RELEASE");
  }
  private requestDetach(handle: RuntimeHandle): Promise<unknown> {
    const detach = handle.detach;
    handle.detach = () => {};
    return requestOperation(detach);
  }
  private settleRelease(
    execution: AcceptedExecution,
    handle: RuntimeHandle | null,
    operations: Promise<unknown>[],
    phase: "RETIREMENT" | "RELEASE",
  ): Promise<void> {
    // Every phase settles all its work, including late preparation, before the machine proceeds.
    return Promise.allSettled(operations)
      .then((results) => {
        const rejection = results.find(
          (result) => result.status === "rejected",
        );
        if (rejection?.status === "rejected") throw rejection.reason;
        this.dispatch({
          type:
            phase === "RETIREMENT"
              ? "RETIREMENT_SUCCEEDED"
              : "RELEASE_SUCCEEDED",
          executionId: execution.executionId,
        });
      })
      .catch((cause) =>
        this.dispatch({
          type: phase === "RETIREMENT" ? "RETIREMENT_FAILED" : "RELEASE_FAILED",
          executionId: execution.executionId,
          failure: handle!.session.failure(cause, 'RELEASE'),
        }),
      );
  }
  modeCommands(): ModeExecutionCommands | null {
    return this.state.tag === 'RUNNING' && this.handle?.executionId === this.state.execution.executionId
      ? this.handle.session.commands : null;
  }
}
function requestOperation(action: () => unknown): Promise<unknown> {
  try {
    return Promise.resolve(action());
  } catch (cause) {
    return Promise.reject(cause);
  }
}
