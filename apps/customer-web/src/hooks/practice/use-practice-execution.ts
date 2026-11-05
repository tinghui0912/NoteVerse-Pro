'use client';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { PracticeExecutionOwner, type PracticeExecutionPorts } from '@/lib/practice/application/practice-execution-owner';
import type { PracticePlan } from '@/lib/practice/planning/practice-plan';

export function usePracticeExecution(options: PracticeExecutionPorts & {
  plan: PracticePlan | null; admitted: boolean; compositionId: string;
  onNaturalCompletion?: Parameters<PracticeExecutionOwner['setCompletionListener']>[0];
}) {
  const [owner] = useState(() => new PracticeExecutionOwner(options));
  const lifetime = useRef({ generation: 0 });
  useLayoutEffect(() => {
    owner.setCompletionListener(options.onNaturalCompletion);
    owner.setCandidate(options.plan, options.admitted, options.compositionId);
  }, [owner, options.plan, options.admitted, options.compositionId, options.onNaturalCompletion]);
  useEffect(() => {
    const currentLifetime = lifetime.current;
    ++currentLifetime.generation;
    return () => {
      const retiring = ++currentLifetime.generation;
      void owner.end();
      queueMicrotask(() => { if (retiring === currentLifetime.generation) void owner.dispose(); });
    };
  }, [owner]);
  const snapshot = useSyncExternalStore(owner.subscribe, owner.snapshot, owner.snapshot);
  const [commands] = useState(() => ({ start: () => owner.start(), end: () => owner.end(), retry: () => owner.retry(),
    skip: () => owner.skip(), pause: () => owner.pause(), resume: () => owner.resume(),
    setMetronomeEnabled: (enabled: boolean) => owner.setMetronomeEnabled(enabled),
    continueWithoutAnalysis: () => owner.continueWithoutAnalysis(), continueWithoutRecording: () => owner.continueWithoutRecording(),
    continueAfterRecovery: () => owner.continueAfterRecovery() }));
  return { ...snapshot, ...commands };
}
