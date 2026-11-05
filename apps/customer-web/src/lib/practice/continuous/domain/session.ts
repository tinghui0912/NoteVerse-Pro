import type { LocalPracticeSessionBase } from '@/lib/practice/kernel/session';

type ContinuousPracticeLifecycle =
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
    activeElapsedMs: number;
    countInMs: number;
    countInTicks: number;
    countInPulses: number;
  };
};
