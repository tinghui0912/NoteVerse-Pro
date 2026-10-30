import { PracticeTimebase, type SessionTime } from '@/lib/practice/kernel/timebase';
import type { StepPianoKeyEvidence } from '@/lib/practice/step/domain/attempt';
import { isAcousticDomainIdentity, SourcePublicationSequence, type SourceAcousticObservation, type SourceAcousticPublication } from '@/lib/practice/acoustic/runtime/source-publication';

export const STEP_ACOUSTIC_GESTURE_MS = 50;

export type StepAcousticAttemptSink<Identity> = Readonly<{
  open(time: SessionTime): Identity | null;
  complete(identity: Identity, evidence: StepPianoKeyEvidence): void;
}>;
export type StepAcousticAssemblerOptions<Identity> = Readonly<{
  sourceDomainId: string; sourceSampleRateHz: 44100 | 48000; localSessionId: string;
  sourceAnchorSample: number; sessionAnchorTime: Readonly<SessionTime>; sink: StepAcousticAttemptSink<Identity>;
}>;
export type SealedStepAcousticGesture = Readonly<{
  sourceDomainId: string; sourceSampleRateHz: number; anchorSourceSample: number; endSourceSample: number;
  observations: readonly SourceAcousticObservation[]; evidence: StepPianoKeyEvidence;
}>;
type Active<Identity> = {
  identity: Identity; anchor: number; end: number; observations: Map<string, SourceAcousticObservation>;
};
type Phase = 'BLOCKED' | 'READY' | 'CAPTURING' | 'FAILED';

const order = (a: SourceAcousticObservation, b: SourceAcousticObservation) => a.sourceEventSample - b.sourceEventSample
  || (a.observationId < b.observationId ? -1 : a.observationId === b.observationId ? 0 : 1);
const validSample = (sample: number) => Number.isFinite(sample) && sample >= 0 && sample <= Number.MAX_SAFE_INTEGER;

/** Score-blind, frontier-sealed ownership only. Callers own availability and retirement, never this component. */
export class StepAcousticAttemptAssembler<Identity> {
  private phase: Phase = 'BLOCKED';
  private active: Active<Identity> | null = null;
  private eligibleAfter: number | null = null;
  private frontier: number | null = null;
  private processing = false;
  private readonly publications: SourcePublicationSequence;
  private readonly timebase: PracticeTimebase;
  private readonly sourceDomainId: string;
  private readonly sourceRate: 44100 | 48000;
  private readonly sink: StepAcousticAttemptSink<Identity>;

  constructor(options: StepAcousticAssemblerOptions<Identity>) {
    if (!isAcousticDomainIdentity(options.sourceDomainId) || !options.localSessionId
      || ![44100, 48000].includes(options.sourceSampleRateHz) || !validSample(options.sourceAnchorSample)
      || options.sessionAnchorTime.domainId !== options.localSessionId || !Number.isFinite(options.sessionAnchorTime.ms)) {
      throw new Error('STEP_ACOUSTIC_SOURCE_MAPPING_INVALID');
    }
    this.sourceDomainId = options.sourceDomainId; this.sourceRate = options.sourceSampleRateHz;
    this.publications = new SourcePublicationSequence(this.sourceDomainId, this.sourceRate);
    this.sink = Object.freeze({ ...options.sink });
    this.timebase = new PracticeTimebase({ domainId: options.localSessionId, sampleRateHz: this.sourceRate,
      anchorSampleIndex: options.sourceAnchorSample, anchorSessionTimeMs: options.sessionAnchorTime.ms });
  }

  /** External owner calls only after its explicit retirement/READY commit. This does not rearm the domain. */
  acceptInputAfter(sourceWatermark: number): void {
    this.guard();
    if (this.active || !validSample(sourceWatermark) || (this.eligibleAfter !== null && sourceWatermark < this.eligibleAfter)
      || (this.frontier !== null && sourceWatermark < this.frontier)) this.fail('STEP_ACOUSTIC_RETIREMENT_INVALID');
    this.eligibleAfter = sourceWatermark; this.phase = 'READY';
  }

  /** Unfinished ownership is invalidated, not queued. Caller separately cancels its domain attempt. */
  suspend(): void { this.guard(); this.active = null; this.phase = 'BLOCKED'; }

  accept(publication: SourceAcousticPublication): SealedStepAcousticGesture | null {
    this.guard(); this.processing = true;
    try {
      const previous = this.publications.accept(publication);
      // Stream continuity belongs to the source owner; H50 alone may not cross regions.
      if (this.active && previous && publication.window.regionIndex !== previous.region) {
        this.fail('STEP_ACOUSTIC_GESTURE_COVERAGE_GAP');
      }
      const observations = [...publication.observations].sort(order);
      this.frontier = publication.ownedThroughSourceSample;
      if (this.phase === 'READY') {
        const first = observations.find(o => o.sourceEventSample > this.eligibleAfter!);
        if (first) {
          const identity = this.sink.open(this.timebase.sampleIndexToSessionTime(first.sourceEventSample));
          this.assertCallbackDidNotFail();
          if (identity === null) { this.phase = 'BLOCKED'; return null; }
          const end = first.sourceEventSample + this.sourceRate * STEP_ACOUSTIC_GESTURE_MS / 1000;
          if (!validSample(end)) this.fail('STEP_ACOUSTIC_INTERVAL_INVALID');
          this.active = { identity, anchor: first.sourceEventSample, end, observations: new Map() }; this.phase = 'CAPTURING';
        }
      }
      if (!this.active) return null;
      const active = this.active;
      for (const o of observations) if (o.sourceEventSample >= active.anchor && o.sourceEventSample < active.end) {
        active.observations.set(o.observationId, Object.freeze({ ...o }));
      }
      if (this.frontier < active.end) return null;
      if (!active.observations.size) this.fail('STEP_ACOUSTIC_EMPTY_GESTURE');
      const bounded = Object.freeze([...active.observations.values()].sort(order));
      const [firstKey, ...otherKeys] = [...new Set(bounded.map(o => o.midiPitch))].sort((a, b) => a - b);
      if (firstKey === undefined) this.fail('STEP_ACOUSTIC_EMPTY_GESTURE');
      const evidence: StepPianoKeyEvidence = Object.freeze({
        observedAttackKeys: Object.freeze([firstKey, ...otherKeys] as const),
        confidence: Math.min(...bounded.map(o => o.confidence)),
        captureEndSessionTime: Object.freeze(this.timebase.sampleIndexToSessionTime(active.end)) });
      const sealed = Object.freeze({ sourceDomainId: this.sourceDomainId, sourceSampleRateHz: this.sourceRate,
        anchorSourceSample: active.anchor, endSourceSample: active.end, observations: bounded, evidence });
      this.active = null; this.phase = 'BLOCKED';
      this.sink.complete(active.identity, evidence);
      this.assertCallbackDidNotFail();
      return sealed;
    } catch (error) { this.active = null; this.phase = 'FAILED'; throw error; }
    finally { this.processing = false; }
  }

  snapshot() {
    return Object.freeze({ phase: this.phase, inputEligibleAfterSourceSample: this.eligibleAfter,
      processedThroughSourceSample: this.frontier, gestureAnchorSourceSample: this.active?.anchor ?? null,
      gestureEndSourceSample: this.active?.end ?? null, activeObservationCount: this.active?.observations.size ?? 0 });
  }
  private guard(): void {
    if (this.processing || this.phase === 'FAILED') this.fail('STEP_ACOUSTIC_ASSEMBLER_UNAVAILABLE');
  }
  private assertCallbackDidNotFail(): void {
    if (this.phase === 'FAILED') this.fail('STEP_ACOUSTIC_ASSEMBLER_UNAVAILABLE');
  }
  private fail(code: string): never { this.active = null; this.phase = 'FAILED'; throw new Error(code); }
}
