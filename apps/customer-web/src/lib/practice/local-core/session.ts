import type { PracticeInputSource, PracticeMode, PracticeScope } from './artifact';
import type { PracticeTempoSelection, ResolvedPracticeTempoPlan } from './practice-tempo';
import type { RuntimeVersionIdentity, SessionTime } from './timebase';
import type { StepAttemptIdentity, StepAttemptRecord, StepAttemptState, StepSkipRecord } from './step-attempt';

export type ContinuousPracticeLifecycle =
  | 'READY'
  | 'ACTIVE'
  | 'PAUSED'
  | 'ENDED';

export type LocalPracticeInputState =
  | 'IDLE'
  | 'STARTING'
  | 'RUNNING'
  | 'ERROR';

export type StepPracticeLifecycle = 'READY' | 'ACTIVE' | 'ENDED';
export type LocalPracticeCompletionReason = 'SCOPE_COMPLETED' | 'STOPPED_BY_USER';

type LocalPracticeSessionBase = {
  localSessionId: string;
  scoreId: string;
  revisionId: string;
  artifactId: string;
  mode: PracticeMode;
  inputSource: PracticeInputSource;
  practiceScope: PracticeScope;
  tempoSelection: PracticeTempoSelection;
  metronomeEnabled: boolean;
  completionReason: LocalPracticeCompletionReason | null;
  version: RuntimeVersionIdentity;
  createdAtMs: number;
  updatedAtMs: number;
};

export type LocalStepSessionSnapshot = LocalPracticeSessionBase & {
  mode: 'STEP_BY_STEP';
  lifecycleState: StepPracticeLifecycle;
  step: {
    currentIndex: number;
    targetGeneration: number;
    inputEligibleAfter: Readonly<SessionTime>;
    inputAvailable: boolean;
    completed: boolean;
    attemptState: StepAttemptState;
    activeAttempt: StepAttemptIdentity | null;
    attempts: readonly StepAttemptRecord[];
    skips: readonly StepSkipRecord[];
  };
};

export type LocalPerformanceSessionSnapshot = LocalPracticeSessionBase & {
  mode: 'CONTINUOUS_PLAY';
  lifecycleState: ContinuousPracticeLifecycle;
  performance: {
    state: 'READY' | 'COUNT_IN' | 'RUNNING' | 'PAUSED' | 'ENDED';
    stateBeforePause: 'READY' | 'COUNT_IN' | 'RUNNING' | 'PAUSED' | 'ENDED';
    resolvedTempoPlan: ResolvedPracticeTempoPlan;
    scopeStartBeat: number;
    scopeTerminalBeat: number;
    activeElapsedMs: number;
    countInMs: number;
    countInBeats: number;
    countInPulses: number;
  };
};

export type LocalPracticeSessionSnapshot =
  | LocalStepSessionSnapshot
  | LocalPerformanceSessionSnapshot;

export function createLocalSessionId(prefix = 'local-practice'): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  return `${prefix}:${random}`;
}
