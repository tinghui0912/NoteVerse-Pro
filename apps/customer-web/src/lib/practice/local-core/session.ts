import type { PracticeInputSource, PracticeMode, PracticeScope } from './artifact';
import type { PracticeTempoSelection, ResolvedPracticeTempoPlan } from './practice-tempo';
import type { RuntimeVersionIdentity, SessionTime } from './timebase';

export type LocalPracticeLifecycle =
  | 'READY'
  | 'ACTIVE'
  | 'PAUSED'
  | 'ENDED';

export type LocalPracticeInputState =
  | 'IDLE'
  | 'STARTING'
  | 'RUNNING'
  | 'ERROR';

export type PracticeLifecycleState = LocalPracticeLifecycle;
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
  lifecycleState: LocalPracticeLifecycle;
  completionReason: LocalPracticeCompletionReason | null;
  version: RuntimeVersionIdentity;
  createdAtMs: number;
  updatedAtMs: number;
};

export type LocalStepSessionSnapshot = LocalPracticeSessionBase & {
  mode: 'STEP_BY_STEP';
  step: {
    currentIndex: number;
    activationGeneration: number;
    completed: boolean;
    attempts: LocalPracticeAttempt[];
  };
};

export type LocalPerformanceSessionSnapshot = LocalPracticeSessionBase & {
  mode: 'CONTINUOUS_PLAY';
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
    evaluationCoverageIntervals: LocalPerformanceCoverageIntervalRecord[];
    observations: LocalPerformanceObservationRecord[];
    outcomes: LocalPerformanceExpectedEventOutcomeRecord[];
  };
};

export type LocalPracticeSessionSnapshot =
  | LocalStepSessionSnapshot
  | LocalPerformanceSessionSnapshot;

export type LocalPracticeAttempt = {
  attemptId: string;
  stepId: string;
  result: 'MATCH' | 'WAIT' | 'SKIPPED';
  observedAttackPitches: string[];
  confidence: number;
  sessionTime: SessionTime;
};

type LocalPerformanceObservationRecord = {
  source: 'ACOUSTIC' | 'MIDI' | 'FAKE';
  captureTime: SessionTime;
  inferenceCompletedAtMs?: number;
  pitches: string[];
  confidence: number;
  performanceTimeMs: number;
  musicalBeat: number;
};

type LocalPerformanceCoverageIntervalRecord = {
  startMs: number;
  endMs: number;
};

export type LocalPerformanceExpectedEventOutcomeRecord = {
  expectedGroupId: string;
  performanceTimeMs: number;
  result: 'MATCH' | 'PARTIAL' | 'MISMATCH' | 'NOT_OBSERVED';
  confidence: number;
  source: 'ACOUSTIC' | 'MIDI' | 'FAKE';
  expectedStrikeOutcomes: {
    strikeId: string;
    pitch: string;
    renderNoteIds: string[];
    result: 'MATCHED' | 'MISSING' | 'UNCONFIRMED';
  }[];
  unexpectedPitches: string[];
  renderNoteIds: string[];
  measureNumbers: string[];
  timingOffsetMs?: number;
};

export function createLocalSessionId(prefix = 'local-practice'): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  return `${prefix}:${random}`;
}
