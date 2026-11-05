"use client";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  PracticeExecutionActor,
  type PracticeExecutionPorts,
} from "@/lib/practice/application/practice-execution-actor";
import type { PracticePlan } from "@/lib/practice/planning/practice-plan";

export function usePracticeExecution(
  options: PracticeExecutionPorts & {
    plan: PracticePlan | null;
    admitted: boolean;
    compositionId: string;
    onNaturalCompletion?: Parameters<
      PracticeExecutionActor["setCompletionListener"]
    >[0];
  },
) {
  const [actor] = useState(() => new PracticeExecutionActor(options));
  const lifetime = useRef({ generation: 0 });
  useLayoutEffect(() => {
    actor.setCompletionListener(options.onNaturalCompletion);
    actor.setCandidate(options.plan, options.admitted, options.compositionId);
  }, [
    actor,
    options.plan,
    options.admitted,
    options.compositionId,
    options.onNaturalCompletion,
  ]);
  useEffect(() => {
    const currentLifetime = lifetime.current;
    ++currentLifetime.generation;
    return () => {
      const retiring = ++currentLifetime.generation;
      void actor.releaseForTeardown();
      queueMicrotask(() => {
        if (retiring === currentLifetime.generation) void actor.dispose();
      });
    };
  }, [actor]);
  const snapshot = useSyncExternalStore(
    actor.subscribe,
    actor.snapshot,
    actor.snapshot,
  );
  const [commands] = useState(() => ({
    start: () => actor.start(),
    end: () => actor.end(),
    retry: () => actor.retry(),
    skip: () => actor.skip(),
    pause: () => actor.pause(),
    resume: () => actor.resume(),
    setMetronomeEnabled: (enabled: boolean) =>
      actor.setMetronomeEnabled(enabled),
    continueWithoutAnalysis: () => actor.continueWithoutAnalysis(),
    continueWithoutRecording: () => actor.continueWithoutRecording(),
    continueAfterRecovery: () => actor.continueAfterRecovery(),
  }));
  return { ...snapshot, ...commands };
}
