'use client';

import { useMemo, useRef } from 'react';
import type { PracticeInputSource, PracticeMode, PracticeScope, PracticeScoreArtifact } from '@/lib/practice/local-core/artifact';
import type { LocalPracticeSessionSnapshot } from '@/lib/practice/local-core/session';
import { resolvePracticeTempoPlan, type PracticeTempoSelection } from '@/lib/practice/local-core/practice-tempo';
import type { PracticeRecordingMode } from '@/lib/practice/performance-recorder';
import { useStepLocalPractice } from './use-step-local-practice';
import { useContinuousLocalPractice } from './use-continuous-local-practice';

export type UseLocalPracticeOptions = {
  artifact: PracticeScoreArtifact | null | undefined; mode: PracticeMode; inputSource: PracticeInputSource;
  scope: PracticeScope | null; tempoSelection?: PracticeTempoSelection; metronomeEnabled?: boolean;
  recordingMode?: PracticeRecordingMode; cameraMediaStream?: MediaStream | null;
  onCompletion?: (snapshot: LocalPracticeSessionSnapshot) => void;
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
  const resourceBarrier = useRef<Promise<void>>(Promise.resolve());
  const step = useStepLocalPractice(options, tempoPlan, resourceBarrier);
  const continuous = useContinuousLocalPractice(options, tempoPlan, resourceBarrier);
  return options.mode === 'STEP_BY_STEP' ? step : continuous;
}
