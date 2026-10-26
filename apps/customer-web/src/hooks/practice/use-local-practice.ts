'use client';
import type { AcousticInferencePort } from '@/lib/practice/acoustic/runtime/inference-types';

import { useCallback, useMemo, useState } from 'react';
import type { PracticeInputSource, PracticeMode } from '@/lib/practice/kernel/session';
import type { PracticeScope } from '@/lib/practice/kernel/scope';
import type { PracticeScoreArtifact } from '@/lib/practice/kernel/artifact';

import { resolvePracticeTempoPlan, type PracticeTempoSelection } from '@/lib/practice/kernel/tempo';
import type { PracticeRecordingMode } from '@/lib/practice/recording/recording-mode';
import { useStepLocalPractice } from './use-step-local-practice';
import { useContinuousLocalPractice } from './use-continuous-local-practice';
import { continuousCompletionStore } from '@/lib/practice/continuous/completion-store';
import { PracticeResourceCoordinator } from './practice-resource-coordinator';

import type { LocalStepSessionSnapshot } from '@/lib/practice/step/domain/session';
import type { LocalPerformanceSessionSnapshot } from '@/lib/practice/continuous/domain/session';

type LocalPracticeSessionSnapshot = LocalStepSessionSnapshot | LocalPerformanceSessionSnapshot;

export type UseLocalPracticeOptions = {
  artifact: PracticeScoreArtifact | null | undefined; mode: PracticeMode; inputSource: PracticeInputSource;
  scope: PracticeScope | null; tempoSelection?: PracticeTempoSelection; metronomeEnabled?: boolean;
  recordingMode?: PracticeRecordingMode; getCameraMediaStream?: () => MediaStream | null;
  acquireInference?: (signal: AbortSignal) => Promise<AcousticInferencePort>;
  onNaturalCompletion?: (snapshot: LocalPracticeSessionSnapshot) => void;
};

type PracticeBinding = ReturnType<typeof usePracticeModeBinding>;
export function useLocalPractice(options: UseLocalPracticeOptions & { mode: 'STEP_BY_STEP' }): Extract<PracticeBinding, { mode: 'STEP_BY_STEP' }>;
export function useLocalPractice(options: UseLocalPracticeOptions & { mode: 'CONTINUOUS_PLAY' }): Extract<PracticeBinding, { mode: 'CONTINUOUS_PLAY' }>;
export function useLocalPractice(options: UseLocalPracticeOptions): PracticeBinding;
export function useLocalPractice(options: UseLocalPracticeOptions): PracticeBinding {
  return usePracticeModeBinding(options);
}

function usePracticeModeBinding(options: UseLocalPracticeOptions) {
  const tempoPlan = useMemo(() => options.artifact ? resolvePracticeTempoPlan(options.artifact, options.tempoSelection ?? { mode: 'SCORE' }) : null,
    [options.artifact, options.tempoSelection]);
  const [resources] = useState(() => new PracticeResourceCoordinator());
  const onSessionStart = useCallback(() => continuousCompletionStore.clearCompletion(), []);
  const step = useStepLocalPractice(options, tempoPlan, resources, onSessionStart);
  const continuous = useContinuousLocalPractice(options, tempoPlan, resources, onSessionStart);
  return options.mode === 'STEP_BY_STEP' ? step : continuous;
}
