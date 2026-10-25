import type { LocalClock } from '@/lib/practice/kernel/timebase';

/** The session render timeline is also the capture and metronome time domain. */
export class AudioContextPerformanceClock implements LocalClock {
  private latchedSeconds: number | null = null;
  constructor(private readonly context: Pick<BaseAudioContext, 'currentTime'>) {}
  nowMs(): number { return (this.latchedSeconds ?? this.context.currentTime) * 1000; }
  transaction<T>(action: (contextTime: number) => T): T {
    if (this.latchedSeconds !== null) throw new Error('NESTED_CLOCK_TRANSACTION');
    const time = this.context.currentTime; this.latchedSeconds = time;
    try {
      const result = action(time);
      if (result && (typeof result === 'object' || typeof result === 'function') && 'then' in result) throw new Error('ASYNCHRONOUS_CLOCK_TRANSACTION');
      return result;
    } finally { this.latchedSeconds = null; }
  }
}
