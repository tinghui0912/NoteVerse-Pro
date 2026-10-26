import { AcousticAnalysisError, fail, type SourceRate } from '../model/model-contract';
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
export function sourcePublication(domain: string, rate: SourceRate, base: number,
  window: AcousticWindow, result: AcousticInferenceResult, availabilityRuntimeMs: number): SourceAcousticPublication {
  if (result.events.length > ACOUSTIC_RESOURCES.maxEventsPerWindow) fail('ACOUSTIC_EVENT_BOUND_EXCEEDED');
  const ids = new Set<string>();
  const observations = result.events.filter(e => e.targetSample >= window.ownedStartTarget && e.targetSample < window.ownedEndTarget).map(e => {
    if (!Number.isSafeInteger(e.targetSample) || !Number.isInteger(e.midiPitch) || e.midiPitch < 21 || e.midiPitch > 108
      || !Number.isFinite(e.confidence) || e.confidence < 0 || e.confidence > 1
      || !Number.isFinite(e.onsetScore) || !Number.isFinite(e.frameScore)) fail('ACOUSTIC_EVENT_IDENTITY_MISMATCH');
    const numerator = base * 16000 + e.targetSample * rate;
    if (!Number.isSafeInteger(numerator)) fail('ACOUSTIC_SOURCE_COORDINATE_OVERFLOW');
    const observationId = `${domain}:r${window.regionIndex}:w${window.windowIndex}:p${e.midiPitch}:f${e.targetSample}`;
    if (ids.has(observationId)) fail('DUPLICATE_ACOUSTIC_OBSERVATION');
    ids.add(observationId);
    return Object.freeze({ observationId, pitch: e.pitch, midiPitch: e.midiPitch, confidence: e.confidence,
      sourceDomainId: domain, sourceSampleRateHz: rate, sourceEventSample: numerator / 16000, targetSample: e.targetSample });
  });
  const ownedThroughSourceSample = base + window.ownedEndTarget * rate / 16000;
  if (!Number.isFinite(ownedThroughSourceSample) || ownedThroughSourceSample < 0
    || ownedThroughSourceSample > Number.MAX_SAFE_INTEGER) fail('ACOUSTIC_SOURCE_COORDINATE_OVERFLOW');
  return Object.freeze({ sourceDomainId: domain, sourceSampleRateHz: rate, window, ownedThroughSourceSample,
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
