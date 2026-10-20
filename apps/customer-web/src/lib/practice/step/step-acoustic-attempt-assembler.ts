import { PracticeTimebase, type SessionTime } from '../local-core/timebase';
import type { StepAttemptEvidence } from '../local-core/step-attempt';
import type { SourceAcousticObservation, SourceAcousticPublication } from '../acoustic/runtime/source-publication';

export const STEP_ACOUSTIC_GESTURE_MS = 50;
const MAX_STEP_ACOUSTIC_IDENTITIES = 100_000;
const MAX_GESTURE_OBSERVATIONS = 32768;

export type StepAcousticAttemptSink<Identity> = Readonly<{
  open(time: SessionTime): Identity | null;
  complete(identity: Identity, evidence: StepAttemptEvidence): void;
}>;
export type StepAcousticAssemblerOptions<Identity> = Readonly<{
  sourceDomainId: string; sourceSampleRateHz: 44100 | 48000; localSessionId: string;
  sourceAnchorSample: number; sessionAnchorTime: Readonly<SessionTime>; sink: StepAcousticAttemptSink<Identity>;
}>;
export type SealedStepAcousticGesture = Readonly<{
  sourceDomainId: string; sourceSampleRateHz: number; anchorSourceSample: number; endSourceSample: number;
  observations: readonly SourceAcousticObservation[]; evidence: StepAttemptEvidence;
}>;
type Active<Identity> = {
  identity: Identity; anchor: number; end: number; observations: Map<string, SourceAcousticObservation>;
};
type Phase = 'BLOCKED' | 'READY' | 'CAPTURING' | 'FAILED';

const order = (a: SourceAcousticObservation, b: SourceAcousticObservation) => a.sourceEventSample - b.sourceEventSample
  || (a.observationId < b.observationId ? -1 : a.observationId === b.observationId ? 0 : 1);
const fingerprint = (o: SourceAcousticObservation) => JSON.stringify([o.observationId, o.pitch, o.midiPitch, o.confidence,
  o.sourceDomainId, o.sourceSampleRateHz, o.sourceEventSample, o.targetSample]);
const validSample = (sample: number) => Number.isFinite(sample) && sample >= 0 && sample <= Number.MAX_SAFE_INTEGER;

/** Score-blind, frontier-sealed ownership only. Callers own availability and retirement, never this component. */
export class StepAcousticAttemptAssembler<Identity> {
  private phase: Phase = 'BLOCKED';
  private active: Active<Identity> | null = null;
  private eligibleAfter: number | null = null;
  private frontier: number | null = null;
  private lastWindow: Readonly<{ region: number; index: number }> | null = null;
  private processing = false;
  private readonly seen = new Map<string, string>();
  private readonly timebase: PracticeTimebase;
  private readonly sourceDomainId: string;
  private readonly sourceRate: 44100 | 48000;
  private readonly sink: StepAcousticAttemptSink<Identity>;

  constructor(options: StepAcousticAssemblerOptions<Identity>) {
    if (!options.sourceDomainId || options.sourceDomainId.length > 192 || !options.localSessionId
      || ![44100, 48000].includes(options.sourceSampleRateHz) || !validSample(options.sourceAnchorSample)
      || options.sessionAnchorTime.domainId !== options.localSessionId || !Number.isFinite(options.sessionAnchorTime.ms)) {
      throw new Error('STEP_ACOUSTIC_SOURCE_MAPPING_INVALID');
    }
    this.sourceDomainId = options.sourceDomainId; this.sourceRate = options.sourceSampleRateHz;
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
      if (publication.sourceDomainId !== this.sourceDomainId || publication.sourceSampleRateHz !== this.sourceRate
        || !validSample(publication.ownedThroughSourceSample) || publication.observations.length > MAX_GESTURE_OBSERVATIONS) {
        this.fail('STEP_ACOUSTIC_PUBLICATION_INVALID');
      }
      const previousFrontier = this.frontier;
      if (this.active && previousFrontier !== null && publication.ownedThroughSourceSample > previousFrontier && this.lastWindow
        && (publication.window.regionIndex !== this.lastWindow.region || publication.window.windowIndex > this.lastWindow.index + 1)) {
        this.fail('STEP_ACOUSTIC_GESTURE_COVERAGE_GAP');
      }
      const observations = [...publication.observations].sort(order), fresh = new Set<string>();
      // Identity metadata is retained even for ignored input, but its pitches can never be reassigned later.
      for (const o of observations) {
        if (Object.keys(o).length !== 8 || o.sourceDomainId !== this.sourceDomainId || o.sourceSampleRateHz !== this.sourceRate || !o.observationId
          || o.observationId.length > 512 || !validSample(o.sourceEventSample) || !Number.isSafeInteger(o.targetSample)
          || o.sourceEventSample >= publication.ownedThroughSourceSample || !Number.isInteger(o.midiPitch)
          || o.midiPitch < 21 || o.midiPitch > 108 || !/^[A-G]#?-?\d$/.test(o.pitch)
          || !Number.isFinite(o.confidence) || o.confidence < 0 || o.confidence > 1) this.fail('STEP_ACOUSTIC_OBSERVATION_INVALID');
        const value = fingerprint(o), old = this.seen.get(o.observationId);
        if (old !== undefined && old !== value) this.fail('STEP_ACOUSTIC_MUTATED_OBSERVATION');
        if (old === undefined) {
          if (this.seen.size === MAX_STEP_ACOUSTIC_IDENTITIES) this.fail('STEP_ACOUSTIC_IDENTITY_LIMIT');
          if (this.phase !== 'BLOCKED' && this.eligibleAfter !== null && o.sourceEventSample > this.eligibleAfter
            && previousFrontier !== null && o.sourceEventSample < previousFrontier) this.fail('STEP_ACOUSTIC_NONCHRONOLOGICAL_OBSERVATION');
          this.seen.set(o.observationId, value); fresh.add(o.observationId);
        }
      }
      this.frontier = Math.max(previousFrontier ?? 0, publication.ownedThroughSourceSample);
      if (previousFrontier === null || publication.ownedThroughSourceSample > previousFrontier) {
        this.lastWindow = Object.freeze({ region: publication.window.regionIndex, index: publication.window.windowIndex });
      }
      if (this.phase === 'READY') {
        const first = observations.find(o => fresh.has(o.observationId) && o.sourceEventSample > this.eligibleAfter!);
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
      for (const o of observations) if (o.sourceEventSample >= active.anchor && o.sourceEventSample < active.end
        && (fresh.has(o.observationId) || active.observations.has(o.observationId))) {
        active.observations.set(o.observationId, Object.freeze({ ...o }));
        if (active.observations.size > MAX_GESTURE_OBSERVATIONS) this.fail('STEP_ACOUSTIC_GESTURE_LIMIT');
      }
      if (this.frontier < active.end) return null;
      if (!active.observations.size) this.fail('STEP_ACOUSTIC_EMPTY_GESTURE');
      const bounded = Object.freeze([...active.observations.values()].sort(order));
      const evidence: StepAttemptEvidence = Object.freeze({ kind: 'EVIDENCE',
        observedAttackPitches: Object.freeze([...new Set(bounded.map(o => o.pitch))].sort()),
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
      gestureEndSourceSample: this.active?.end ?? null, activeObservationCount: this.active?.observations.size ?? 0,
      retainedObservationIdentityCount: this.seen.size });
  }
  private guard(): void {
    if (this.processing || this.phase === 'FAILED') this.fail('STEP_ACOUSTIC_ASSEMBLER_UNAVAILABLE');
  }
  private assertCallbackDidNotFail(): void {
    if (this.phase === 'FAILED') this.fail('STEP_ACOUSTIC_ASSEMBLER_UNAVAILABLE');
  }
  private fail(code: string): never { this.active = null; this.phase = 'FAILED'; throw new Error(code); }
}
