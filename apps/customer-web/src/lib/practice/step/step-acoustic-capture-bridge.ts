import { SourceChronology } from '@/lib/practice/acoustic/source/source-chronology';
import type { CaptureChunk, CaptureConsumer } from '@/lib/practice/acoustic/source/capture-types';
import type { SourceAnalysisRuntime } from '@/lib/practice/acoustic/runtime/source-analysis-runtime';

/** Physical capture accounting only. Acoustic processed coverage is deliberately absent. */
export class StepAcousticCaptureBridge implements CaptureConsumer {
  private readonly chronology: SourceChronology;
  private capturedThrough = 0;
  private closed = false;
  private receiving = false;
  private failure: Error | null = null;
  private cleanup: (() => void) | null = null;

  constructor(private readonly runtime: SourceAnalysisRuntime, private readonly rate: 44100 | 48000,
    private readonly accepted: () => void, private readonly onFailure: (error: Error) => void) {
    this.chronology = new SourceChronology(rate);
  }

  receive(chunk: CaptureChunk): void {
    try {
      if (this.closed || this.receiving) throw new Error('STEP_CAPTURE_CLOSED_OR_REENTRANT');
      this.receiving = true;
      this.chronology.accept(chunk);
      this.runtime.append({ sourceSampleRateHz: chunk.sourceSampleRateHz, sourceStartSampleIndex: chunk.sourceStartSampleIndex,
        sourceEndSampleIndex: chunk.sourceEndSampleIndex, samples: chunk.samples });
      this.capturedThrough = chunk.sourceEndSampleIndex;
      this.accepted();
      if (this.closed) throw this.failure ?? new Error('STEP_CAPTURE_CLOSED_DURING_ACCEPT');
    } catch (error) { this.abort(error); throw error; }
    finally { this.receiving = false; }
  }

  attachCaptureCleanup(cleanup: () => void): () => void {
    if (this.closed || this.cleanup) {
      cleanup();
      const error = new Error('STEP_CAPTURE_CLEANUP_UNAVAILABLE'); this.abort(error); throw error;
    }
    this.cleanup = cleanup;
    return () => { if (this.cleanup === cleanup) this.cleanup = null; };
  }

  abort(error: unknown): void {
    if (this.failure || this.closed) return;
    this.failure = error instanceof Error ? error : new Error(String(error));
    this.dispose(); this.onFailure(this.failure);
  }

  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    const cleanup = this.cleanup; this.cleanup = null;
    try { cleanup?.(); } catch { /* Preserve the causal capture/owner failure. */ }
  }

  snapshot() {
    return Object.freeze({ sourceSampleRateHz: this.rate, capturedThroughSourceSample: this.capturedThrough,
      ...this.chronology.snapshot(), closed: this.closed, failure: this.failure?.message ?? null });
  }
}
