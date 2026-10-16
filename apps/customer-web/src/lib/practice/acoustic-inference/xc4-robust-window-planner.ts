import { XC4 } from './xc4-robust-runtime-contract';

export type Xc4Window = Readonly<{
  windowIndex: number; ownedStartMs: number; ownedEndMs: number;
  startSample: number; endSample: number; inputWindowStartMs: number;
}>;

export function xc4Window(index: number, originTargetSample: number, terminalEndMs?: number): Xc4Window {
  if (!Number.isInteger(index) || index < 0 || !Number.isFinite(originTargetSample)
    || (terminalEndMs !== undefined && (!Number.isFinite(terminalEndMs) || terminalEndMs < 0))) {
    throw new Error('XC4_WINDOW_IDENTITY');
  }
  const ownedStartMs = index * XC4.ownedMs;
  const ownedEndMs = Math.min(ownedStartMs + XC4.ownedMs, terminalEndMs ?? Infinity);
  if (ownedEndMs <= ownedStartMs) throw new Error('XC4_EMPTY_OWNERSHIP');
  const endSample = Math.round(originTargetSample + (ownedEndMs + XC4.futureMs) * 16);
  const startSample = endSample - XC4.inputSamples;
  return Object.freeze({ windowIndex: index, ownedStartMs, ownedEndMs, startSample, endSample,
    inputWindowStartMs: (startSample - originTargetSample) / 16 });
}

export function owns(window: Xc4Window, time: number): boolean {
  return time >= window.ownedStartMs && time < window.ownedEndMs;
}

/** Bounded PCM retention; queued windows hold their own immutable input copies. */
export class Xc4TargetRing {
  private readonly values = new Float32Array(65536);
  length = 0;
  append(samples: Float32Array): void {
    for (const sample of samples) this.values[this.length++ % this.values.length] = sample;
  }
  get firstRetained(): number { return Math.max(0, this.length - this.values.length); }
  extract(start: number, end: number): Float32Array {
    if (start < this.firstRetained || end > this.length || end - start !== XC4.inputSamples) {
      throw new Error('XC4_REAL_CONTEXT_UNAVAILABLE');
    }
    return Float32Array.from({ length: end - start }, (_, i) => this.values[(start + i) % this.values.length]);
  }
}
