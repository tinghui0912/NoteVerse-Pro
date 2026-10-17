import { ACOUSTIC_MODEL, fail } from '../model/model-contract';
import { ACOUSTIC_RESOURCES } from './resource-policy';

/** All coordinates are resampled source samples, never a product clock. */
export type AcousticWindow = Readonly<{
  jobIndex: number; regionIndex: number; windowIndex: number;
  ownedStartTarget: number; ownedEndTarget: number;
  startSample: number; endSample: number;
}>;
export type AnalysisRegion = {
  index: number; sourceStart: number; originTarget: number; nextWindow: number; queuedEndTarget: number;
  sourceEnd?: number; endTarget?: number;
};
export function planWindow(segment: AnalysisRegion, jobIndex: number): AcousticWindow | null {
  const ownedStartTarget = segment.originTarget + segment.nextWindow * ACOUSTIC_MODEL.ownedMs * 16;
  const ownedEndTarget = Math.min(ownedStartTarget + ACOUSTIC_MODEL.ownedMs * 16, segment.endTarget ?? Infinity);
  if (ownedEndTarget <= ownedStartTarget) return null;
  const endSample = Math.round(ownedEndTarget + ACOUSTIC_MODEL.futureMs * 16);
  const startSample = endSample - ACOUSTIC_MODEL.inputSamples;
  return Object.freeze({ jobIndex, regionIndex: segment.index, windowIndex: segment.nextWindow,
    ownedStartTarget, ownedEndTarget, startSample, endSample });
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
