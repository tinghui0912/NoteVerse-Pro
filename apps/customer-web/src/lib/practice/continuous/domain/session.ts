import type { LocalPracticeSessionBase } from '@/lib/practice/kernel/session';
import type { ResolvedPracticeTempoPlan } from '@/lib/practice/kernel/tempo';

export type ContinuousPracticeLifecycle =
  | 'READY'
  | 'ACTIVE'
  | 'PAUSED'
  | 'ENDED';

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
