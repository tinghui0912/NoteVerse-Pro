import type { ContinuousEvidencePublication } from '../../local-core/continuous-evaluation-types';
import type { AcousticInferenceResult } from './inference-types';
import type { AcousticSegment, AcousticWindow } from './window-planner';
import { AcousticAnalysisError, fail, previousFloat, type SourceRate } from './model-contract';
import { ACOUSTIC_RESOURCES } from './resource-policy';

export type AcousticPublicationSink = (publication: ContinuousEvidencePublication) => void;

/** Projection is downstream of decoding; no expected score or product verdict enters this module. */
export function acousticPublication(input: {
  sessionDomainId: string; sourceDomainId: string; sourceBase: number; rate: SourceRate;
  segment: AcousticSegment; window: AcousticWindow; result: AcousticInferenceResult; availabilityTimeMs: number;
}): ContinuousEvidencePublication {
  const { window, segment, result } = input;
  if (result.events.length > ACOUSTIC_RESOURCES.maxEventsPerWindow) fail('ACOUSTIC_EVENT_BOUND_EXCEEDED');
  const ids = new Set<string>();
  const observations = result.events.filter(event => event.onsetTime.ms >= window.ownedStartMs && event.onsetTime.ms < window.ownedEndMs)
    .map(event => {
      const targetSample = event.onsetTime.sampleIndex;
      if (targetSample === undefined || !Number.isSafeInteger(targetSample)
        || !Number.isInteger(event.midiPitch) || event.midiPitch < 21 || event.midiPitch > 108
        || !Number.isFinite(event.confidence) || event.confidence < 0 || event.confidence > 1
        || !Number.isFinite(event.onsetScore) || !Number.isFinite(event.frameScore)
        || Math.abs(event.onsetTime.ms - segment.performanceStartMs - (targetSample - segment.originTarget) / 16) > 1e-6) fail('ACOUSTIC_EVENT_IDENTITY_MISMATCH');
      const sourceNumerator = input.sourceBase * 16000 + targetSample * input.rate;
      if (!Number.isSafeInteger(sourceNumerator)) fail('ACOUSTIC_SOURCE_COORDINATE_OVERFLOW');
      // IDs bind the source domain, segment, immutable raw frame and pitch, not publication timing.
      const observationId = `${input.sourceDomainId}:s${segment.index}:w${window.windowIndex}:p${event.midiPitch}:f${targetSample}`;
      if (ids.has(observationId)) fail('DUPLICATE_ACOUSTIC_OBSERVATION');
      ids.add(observationId);
      return Object.freeze({ observationId, pitch: event.pitch, performanceTimeMs: event.onsetTime.ms,
        confidence: event.confidence, source: 'ACOUSTIC' as const,
        provenance: Object.freeze({ sourceDomainId: input.sourceDomainId, sourceSampleRateHz: input.rate, sourceEventSample: sourceNumerator / 16000 }) });
    });
  return Object.freeze({ publicationId: `${input.sourceDomainId}:window:${window.jobIndex}`,
    sessionDomainId: input.sessionDomainId, analyzedThroughPerformanceMs: previousFloat(window.ownedEndMs),
    availabilityTimeMs: input.availabilityTimeMs, observations: Object.freeze(observations) });
}

export function deliverPublication(sink: AcousticPublicationSink, publication: ContinuousEvidencePublication): void {
  try {
    const returned: unknown = sink(publication);
    if (returned && typeof (returned as PromiseLike<unknown>).then === 'function') {
      Promise.resolve(returned).catch(() => {});
      fail('ACOUSTIC_PUBLICATION_SINK_MUST_BE_SYNCHRONOUS');
    }
  } catch (error) { throw new AcousticAnalysisError('ACOUSTIC_PUBLICATION_SINK_FAILED', { cause: error }); }
}
