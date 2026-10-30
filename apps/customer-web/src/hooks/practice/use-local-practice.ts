'use client';
import type { PracticeDeviceRoots } from '@/lib/practice/device/device-contract';
import type { AcousticInferencePort } from '@/lib/practice/acoustic/runtime/inference-types';

import { useCallback, useState } from 'react';
import type { PracticeSessionPlan, StepPracticeSessionPlan, ContinuousPracticeSessionPlan } from '@/lib/practice/planning/session-plan';
import { useStepLocalPractice } from './use-step-local-practice';
import { useContinuousLocalPractice } from './use-continuous-local-practice';
import { continuousCompletionStore } from '@/lib/practice/continuous/completion-store';
import { PracticeResourceCoordinator } from './practice-resource-coordinator';

import type { LocalStepSessionSnapshot } from '@/lib/practice/step/domain/session';
import type { LocalPerformanceSessionSnapshot } from '@/lib/practice/continuous/domain/session';

type LocalPracticeSessionSnapshot = LocalStepSessionSnapshot | LocalPerformanceSessionSnapshot;

export type UseLocalPracticeOptions = {
  plan: PracticeSessionPlan | null;
  getDevices: () => PracticeDeviceRoots | null; observeDevices?: (listener: () => void) => () => void;
  acquireInference?: (signal: AbortSignal) => Promise<AcousticInferencePort>;
  onNaturalCompletion?: (snapshot: LocalPracticeSessionSnapshot) => void;
};

type PracticeBinding = ReturnType<typeof usePracticeModeBinding>;
export function useLocalPractice(options: UseLocalPracticeOptions & { plan: StepPracticeSessionPlan }): Extract<PracticeBinding, { mode: 'STEP_BY_STEP' }>;
export function useLocalPractice(options: UseLocalPracticeOptions & { plan: ContinuousPracticeSessionPlan }): Extract<PracticeBinding, { mode: 'CONTINUOUS_PLAY' }>;
export function useLocalPractice(options: UseLocalPracticeOptions): PracticeBinding;
export function useLocalPractice(options: UseLocalPracticeOptions): PracticeBinding {
  return usePracticeModeBinding(options);
}

function usePracticeModeBinding(options: UseLocalPracticeOptions) {
  const [resources] = useState(() => new PracticeResourceCoordinator());
  const onSessionStart = useCallback(() => continuousCompletionStore.clearCompletion(), []);
  const step = useStepLocalPractice(options, resources, onSessionStart);
  const continuous = useContinuousLocalPractice(options, resources, onSessionStart);
  return options.plan?.mode === 'CONTINUOUS_PLAY' ? continuous : step;
}
