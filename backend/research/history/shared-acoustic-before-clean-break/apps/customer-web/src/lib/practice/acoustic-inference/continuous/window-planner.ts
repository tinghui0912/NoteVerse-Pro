import { ACOUSTIC_MODEL, fail } from './model-contract';
import { ACOUSTIC_RESOURCES } from './resource-policy';

export type AcousticWindow = Readonly<{
  jobIndex: number; segmentIndex: number; windowIndex: number;
  ownedStartMs: number; ownedEndMs: number;
  startSample: number; endSample: number; inputWindowStartMs: number;
}>;
export type AcousticSegment = {
  index: number; sourceStart: number; performanceStartMs: number;
  originTarget: number; nextWindow: number; queuedEndMs: number;
  sourceEnd?: number; performanceEndMs?: number;
};
export function planWindow(segment: AcousticSegment, jobIndex: number): AcousticWindow | null {
  const ownedStartMs = segment.performanceStartMs + segment.nextWindow * ACOUSTIC_MODEL.ownedMs;
  const ownedEndMs = Math.min(ownedStartMs + ACOUSTIC_MODEL.ownedMs, segment.performanceEndMs ?? Infinity);
  if (ownedEndMs <= ownedStartMs) return null;
  const endSample = Math.round(segment.originTarget + (ownedEndMs - segment.performanceStartMs + ACOUSTIC_MODEL.futureMs) * 16);
  const startSample = endSample - ACOUSTIC_MODEL.inputSamples;
  return Object.freeze({ jobIndex, segmentIndex: segment.index, windowIndex: segment.nextWindow,
    ownedStartMs, ownedEndMs, startSample, endSample,
    inputWindowStartMs: segment.performanceStartMs + (startSample - segment.originTarget) / 16 });
}
export class AcousticPcmRing {
  private readonly pcm = new Float32Array(ACOUSTIC_RESOURCES.targetRingSamples);
  private end = 0;
  get length(): number { return this.end; }
  get firstRetained(): number { return Math.max(0, this.end - this.pcm.length); }
  append(input: Float32Array): void { for (const value of input) this.pcm[this.end++ % this.pcm.length] = value; }
  extract(start: number, end: number): Float32Array {
    if (!Number.isInteger(start) || end - start !== ACOUSTIC_MODEL.inputSamples
      || start < Math.max(10, this.firstRetained) || end > this.end) fail('REAL_ACOUSTIC_CONTEXT_UNAVAILABLE');
    return Float32Array.from({ length: end - start }, (_, i) => this.pcm[(start + i) % this.pcm.length]);
  }
}
