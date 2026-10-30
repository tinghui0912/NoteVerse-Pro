import type { ContinuousEvidencePublication } from '@/lib/practice/continuous/domain/evaluation/evidence-types';
import { deliverSynchronously, type SourceAcousticPublication } from '../runtime/source-publication';
import { ACOUSTIC_MODEL, ACOUSTIC_TARGET_SAMPLES_PER_MS, fail, previousFloat } from '../model/model-contract';

export type AcousticPublicationSink = (publication: ContinuousEvidencePublication) => void;
export type PerformanceSegment = { index: number; sourceStart: number; originTarget: number;
  performanceStartMs: number; performanceEndMs?: number; sourceEnd?: number };

/** This is the first boundary that gives source evidence a product time. */
export function projectContinuousEvidence(input: SourceAcousticPublication, segment: PerformanceSegment,
  sessionDomainId: string): ContinuousEvidencePublication {
  const w = input.window;
  const samplesPerMs = ACOUSTIC_TARGET_SAMPLES_PER_MS;
  // The scheduler's integer window ordinal avoids cancelling fractional source
  // anchors. Geometry has one owner; event timing still uses source coordinates.
  const start = segment.performanceStartMs + w.windowIndex * ACOUSTIC_MODEL.ownedMs;
  const end = Math.min(start + ACOUSTIC_MODEL.ownedMs, segment.performanceEndMs ?? Infinity);
  const inputStartMs = segment.performanceStartMs + (w.startSample - segment.originTarget) / samplesPerMs;
  const observations = input.observations.map(e => Object.freeze({
    observationId: `${input.sourceDomainId}:s${segment.index}:w${w.windowIndex}:p${e.midiPitch}:f${e.targetSample}`,
    pianoKey: e.midiPitch, performanceTimeMs: inputStartMs + (e.targetSample - w.startSample) / samplesPerMs,
    confidence: e.confidence, source: 'ACOUSTIC' as const,
    provenance: Object.freeze({ sourceDomainId: e.sourceDomainId, sourceSampleRateHz: e.sourceSampleRateHz, sourceEventSample: e.sourceEventSample })
  })).filter(e => e.performanceTimeMs >= start && e.performanceTimeMs < end);
  if (!Number.isFinite(input.availabilityRuntimeMs) || input.availabilityRuntimeMs < 0) fail('INVALID_ACOUSTIC_PUBLICATION_TIME');
  // The injected Continuous runtime clock is the established session clock domain.
  // Physical/source event mapping above is independent of when analysis becomes available.
  return Object.freeze({ publicationId: `${input.sourceDomainId}:window:${w.jobIndex}`, sessionDomainId,
    analyzedThroughPerformanceMs: previousFloat(end), availabilitySessionTimeMs: input.availabilityRuntimeMs, observations: Object.freeze(observations) });
}
export function deliverPublication(sink: AcousticPublicationSink, publication: ContinuousEvidencePublication): void {
  deliverSynchronously(sink, publication);
}
