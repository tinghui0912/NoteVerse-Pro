import type { LocalClock } from '../../src/lib/practice/local-core/timebase';

/** Qualification-only clock. A transition reads the render timeline exactly once. */
export class RenderTimelineClock implements LocalClock {
  private latchedSeconds: number | null = null;
  constructor(private readonly context: Pick<BaseAudioContext, 'currentTime'>) {}
  nowMs(): number { return (this.latchedSeconds ?? this.context.currentTime) * 1000; }
  transaction<T>(action: (contextTime: number) => T): T {
    if (this.latchedSeconds !== null) throw new Error('NESTED_CLOCK_TRANSACTION');
    const seconds = this.context.currentTime;
    this.latchedSeconds = seconds;
    try {
      const result = action(seconds);
      if (result && typeof result === 'object' && 'then' in result) throw new Error('ASYNCHRONOUS_CLOCK_TRANSACTION');
      return result;
    } finally { this.latchedSeconds = null; }
  }
}

export function sourceBoundary(contextTime: number, rate: number, originFrame: number, nextSource: number) {
  const unroundedFrame = contextTime * rate;
  const contextFrame = Math.round(unroundedFrame);
  const sourceSample = contextFrame - originFrame;
  const leadSamples = sourceSample - nextSource;
  if (!Number.isSafeInteger(sourceSample) || leadSamples < 0) throw new Error('BOUNDARY_ALREADY_CONSUMED');
  return Object.freeze({ contextTime, unroundedFrame, contextFrame,
    fractionalFrameError: unroundedFrame - contextFrame, sourceSample, nextSource, leadSamples });
}
