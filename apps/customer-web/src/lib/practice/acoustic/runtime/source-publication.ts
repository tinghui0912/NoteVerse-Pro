import { ACOUSTIC_MODEL as M, ACOUSTIC_TARGET_SAMPLES_PER_MS, AcousticAnalysisError, fail, type SourceRate } from '../model/model-contract';
import { pianoMidiPitchToName } from '../model/robust-piano-decoder';
import type { AcousticWindow } from './window-planner';
import type { AcousticInferenceResult } from './inference-types';
import { ACOUSTIC_RESOURCES } from './resource-policy';

export type SourceAcousticObservation = Readonly<{
  observationId: string; pitch: string; midiPitch: number; confidence: number;
  sourceDomainId: string; sourceSampleRateHz: SourceRate; sourceEventSample: number; targetSample: number;
}>;
export type SourceAcousticPublication = Readonly<{
  sourceDomainId: string; sourceSampleRateHz: SourceRate; window: AcousticWindow;
  /** Exclusive absolute source frontier processed by this publication, not physical captured-through. */
  ownedThroughSourceSample: number;
  availabilityRuntimeMs: number; observations: readonly SourceAcousticObservation[];
}>;
export type SourcePublicationSink = (publication: SourceAcousticPublication) => void;

/** Primitive-string admission budget in UTF-16 code units, not an identity grammar. */
export function isAcousticDomainIdentity(value: string): boolean {
  return Boolean(value) && value.length <= 192;
}

/** Identity belongs to the newly owned source window, never to a product attempt. */
export function sourceObservationId(domain: string, window: AcousticWindow, midiPitch: number, targetSample: number): string {
  return `${domain}:r${window.regionIndex}:w${window.windowIndex}:p${midiPitch}:f${targetSample}`;
}

type PublicationSummary = Readonly<{ job: number; region: number; index: number; ownedEndTarget: number; nextOwnedStartTarget: number; frontier: number }>;
const sourceCoordinate = (n: number) => Number.isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER;
const index = (n: number) => Number.isSafeInteger(n) && n >= 0;
function sourceEventSample(base: number, target: number, rate: SourceRate): number {
  const numerator = base * M.sampleRateHz + target * rate;
  if (!Number.isSafeInteger(numerator)) fail('ACOUSTIC_SOURCE_COORDINATE_OVERFLOW');
  return numerator / M.sampleRateHz;
}

/** One ordered, exactly-once stream. Retains only the previous window, never event history. */
export class SourcePublicationSequence {
  private previous: PublicationSummary | null = null;
  private failed = false;
  private base: number | null = null;
  constructor(private readonly domain: string, private readonly rate: SourceRate) {}

  accept(p: SourceAcousticPublication): PublicationSummary | null {
    if (this.failed) fail('ACOUSTIC_PUBLICATION_STREAM_FAILED');
    try {
      const w = p.window, previous = this.previous;
      if (p.sourceDomainId !== this.domain || p.sourceSampleRateHz !== this.rate
        || !sourceCoordinate(p.ownedThroughSourceSample) || !Array.isArray(p.observations)
        || p.observations.length > ACOUSTIC_RESOURCES.maxEventsPerWindow
        || !Number.isFinite(p.availabilityRuntimeMs) || p.availabilityRuntimeMs < 0
        || !w || !index(w.jobIndex) || !index(w.regionIndex) || !index(w.windowIndex)
        || !sourceCoordinate(w.ownedStartTarget) || !sourceCoordinate(w.ownedEndTarget)
        || w.ownedEndTarget <= w.ownedStartTarget || w.ownedEndTarget > w.ownedStartTarget + M.ownedMs * ACOUSTIC_TARGET_SAMPLES_PER_MS
        || w.endSample !== Math.round(w.ownedEndTarget + M.futureMs * ACOUSTIC_TARGET_SAMPLES_PER_MS)
        || w.startSample !== w.endSample - M.inputSamples || !index(w.startSample)
        || w.jobIndex !== (previous ? previous.job + 1 : 0)
        || (!previous && w.windowIndex !== 0)
        || (previous && (p.ownedThroughSourceSample <= previous.frontier
          || w.regionIndex < previous.region
          || (w.regionIndex === previous.region
            ? w.windowIndex !== previous.index + 1 || w.ownedStartTarget !== previous.nextOwnedStartTarget
              || previous.ownedEndTarget !== previous.nextOwnedStartTarget
            : w.windowIndex !== 0 || w.ownedStartTarget < previous.ownedEndTarget)))) fail('ACOUSTIC_PUBLICATION_SEQUENCE_INVALID');
      // Recover the integer capture origin, then require the exact producer geometry;
      // rounding this hypothesis never repairs or changes the publication.
      const base = this.base ?? Math.round(p.ownedThroughSourceSample - w.ownedEndTarget * this.rate / M.sampleRateHz);
      if (!index(base) || base + w.ownedEndTarget * this.rate / M.sampleRateHz !== p.ownedThroughSourceSample) fail('ACOUSTIC_PUBLICATION_SOURCE_MAPPING_INVALID');
      const ids = new Set<string>();
      for (const o of p.observations) {
        if (Object.keys(o).length !== 8 || o.sourceDomainId !== this.domain || o.sourceSampleRateHz !== this.rate
          || !sourceCoordinate(o.sourceEventSample) || o.sourceEventSample >= p.ownedThroughSourceSample
          || (previous && o.sourceEventSample < previous.frontier)
          || !index(o.targetSample) || o.targetSample < w.ownedStartTarget || o.targetSample >= w.ownedEndTarget
          || o.sourceEventSample !== sourceEventSample(base, o.targetSample, this.rate)
          || !Number.isInteger(o.midiPitch) || o.midiPitch < 21 || o.midiPitch > 108
          || o.pitch !== pianoMidiPitchToName(o.midiPitch)
          || !Number.isFinite(o.confidence) || o.confidence < 0 || o.confidence > 1
          || o.observationId !== sourceObservationId(this.domain, w, o.midiPitch, o.targetSample)) fail('ACOUSTIC_PUBLICATION_OBSERVATION_INVALID');
        if (ids.has(o.observationId)) fail('DUPLICATE_ACOUSTIC_OBSERVATION');
        ids.add(o.observationId);
      }
      this.previous = Object.freeze({ job: w.jobIndex, region: w.regionIndex, index: w.windowIndex,
        ownedEndTarget: w.ownedEndTarget, nextOwnedStartTarget: w.ownedStartTarget + M.ownedMs * ACOUSTIC_TARGET_SAMPLES_PER_MS, frontier: p.ownedThroughSourceSample });
      this.base = base;
      return previous;
    } catch (error) { this.failed = true; throw error; }
  }
}

export function sourcePublication(domain: string, rate: SourceRate, base: number,
  window: AcousticWindow, result: AcousticInferenceResult, availabilityRuntimeMs: number): SourceAcousticPublication {
  if (result.events.length > ACOUSTIC_RESOURCES.maxEventsPerWindow) fail('ACOUSTIC_EVENT_BOUND_EXCEEDED');
  const ids = new Set<string>();
  const observations = result.events.filter(e => e.targetSample >= window.ownedStartTarget && e.targetSample < window.ownedEndTarget).map(e => {
    if (!Number.isSafeInteger(e.targetSample) || !Number.isInteger(e.midiPitch) || e.midiPitch < 21 || e.midiPitch > 108
      || e.pitch !== pianoMidiPitchToName(e.midiPitch)
      || !Number.isFinite(e.confidence) || e.confidence < 0 || e.confidence > 1
      || !Number.isFinite(e.onsetScore) || !Number.isFinite(e.frameScore)) fail('ACOUSTIC_EVENT_IDENTITY_MISMATCH');
    const observationId = sourceObservationId(domain, window, e.midiPitch, e.targetSample);
    if (ids.has(observationId)) fail('DUPLICATE_ACOUSTIC_OBSERVATION');
    ids.add(observationId);
    return Object.freeze({ observationId, pitch: e.pitch, midiPitch: e.midiPitch, confidence: e.confidence,
      sourceDomainId: domain, sourceSampleRateHz: rate, sourceEventSample: sourceEventSample(base, e.targetSample, rate), targetSample: e.targetSample });
  });
  const ownedThroughSourceSample = base + window.ownedEndTarget * rate / M.sampleRateHz;
  if (!Number.isFinite(ownedThroughSourceSample) || ownedThroughSourceSample < 0
    || ownedThroughSourceSample > Number.MAX_SAFE_INTEGER) fail('ACOUSTIC_SOURCE_COORDINATE_OVERFLOW');
  return Object.freeze({ sourceDomainId: domain, sourceSampleRateHz: rate, window: Object.freeze({ ...window }), ownedThroughSourceSample,
    availabilityRuntimeMs, observations: Object.freeze(observations) });
}
export function deliverSynchronously<T>(sink: (value: T) => void, value: T): void {
  try {
    const returned: unknown = sink(value);
    if (returned && typeof (returned as PromiseLike<unknown>).then === 'function') {
      Promise.resolve(returned).catch(() => {}); fail('ACOUSTIC_PUBLICATION_SINK_MUST_BE_SYNCHRONOUS');
    }
  } catch (error) { throw new AcousticAnalysisError('ACOUSTIC_PUBLICATION_SINK_FAILED', { cause: error }); }
}
