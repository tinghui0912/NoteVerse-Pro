import {
  normalizePitchSet,
  pitchSetsEqual,
  type PerformanceEvidenceObservation,
  type StepVerifierObservation,
  type StepVerifierTarget,
} from '../local-core';
import type { AcousticNoteEvent } from './bytedance-contract';

export function acousticEventsToStepObservation(
  target: StepVerifierTarget,
  events: readonly AcousticNoteEvent[]
): StepVerifierObservation | null {
  const expected = normalizePitchSet(target.attackPitches);
  const selected = expected.map((pitch) => earliestFreshEventForPitch(target, events, pitch));
  if (selected.some((event) => event === null)) {
    return null;
  }
  const complete = selected.filter((event): event is AcousticNoteEvent => event !== null);
  if (!pitchSetsEqual(complete.map((event) => event.pitch), expected)) {
    return null;
  }
  const latest = complete.reduce((winner, event) => (
    event.onsetTime.ms > winner.onsetTime.ms ? event : winner
  ));
  return {
    stepId: target.stepId,
    activationGeneration: target.activationGeneration,
    attackOnsetTime: latest.onsetTime,
    captureTime: latest.onsetTime,
    observedAttackPitches: expected,
    confidence: Math.min(...complete.map((event) => event.confidence)),
    source: 'ACOUSTIC',
  };
}

export function acousticEventsToPerformanceEvidence(
  events: readonly AcousticNoteEvent[]
): PerformanceEvidenceObservation[] {
  return events.map((event) => ({
    captureTime: event.onsetTime,
    pitches: [event.pitch],
    confidence: event.confidence,
    source: 'ACOUSTIC',
    inferenceCompletedAtMs: event.inferenceCompletedAtMs,
  }));
}

function earliestFreshEventForPitch(
  target: StepVerifierTarget,
  events: readonly AcousticNoteEvent[],
  pitch: string
): AcousticNoteEvent | null {
  const fresh = events
    .filter((event) => event.pitch === pitch)
    .filter((event) => event.onsetTime.domainId === target.activationBoundary.domainId)
    .filter((event) => event.onsetTime.ms > target.activationBoundary.ms)
    .sort((left, right) => left.onsetTime.ms - right.onsetTime.ms);
  return fresh[0] ?? null;
}
