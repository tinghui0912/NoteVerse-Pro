import { ContinuousAcousticProjection } from './continuous-projection';
import { fail, onlyFields, safeIndex } from '../model/model-contract';
import { ACOUSTIC_RESOURCES as R } from '../runtime/resource-policy';

import type { CaptureChunk } from '../source/capture-types';
import { SourceChronology } from '../source/source-chronology';
export type AcousticBoundary = Readonly<{
  type: 'BEGIN' | 'PAUSE' | 'TERMINAL'; sourceSampleIndex: number; performanceTimeMs: number;
}>;

/** Source chronology only. Transport supplies boundaries; analysis cannot mutate transport. */
export class ContinuousCaptureBridge {
  private nextSource = 0;
  private readonly chronology: SourceChronology;
  private readonly boundaries: AcousticBoundary[] = [];
  private readonly boundaryIds = new Map<AcousticBoundary, string>();
  private nextBoundaryId = 0;
  private readonly boundaryDiagnostics: Readonly<{ id: string; action: 'SCHEDULED' | 'APPLIED' | 'CANCELLED'; type: string; sourceSampleIndex: number; performanceTimeMs: number; nextSourceAtAction: number }>[] = [];
  private failed = false;
  constructor(readonly runtime: ContinuousAcousticProjection, private readonly rate: number) { this.chronology = new SourceChronology(rate); }
  attachCaptureCleanup(cleanup: () => void): () => void { return this.runtime.attachCaptureCleanup(cleanup); }
  schedule(boundary: AcousticBoundary): string {
    try {
      onlyFields(boundary, ['type', 'sourceSampleIndex', 'performanceTimeMs']); safeIndex(boundary.sourceSampleIndex);
      if (this.failed || boundary.sourceSampleIndex < this.nextSource
        || !Number.isFinite(boundary.performanceTimeMs) || boundary.performanceTimeMs < 0
        || !['BEGIN', 'PAUSE', 'TERMINAL'].includes(boundary.type)) fail('INVALID_CAPTURE_BOUNDARY');
      if (this.boundaries.length >= R.maxScheduledBoundaries) fail('CAPTURE_BOUNDARY_LIMIT_EXCEEDED');
      if (this.boundaries.length && boundary.sourceSampleIndex < this.boundaries[this.boundaries.length - 1].sourceSampleIndex) fail('NONCHRONOLOGICAL_CAPTURE_BOUNDARY');
      const owned = Object.freeze({ ...boundary }), id = `boundary:${this.nextBoundaryId++}`;
      this.boundaries.push(owned); this.boundaryIds.set(owned, id); this.recordBoundary(owned, id, 'SCHEDULED');
      this.applyBoundaries();
      return id;
    } catch (error) { this.abort(error); throw error; }
  }
  isPending(id: string): boolean { return [...this.boundaryIds.values()].includes(id); }
  cancel(id: string): void {
    try {
      const index = this.boundaries.findIndex(boundary => this.boundaryIds.get(boundary) === id);
      if (this.failed || index < 0) fail('CAPTURE_BOUNDARY_NOT_PENDING');
      const [boundary] = this.boundaries.splice(index, 1);
      this.boundaryIds.delete(boundary); this.recordBoundary(boundary, id, 'CANCELLED');
    } catch (error) { this.abort(error); throw error; }
  }
  receive(chunk: CaptureChunk): void {
    try {
      if (this.failed) fail('ACOUSTIC_CAPTURE_FAILED');
      this.chronology.accept(chunk);
      let offset = 0;
      while (offset < chunk.samples.length) {
        this.applyBoundaries();
        const end = Math.min(chunk.sourceEndSampleIndex, this.boundaries[0]?.sourceSampleIndex ?? Infinity);
        const length = end - this.nextSource;
        this.runtime.append({ sourceSampleRateHz: this.rate, sourceStartSampleIndex: this.nextSource,
          sourceEndSampleIndex: end, samples: chunk.samples.subarray(offset, offset + length) });
        offset += length; this.nextSource = end;
      }
      this.applyBoundaries();
    } catch (error) { this.abort(error); throw error; }
  }
  abort(error: unknown): void { this.failed = true; this.boundaries.length = 0; this.boundaryIds.clear(); this.runtime.failAnalysis(error); }
  snapshot() { return Object.freeze({ nextSourceSampleIndex: this.nextSource, ...this.chronology.snapshot(), failed: this.failed,
    pendingBoundaryCount: this.boundaries.length, boundaryDiagnostics: Object.freeze([...this.boundaryDiagnostics]) }); }
  private recordBoundary(boundary: AcousticBoundary, id: string, action: 'SCHEDULED' | 'APPLIED' | 'CANCELLED'): void {
    this.boundaryDiagnostics.push(Object.freeze({ id, action, type: boundary.type, sourceSampleIndex: boundary.sourceSampleIndex,
      performanceTimeMs: boundary.performanceTimeMs, nextSourceAtAction: this.nextSource }));
    if (this.boundaryDiagnostics.length > 32) this.boundaryDiagnostics.shift();
  }
  private applyBoundaries(): void {
    while (this.boundaries[0]?.sourceSampleIndex === this.nextSource) {
      const boundary = this.boundaries.shift()!;
      const id = this.boundaryIds.get(boundary)!; this.boundaryIds.delete(boundary);
      if (boundary.type === 'BEGIN') this.runtime.beginSegment(boundary.performanceTimeMs);
      else if (boundary.type === 'PAUSE') this.runtime.endSegment(boundary.performanceTimeMs);
      else this.runtime.requestTerminal(boundary.performanceTimeMs);
      this.recordBoundary(boundary, id, 'APPLIED');
    }
  }
}
