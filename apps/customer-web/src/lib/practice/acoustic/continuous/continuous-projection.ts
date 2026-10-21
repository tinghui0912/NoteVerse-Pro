import type { SourcePcmBlock } from '../runtime/source-analysis-runtime';
import { SourceAnalysisRuntime } from '../runtime/source-analysis-runtime';
import { ACOUSTIC_MODEL, fail, onlyFields } from '../model/model-contract';
import type { AcousticInferencePort } from '../runtime/inference-types';
import { deliverPublication, projectContinuousEvidence, type AcousticPublicationSink, type PerformanceSegment } from './publication';

export type AcousticRuntimeOptions = Readonly<{
  sessionDomainId: string; sourceDomainId: string; sourceSampleRateHz: number;
  coefficientBytes: Uint8Array; worker: AcousticInferencePort;
  nowAvailabilityMs(): number; onPublication: AcousticPublicationSink; onFailure?(error: Error): void;
}>;
/** Continuous projection owns only performance mapping and terminal coverage. */
export class ContinuousAcousticProjection {
  private source!: SourceAnalysisRuntime;
  private readonly segments = new Map<number, PerformanceSegment>();
  private active: PerformanceSegment | null = null;
  private lastEnd = 0;
  private terminal: number | null = null;
  private terminalPublications = 0;
  private frontier = -Infinity;
  private delivering = false;
  private constructor(private readonly options: AcousticRuntimeOptions) {}
  static async create(options: AcousticRuntimeOptions): Promise<ContinuousAcousticProjection> {
    onlyFields(options, ['sessionDomainId', 'sourceDomainId', 'sourceSampleRateHz', 'coefficientBytes', 'worker', 'nowAvailabilityMs', 'onPublication', 'onFailure']);
    if (!options.sessionDomainId || options.sessionDomainId.length > 192) fail('INVALID_ACOUSTIC_DOMAIN');
    const owner = new ContinuousAcousticProjection(Object.freeze({ ...options, coefficientBytes: new Uint8Array() }));
    owner.source = await SourceAnalysisRuntime.create({ sourceDomainId: options.sourceDomainId, sourceSampleRateHz: options.sourceSampleRateHz,
      coefficientBytes: options.coefficientBytes, worker: options.worker, nowAvailabilityMs: options.nowAvailabilityMs,
      onFailure: options.onFailure, onPublication: publication => {
        const segment = owner.segments.get(publication.window.regionIndex);
        if (!segment) fail('UNKNOWN_ACOUSTIC_PERFORMANCE_SEGMENT');
        owner.deliver(projectContinuousEvidence(publication, segment, options.sessionDomainId));
        if (segment.sourceEnd !== undefined && publication.window.ownedEndTarget >= segment.originTarget
          + (segment.sourceEnd - segment.sourceStart) * 16000 / options.sourceSampleRateHz) owner.segments.delete(segment.index);
      } });
    return owner;
  }
  append(block: SourcePcmBlock): void { this.guard(); this.source.append(block); }
  beginSegment(performanceStartMs: number): void {
    this.guard();
    try {
      if (performanceStartMs !== this.lastEnd || this.active || this.terminal !== null) fail('INVALID_ACOUSTIC_SEGMENT_START');
      const s = this.source.snapshot(), index = this.source.beginAnalysisRegion(s.nextSourceSampleIndex);
      const segment: PerformanceSegment = { index, sourceStart: s.nextSourceSampleIndex,
        originTarget: (s.nextSourceSampleIndex - s.sourceBase!) * 16000 / this.options.sourceSampleRateHz, performanceStartMs };
      this.segments.set(index, segment); this.active = segment;
    } catch (error) { this.failAnalysis(error); throw error; }
  }
  endSegment(performanceEndMs: number): void {
    this.guard();
    try {
      if (!this.active) fail('ACOUSTIC_SEGMENT_NOT_RUNNING');
      const snapshot = this.source.snapshot(), next = snapshot.nextSourceSampleIndex;
      const actualEnd = this.active.performanceStartMs + (next - this.active.sourceStart) / this.options.sourceSampleRateHz * 1000;
      if (!Number.isFinite(performanceEndMs) || Math.abs(actualEnd - performanceEndMs) > 1000 / this.options.sourceSampleRateHz
        || performanceEndMs < this.active.performanceStartMs + snapshot.activeRegion!.nextWindow * ACOUSTIC_MODEL.ownedMs) fail('ACOUSTIC_SEGMENT_END_MISMATCH');
      this.active.performanceEndMs = performanceEndMs; this.active.sourceEnd = next;
      const index = this.active.index;
      this.source.endAnalysisRegion(next); this.lastEnd = performanceEndMs; this.active = null;
      if (!this.source.hasRegionWork(index)) this.segments.delete(index);
    } catch (error) { this.failAnalysis(error); throw error; }
  }
  requestTerminal(performanceEndMs: number): void {
    this.guard();
    if (this.active) this.endSegment(performanceEndMs);
    if (performanceEndMs !== this.lastEnd || this.terminal !== null) fail('INVALID_ACOUSTIC_TERMINAL');
    this.terminal = performanceEndMs; this.source.finishRegions();
  }
  get tailReady(): boolean { return this.source.tailReady; }
  get prerollReady(): boolean { return this.source.prerollReady; }
  attachCaptureCleanup(cleanup: () => void): () => void { return this.source.attachCaptureCleanup(cleanup); }
  drain(): Promise<void> { return this.source.drain(); }
  async seal(): Promise<void> {
    this.guard(); if (!this.tailReady) fail('REAL_ACOUSTIC_TAIL_REQUIRED');
    await this.source.drain();
    try {
      this.deliver(Object.freeze({ publicationId: `${this.options.sourceDomainId}:terminal`, sessionDomainId: this.options.sessionDomainId,
        analyzedThroughPerformanceMs: this.terminal!, availabilityTimeMs: this.options.nowAvailabilityMs(), observations: Object.freeze([]) }));
      await this.source.seal(); this.terminalPublications++; this.segments.clear();
    } catch (error) { this.failAnalysis(error); throw error; }
  }
  failAnalysis(error: unknown): void { this.guardReentry(); this.source.failAnalysis(error); this.segments.clear(); this.active = null; }
  async dispose(): Promise<void> { this.guardReentry(); this.segments.clear(); this.active = null; await this.source.dispose(); }
  snapshot() {
    const s = this.source.snapshot();
    return Object.freeze({ ...s, state: s.state === 'IDLE' ? 'PAUSED' : s.state,
      activeSegment: this.active ? Object.freeze({ index: this.active.index, sourceStart: this.active.sourceStart, performanceStartMs: this.active.performanceStartMs }) : null,
      pendingSegments: s.pendingRegions, analyzedThroughPerformanceMs: this.frontier,
      counts: Object.freeze({ ...s.counts, segmentsStarted: s.counts.regionsStarted, segmentsDrained: s.counts.regionsDrained, terminalPublications: this.terminalPublications }) });
  }
  private guardReentry(): void { if (this.delivering) fail('ACOUSTIC_PUBLICATION_REENTRANCY'); }
  private guard(): void {
    this.guardReentry(); const s = this.source.snapshot();
    if (s.state === 'FAILED') fail(s.failureCode!);
    if (s.state === 'SEALED' || s.state === 'DISPOSED') fail('ACOUSTIC_RUNTIME_CLOSED');
  }
  private deliver(publication: Parameters<AcousticPublicationSink>[0]): void {
    if (publication.analyzedThroughPerformanceMs < this.frontier || publication.availabilityTimeMs < publication.analyzedThroughPerformanceMs) fail('INVALID_ACOUSTIC_PUBLICATION_TIME');
    this.delivering = true;
    try { deliverPublication(this.options.onPublication, publication); } finally { this.delivering = false; }
    this.frontier = publication.analyzedThroughPerformanceMs;
  }
}
