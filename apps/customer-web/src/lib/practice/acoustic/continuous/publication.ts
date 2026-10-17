import type { ContinuousEvidencePublication } from '../../local-core/continuous-evaluation-types';
import { deliverSynchronously, type SourceAcousticPublication } from '../runtime/source-publication';
import { fail, previousFloat } from '../model/model-contract';

export type AcousticPublicationSink = (publication: ContinuousEvidencePublication) => void;
export type PerformanceSegment = { index: number; sourceStart: number; originTarget: number;
  performanceStartMs: number; performanceEndMs?: number; sourceEnd?: number };

/** This is the first boundary that gives source evidence a product time. */
export function projectContinuousEvidence(input: SourceAcousticPublication, segment: PerformanceSegment,
  sessionDomainId: string): ContinuousEvidencePublication {
  const w = input.window;
  const start = segment.performanceStartMs + w.windowIndex * 600;
  const end = Math.min(start + 600, segment.performanceEndMs ?? Infinity);
  const inputStartMs = segment.performanceStartMs + (w.startSample - segment.originTarget) / 16;
  const observations = input.observations.map(e => Object.freeze({
    observationId: `${input.sourceDomainId}:s${segment.index}:w${w.windowIndex}:p${e.midiPitch}:f${e.targetSample}`,
    pitch: e.pitch, performanceTimeMs: inputStartMs + (e.targetSample - w.startSample) / 16,
    confidence: e.confidence, source: 'ACOUSTIC' as const,
    provenance: Object.freeze({ sourceDomainId: e.sourceDomainId, sourceSampleRateHz: e.sourceSampleRateHz, sourceEventSample: e.sourceEventSample })
  })).filter(e => e.performanceTimeMs >= start && e.performanceTimeMs < end);
  if (input.availabilityTimeMs < end) fail('INVALID_ACOUSTIC_PUBLICATION_TIME');
  return Object.freeze({ publicationId: `${input.sourceDomainId}:window:${w.jobIndex}`, sessionDomainId,
    analyzedThroughPerformanceMs: previousFloat(end), availabilityTimeMs: input.availabilityTimeMs, observations: Object.freeze(observations) });
}
export function deliverPublication(sink: AcousticPublicationSink, publication: ContinuousEvidencePublication): void {
  deliverSynchronously(sink, publication);
}
