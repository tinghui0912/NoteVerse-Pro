import { ACOUSTIC_MODEL as M, AcousticAnalysisError, assertAcousticIdentity, fail, onlyFields, safeIndex } from '../model/model-contract';
import { QualifiedSourceAdapter } from '../source/source-adapter';
import { AcousticPcmRing, planWindow, type AnalysisRegion, type AcousticWindow } from './window-planner';
import type { AcousticInferencePort } from './inference-types';
import { deliverSynchronously, SourcePublicationSequence, sourcePublication, type SourcePublicationSink } from './source-publication';
import { ACOUSTIC_RESOURCES as R, retainCompact } from './resource-policy';

export type SourcePcmBlock = Readonly<{ sourceSampleRateHz: number; sourceStartSampleIndex: number;
  sourceEndSampleIndex: number; samples: Float32Array }>;
export type SourceAnalysisOptions = Readonly<{
  sourceDomainId: string; sourceSampleRateHz: number; coefficientBytes: Uint8Array; worker: AcousticInferencePort;
  nowAvailabilityRuntimeMs(): number; onPublication: SourcePublicationSink; onFailure?(error: Error): void;
}>;
type WindowDiagnostic = Readonly<{ jobIndex: number; regionIndex: number; ownedStartTarget: number; ownedEndTarget: number;
  inputStartSample: number; inputEndSample: number; queueDelayMs: number; inferenceMs: number; decodeMs: number;
  publicationMs: number; eventCount: number; outstandingAtEnqueue: number; actualSessionRunCount: number }>;

/** Owns bounded source regions, not transport, score, or product completion. */
export class SourceAnalysisRuntime {
  private state: 'PREROLL' | 'RUNNING' | 'IDLE' | 'DRAINING' | 'SEALED' | 'FAILED' | 'DISPOSED' = 'PREROLL';
  private readonly ring = new AcousticPcmRing();
  private readonly regions: AnalysisRegion[] = [];
  private readonly diagnostics: WindowDiagnostic[] = [];
  private active: AnalysisRegion | null = null;
  private base: number | null = null;
  private nextSource = 0;
  private nextRegion = 0;
  private outstanding = 0;
  private readonly queuedRegions = new Map<number, number>();
  private chain = Promise.resolve();
  private failure: Error | null = null;
  private delivering = false;
  private cleanup: (() => void) | null = null;
  private detachWorker: (() => void) | undefined;
  private lastClock = -Infinity;
  private readonly publications: SourcePublicationSequence;
  private readonly counts = { windowsQueued: 0, windowsStarted: 0, windowsPublished: 0, observationsPublished: 0,
    peakOutstanding: 0, backpressureFailures: 0, regionsStarted: 0, regionsDrained: 0 };
  private constructor(private readonly options: SourceAnalysisOptions, private readonly adapter: QualifiedSourceAdapter) {
    this.publications = new SourcePublicationSequence(options.sourceDomainId, adapter.rate);
    this.detachWorker = options.worker.onFailure?.(error => this.failAnalysis(error));
  }
  static async create(options: SourceAnalysisOptions): Promise<SourceAnalysisRuntime> {
    onlyFields(options, ['sourceDomainId', 'sourceSampleRateHz', 'coefficientBytes', 'worker', 'nowAvailabilityRuntimeMs', 'onPublication', 'onFailure']);
    if (!options.sourceDomainId || options.sourceDomainId.length > 192) fail('INVALID_ACOUSTIC_DOMAIN');
    await assertAcousticIdentity();
    const adapter = await QualifiedSourceAdapter.create(options.sourceSampleRateHz, options.coefficientBytes);
    return new SourceAnalysisRuntime(Object.freeze({ ...options, coefficientBytes: new Uint8Array() }), adapter);
  }
  append(block: SourcePcmBlock): void {
    this.guard();
    try {
      onlyFields(block, ['sourceSampleRateHz', 'sourceStartSampleIndex', 'sourceEndSampleIndex', 'samples']);
      safeIndex(block.sourceStartSampleIndex); safeIndex(block.sourceEndSampleIndex);
      if (block.sourceSampleRateHz !== this.adapter.rate || !(block.samples instanceof Float32Array)
        || block.samples.length > R.maxSourceBlockSamples || block.samples.length !== block.sourceEndSampleIndex - block.sourceStartSampleIndex
        || block.samples.some(v => !Number.isFinite(v))) fail('INVALID_ACOUSTIC_CAPTURE_BLOCK');
      if (this.base === null) { this.base = block.sourceStartSampleIndex; this.nextSource = this.base; }
      if (block.sourceStartSampleIndex !== this.nextSource) fail('NONCHRONOLOGICAL_ACOUSTIC_SOURCE');
      this.nextSource = block.sourceEndSampleIndex; this.ring.append(this.adapter.push(block.samples)); this.planAvailable();
    } catch (error) { this.failAnalysis(error); throw error; }
  }
  beginAnalysisRegion(sourceSampleIndex: number): number {
    this.guard();
    try {
      safeIndex(sourceSampleIndex);
      if (!['PREROLL', 'IDLE'].includes(this.state) || this.base === null || this.active || sourceSampleIndex !== this.nextSource) fail('INVALID_ACOUSTIC_REGION_START');
      if (this.regions.length >= R.maxPendingSegments) fail('ACOUSTIC_SEGMENT_LIMIT_EXCEEDED');
      const originTarget = (sourceSampleIndex - this.base) * 16000 / this.adapter.rate;
      const region: AnalysisRegion = { index: this.nextRegion++, sourceStart: sourceSampleIndex, originTarget, nextWindow: 0, queuedEndTarget: originTarget };
      if (planWindow(region, this.counts.windowsQueued)!.startSample < Math.max(10, this.ring.firstRetained)) fail('ACOUSTIC_PREROLL_NOT_READY');
      this.regions.push(region); this.active = region; this.state = 'RUNNING'; this.counts.regionsStarted++;
      return region.index;
    } catch (error) { this.failAnalysis(error); throw error; }
  }
  endAnalysisRegion(sourceSampleIndex: number): void {
    this.guard();
    try {
      safeIndex(sourceSampleIndex);
      if (!this.active || this.state !== 'RUNNING' || sourceSampleIndex !== this.nextSource) fail('ACOUSTIC_REGION_NOT_RUNNING');
      const endTarget = this.active.originTarget + (sourceSampleIndex - this.active.sourceStart) * 16000 / this.adapter.rate;
      if (endTarget < this.active.queuedEndTarget) fail('ACOUSTIC_REGION_END_MISMATCH');
      this.active.sourceEnd = sourceSampleIndex; this.active.endTarget = endTarget;
      this.active = null; this.state = 'IDLE'; this.planAvailable();
    } catch (error) { this.failAnalysis(error); throw error; }
  }
  finishRegions(): void {
    this.guard();
    if (this.active) this.endAnalysisRegion(this.nextSource);
    this.state = 'DRAINING'; this.planAvailable();
  }
  get tailReady(): boolean { return this.state === 'DRAINING' && this.regions.length === 0; }
  hasRegionWork(index: number): boolean { return this.regions.some(r => r.index === index) || this.queuedRegions.has(index); }
  get prerollReady(): boolean {
    if (!['PREROLL', 'IDLE'].includes(this.state) || this.base === null || this.failure) return false;
    return (this.nextSource - this.base) * 16000 / this.adapter.rate - (M.inputMs - M.futureMs) * 16 >= Math.max(10, this.ring.firstRetained);
  }
  attachCaptureCleanup(cleanup: () => void): () => void {
    this.guard(); if (this.cleanup) fail('ACOUSTIC_CAPTURE_ALREADY_ATTACHED');
    this.cleanup = cleanup; return () => { this.cleanup = null; };
  }
  async drain(): Promise<void> { await this.chain; this.guard(); }
  async seal(): Promise<void> {
    this.guard(); if (!this.tailReady) fail('REAL_ACOUSTIC_TAIL_REQUIRED');
    await this.drain(); this.state = 'SEALED';
  }
  failAnalysis(error: unknown): void {
    if (this.delivering) fail('ACOUSTIC_PUBLICATION_REENTRANCY');
    if (this.failure || this.state === 'DISPOSED' || this.state === 'SEALED') return;
    this.failure = error instanceof Error ? error : new AcousticAnalysisError(String(error));
    this.state = 'FAILED'; this.regions.length = 0; this.active = null;
    try { this.cleanup?.(); } catch { /* Keep the first causal failure. */ }
    try { this.options.onFailure?.(this.failure); } catch { /* Failure stays terminal. */ }
  }
  async dispose(): Promise<void> {
    if (this.delivering) fail('ACOUSTIC_PUBLICATION_REENTRANCY');
    if (this.state === 'DISPOSED') return;
    this.state = 'DISPOSED'; this.regions.length = 0; this.active = null;
    this.cleanup?.(); this.cleanup = null; this.detachWorker?.(); this.detachWorker = undefined;
    await this.options.worker.dispose(); await this.chain;
  }
  snapshot() {
    return Object.freeze({ state: this.state, failureCode: this.failure?.message ?? null, acousticCoreIdentitySha256: M.identitySha256,
      sourceAdapterIdentitySha256: this.adapter.identitySha256, sourceRateHz: this.adapter.rate, sourceBase: this.base,
      nextSourceSampleIndex: this.nextSource, activeRegion: this.active ? Object.freeze({ ...this.active }) : null,
      pendingRegions: this.regions.length, outstanding: this.outstanding, counts: Object.freeze({ ...this.counts }),
      diagnostics: Object.freeze([...this.diagnostics]), resources: Object.freeze({ sessionPcmBytes: 0,
        sourceAdapterBytes: this.adapter.storageBytes(), targetRingBytes: R.targetRingSamples * 4,
        outstandingInputBytes: this.outstanding * R.inputBytes, maximumOutstandingInputBytes: 4 * R.inputBytes,
        retainedPublicationEvents: 0, diagnosticWindowLimit: R.diagnosticWindows, compactDiagnosticsPlanningBytes: R.diagnosticWindows * 512 }) });
  }
  private guard(): void {
    if (this.delivering) fail('ACOUSTIC_PUBLICATION_REENTRANCY');
    if (this.failure) throw this.failure;
    if (this.state === 'SEALED' || this.state === 'DISPOSED') fail('ACOUSTIC_RUNTIME_CLOSED');
  }
  private clock(): number {
    const time = this.options.nowAvailabilityRuntimeMs();
    if (!Number.isFinite(time) || time < 0 || time < this.lastClock) fail('NONMONOTONIC_ACOUSTIC_AVAILABILITY');
    this.lastClock = time; return time;
  }
  private planAvailable(): void {
    for (const region of [...this.regions]) while (true) {
      const window = planWindow(region, this.counts.windowsQueued);
      if (!window) { this.regions.shift(); this.counts.regionsDrained++; break; }
      if (window.endSample > this.ring.length) return;
      if (this.outstanding === R.maxOutstandingWindows) { this.counts.backpressureFailures++; fail('ACOUSTIC_BACKPRESSURE_LIMIT_EXCEEDED'); }
      const pcm = this.ring.extract(window.startSample, window.endSample);
      region.nextWindow++; region.queuedEndTarget = window.ownedEndTarget; this.enqueue(window, pcm);
    }
  }
  private enqueue(window: AcousticWindow, pcm: Float32Array): void {
    const queued = this.clock(), depth = ++this.outstanding;
    this.queuedRegions.set(window.regionIndex, (this.queuedRegions.get(window.regionIndex) ?? 0) + 1);
    this.counts.windowsQueued++; this.counts.peakOutstanding = Math.max(this.counts.peakOutstanding, depth);
    this.chain = this.chain.then(async () => {
      try {
        if (this.closed()) return;
        const started = this.clock(); this.counts.windowsStarted++;
        const result = await this.options.worker.run({ window, pcm }); if (this.closed()) return;
        const available = this.clock(), publication = sourcePublication(this.options.sourceDomainId, this.adapter.rate, this.base!, window, result, available);
        this.publications.accept(publication);
        this.delivering = true;
        try { deliverSynchronously(this.options.onPublication, publication); } finally { this.delivering = false; }
        const delivered = this.clock(); this.counts.windowsPublished++; this.counts.observationsPublished += publication.observations.length;
        retainCompact(this.diagnostics, Object.freeze({ jobIndex: window.jobIndex, regionIndex: window.regionIndex,
          ownedStartTarget: window.ownedStartTarget, ownedEndTarget: window.ownedEndTarget, inputStartSample: window.startSample,
          inputEndSample: window.endSample, queueDelayMs: started - queued, inferenceMs: result.inferenceMs, decodeMs: result.decodeMs,
          publicationMs: delivered - available, eventCount: publication.observations.length, outstandingAtEnqueue: depth, actualSessionRunCount: result.actualSessionRunCount }));
      } catch (error) { this.failAnalysis(error); } finally {
        this.outstanding--;
        const remaining = this.queuedRegions.get(window.regionIndex)! - 1;
        if (remaining) this.queuedRegions.set(window.regionIndex, remaining); else this.queuedRegions.delete(window.regionIndex);
      }
    });
  }
  private closed(): boolean { return this.failure !== null || this.state === 'DISPOSED'; }
}
