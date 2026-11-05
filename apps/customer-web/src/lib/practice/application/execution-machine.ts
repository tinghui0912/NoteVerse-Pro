import type { PracticePlan } from "@/lib/practice/planning/practice-plan";
import type {
  ExecutionCompletion,
  ExecutionFailure,
  ExecutionObservation,
} from "./execution-observation";

export type ExecutionId = number;
type Candidate = Readonly<{
  plan: PracticePlan | null;
  admitted: boolean;
  composition: string | null;
}>;
type Context = Readonly<{ candidate: Candidate; nextExecutionId: ExecutionId }>;
export type AcceptedExecution = Readonly<{
  executionId: ExecutionId;
  plan: PracticePlan;
  composition: string;
  observation: ExecutionObservation | null;
}>;
type Restart = Readonly<{ kind: "RESTART"; execution: AcceptedExecution }>;
type ReleaseDestination =
  | Readonly<{ kind: "READY" }>
  | Readonly<{ kind: "DISPOSED" }>
  | Restart;
export type PracticeExecutionActorState = Context &
  (
    | Readonly<{ tag: "READY" }>
    | Readonly<{
        tag: "STARTING";
        phase: "SCHEDULED" | "PREPARING";
        execution: AcceptedExecution;
      }>
    | Readonly<{ tag: "RUNNING" | "COMPLETED"; execution: AcceptedExecution }>
    | Readonly<{
        tag: "RELEASING";
        execution: AcceptedExecution;
        destination: ReleaseDestination;
      }>
    | Readonly<{
        tag: "ERROR";
        error:
          | Readonly<{
              kind: "EXECUTION";
              execution: AcceptedExecution;
              failure: ExecutionFailure;
            }>
          | Readonly<{ kind: "RELEASE"; failure: ExecutionFailure }>;
      }>
    | Readonly<{ tag: "DISPOSED"; failure: ExecutionFailure | null }>
  );
export type PracticeExecutionEvent =
  | Readonly<{
      type: "CANDIDATE_CHANGED";
      plan: PracticePlan | null;
      admitted: boolean;
      composition: string;
    }>
  | Readonly<{
      type:
        | "START_REQUESTED"
        | "END_REQUESTED"
        | "RETRY_REQUESTED"
        | "DISPOSE_REQUESTED";
    }>
  | Readonly<{
      type: "PREPARATION_READY" | "START_SUCCEEDED" | "RELEASE_SUCCEEDED";
      executionId: ExecutionId;
    }>
  | Readonly<{
      type: "START_FAILED" | "RELEASE_FAILED";
      executionId: ExecutionId;
      failure: ExecutionFailure;
    }>
  | Readonly<{
      type: "CONTROLLER_CHANGED";
      executionId: ExecutionId;
      observation: ExecutionObservation;
    }>
  | Readonly<{
      type: "NATURAL_COMPLETION";
      executionId: ExecutionId;
      session: ExecutionCompletion;
      observation: ExecutionObservation;
    }>;
export type ExecutionEffect =
  | Readonly<{
      kind: "PREPARE" | "START_CONTROLLER";
      execution: AcceptedExecution;
    }>
  | Readonly<{ kind: "RELEASE"; execution: AcceptedExecution }>
  | Readonly<{
      kind: "NOTIFY_COMPLETION";
      executionId: ExecutionId;
      session: ExecutionCompletion;
    }>;
export type ExecutionTransition = Readonly<{
  state: PracticeExecutionActorState;
  effects: readonly ExecutionEffect[];
}>;
export function initialExecutionState(): PracticeExecutionActorState {
  return {
    tag: "READY",
    candidate: { plan: null, admitted: false, composition: null },
    nextExecutionId: 1,
  };
}
export function ownedExecution(
  state: PracticeExecutionActorState,
): AcceptedExecution | null {
  switch (state.tag) {
    case "STARTING":
    case "RUNNING":
    case "COMPLETED":
      return state.execution;
    case "ERROR":
      return state.error.kind === "EXECUTION" ? state.error.execution : null;
    default:
      return null;
  }
}
function context(state: PracticeExecutionActorState): Context {
  return { candidate: state.candidate, nextExecutionId: state.nextExecutionId };
}
function accepted(
  state: PracticeExecutionActorState,
  plan: PracticePlan,
  composition: string,
): AcceptedExecution {
  return {
    executionId: state.nextExecutionId,
    plan,
    composition,
    observation: null,
  };
}
function release(
  state: PracticeExecutionActorState,
  execution: AcceptedExecution,
  destination: ReleaseDestination,
): ExecutionTransition {
  return {
    state: { ...context(state), tag: "RELEASING", execution, destination },
    effects: [{ kind: "RELEASE", execution }],
  };
}
function begin(
  state: PracticeExecutionActorState,
  execution: AcceptedExecution,
): ExecutionTransition {
  return {
    state: {
      ...context(state),
      tag: "STARTING",
      phase: "SCHEDULED",
      execution,
      nextExecutionId: Math.max(
        state.nextExecutionId,
        execution.executionId + 1,
      ),
    },
    effects: [{ kind: "PREPARE", execution }],
  };
}
/** All ownership decisions are synchronous, pure and identity-scoped. */
export function transitionExecution(
  state: PracticeExecutionActorState,
  event: PracticeExecutionEvent,
): ExecutionTransition {
  const unchanged = { state, effects: [] } as const;
  if (state.tag === "DISPOSED") return unchanged;
  const execution = ownedExecution(state);
  switch (event.type) {
    case "CANDIDATE_CHANGED": {
      if (
        state.candidate.plan === event.plan &&
        state.candidate.admitted === event.admitted &&
        state.candidate.composition === event.composition
      )
        return unchanged;
      const replacement =
        state.candidate.composition !== null &&
        state.candidate.composition !== event.composition;
      const next = {
        ...state,
        candidate: {
          plan: event.plan,
          admitted: event.admitted,
          composition: event.composition,
        },
      };
      if (replacement && execution)
        return release(next, execution, { kind: "READY" });
      if (
        replacement &&
        next.tag === "RELEASING" &&
        next.destination.kind !== "DISPOSED"
      ) {
        return {
          state: { ...next, destination: { kind: "READY" } },
          effects: [],
        };
      }
      return { state: next, effects: [] };
    }
    case "START_REQUESTED": {
      const { candidate } = state;
      if (
        !candidate.plan ||
        !candidate.admitted ||
        candidate.composition === null
      )
        return unchanged;
      if (state.tag === "READY")
        return begin(
          state,
          accepted(state, candidate.plan, candidate.composition),
        );
      if (state.tag === "RELEASING" && state.destination.kind === "READY") {
        return {
          state: {
            ...state,
            destination: {
              kind: "RESTART",
              execution: accepted(state, candidate.plan, candidate.composition),
            },
            nextExecutionId: state.nextExecutionId + 1,
          },
          effects: [],
        };
      }
      return unchanged;
    }
    case "PREPARATION_READY":
      return state.tag === "STARTING" &&
        state.phase === "SCHEDULED" &&
        state.execution.executionId === event.executionId
        ? {
            state: { ...state, phase: "PREPARING" },
            effects: [{ kind: "START_CONTROLLER", execution: state.execution }],
          }
        : unchanged;
    case "START_SUCCEEDED":
      return state.tag === "STARTING" &&
        state.phase === "PREPARING" &&
        state.execution.executionId === event.executionId
        ? {
            state: {
              ...context(state),
              tag: "RUNNING",
              execution: state.execution,
            },
            effects: [],
          }
        : unchanged;
    case "START_FAILED":
      if (
        !execution ||
        execution.executionId !== event.executionId ||
        execution.plan.mode !== event.failure.mode ||
        state.tag === "COMPLETED"
      )
        return unchanged;
      return {
        state: {
          ...context(state),
          tag: "ERROR",
          error: { kind: "EXECUTION", execution, failure: event.failure },
        },
        effects: [],
      };
    case "CONTROLLER_CHANGED": {
      if (
        !execution ||
        execution.executionId !== event.executionId ||
        execution.plan.mode !== event.observation.mode
      )
        return unchanged;
      // Completion is atomic: a later leaf notification cannot replace its accepted payload.
      if (state.tag === "COMPLETED") return unchanged;
      const updated = { ...execution, observation: event.observation };
      if (state.tag === "ERROR" && state.error.kind === "EXECUTION")
        return {
          state: { ...state, error: { ...state.error, execution: updated } },
          effects: [],
        };
      if (state.tag === "STARTING" || state.tag === "RUNNING")
        return { state: { ...state, execution: updated }, effects: [] };
      return unchanged;
    }
    case "NATURAL_COMPLETION": {
      if (
        !execution ||
        execution.executionId !== event.executionId ||
        state.tag === "COMPLETED" ||
        state.tag === "ERROR" ||
        event.session.completionReason !== "SCOPE_COMPLETED" ||
        execution.plan.mode !== event.observation.mode
      )
        return unchanged;
      if (
        event.observation.mode === "CONTINUOUS_PLAY" &&
        !event.observation.completion
      ) {
        return {
          state: {
            ...context(state),
            tag: "ERROR",
            error: {
              kind: "EXECUTION",
              execution,
              failure: {
                mode: "CONTINUOUS_PLAY",
                code: "ANALYSIS_FAILED",
                cause: "CONTINUOUS_COMPLETION_UNAVAILABLE",
              },
            },
          },
          effects: [],
        };
      }
      return {
        state: {
          ...context(state),
          tag: "COMPLETED",
          execution: { ...execution, observation: event.observation },
        },
        effects: [
          {
            kind: "NOTIFY_COMPLETION",
            executionId: event.executionId,
            session: event.session,
          },
        ],
      };
    }
    case "END_REQUESTED":
      if (execution) return release(state, execution, { kind: "READY" });
      if (state.tag === "RELEASING" && state.destination.kind === "RESTART")
        return {
          state: { ...state, destination: { kind: "READY" } },
          effects: [],
        };
      return unchanged;
    case "RETRY_REQUESTED": {
      if (
        state.tag !== "COMPLETED" ||
        !state.candidate.admitted ||
        state.candidate.composition !== state.execution.composition
      )
        return unchanged;
      const retry = accepted(
        state,
        state.execution.plan,
        state.execution.composition,
      );
      return release(
        { ...state, nextExecutionId: state.nextExecutionId + 1 },
        state.execution,
        { kind: "RESTART", execution: retry },
      );
    }
    case "DISPOSE_REQUESTED":
      if (execution) return release(state, execution, { kind: "DISPOSED" });
      if (state.tag === "RELEASING")
        return {
          state: { ...state, destination: { kind: "DISPOSED" } },
          effects: [],
        };
      return {
        state: {
          ...context(state),
          tag: "DISPOSED",
          failure: state.tag === "ERROR" ? state.error.failure : null,
        },
        effects: [],
      };
    case "RELEASE_SUCCEEDED": {
      if (
        state.tag !== "RELEASING" ||
        state.execution.executionId !== event.executionId
      )
        return unchanged;
      if (state.destination.kind === "DISPOSED")
        return {
          state: { ...context(state), tag: "DISPOSED", failure: null },
          effects: [],
        };
      if (
        state.destination.kind === "RESTART" &&
        state.candidate.admitted &&
        state.candidate.composition === state.destination.execution.composition
      )
        return begin(state, state.destination.execution);
      return { state: { ...context(state), tag: "READY" }, effects: [] };
    }
    case "RELEASE_FAILED":
      if (
        state.tag !== "RELEASING" ||
        state.execution.executionId !== event.executionId
      )
        return unchanged;
      return {
        state:
          state.destination.kind === "DISPOSED"
            ? { ...context(state), tag: "DISPOSED", failure: event.failure }
            : {
                ...context(state),
                tag: "ERROR",
                error: { kind: "RELEASE", failure: event.failure },
              },
        effects: [],
      };
  }
}
