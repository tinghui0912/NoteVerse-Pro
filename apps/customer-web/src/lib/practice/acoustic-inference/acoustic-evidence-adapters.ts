import {
  normalizePitchSet,
  pitchSetsEqual,
  type PerformanceEvidenceObservation,
  type StepVerifierObservation,
  type StepVerifierTarget,
} from '../local-core';
import { BYTEDANCE_INFERENCE_CONTRACT, type AcousticNoteEvent } from './bytedance-contract';

const CHORD_GESTURE_COHERENCE_MS = BYTEDANCE_INFERENCE_CONTRACT.localPreMs
  + BYTEDANCE_INFERENCE_CONTRACT.localPostMs;

export function acousticEventsToStepObservation(
  target: StepVerifierTarget,
  events: readonly AcousticNoteEvent[]
): StepVerifierObservation | null {
  const expected = normalizePitchSet(target.attackPitches);
  const gesture = firstMatchingFreshGesture(target, events, expected);
  if (!gesture) {
    return null;
  }
  const latest = gesture.reduce((winner, event) => (
    event.onsetTime.ms > winner.onsetTime.ms ? event : winner
  ));
  return {
    stepId: target.stepId,
    activationGeneration: target.activationGeneration,
    attackOnsetTime: latest.onsetTime,
    captureTime: latest.onsetTime,
    observedAttackPitches: expected,
    confidence: Math.min(...gesture.map((event) => event.confidence)),
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

function firstMatchingFreshGesture(
  target: StepVerifierTarget,
  events: readonly AcousticNoteEvent[],
  expected: readonly string[]
): AcousticNoteEvent[] | null {
  const fresh = events
    .filter((event) => event.onsetTime.domainId === target.activationBoundary.domainId)
    .filter((event) => event.onsetTime.ms > target.activationBoundary.ms)
    .sort((left, right) => left.onsetTime.ms - right.onsetTime.ms);
  for (const event of fresh) {
    const gesture = fresh.filter((candidate) => (
      candidate.onsetTime.ms >= event.onsetTime.ms
      && candidate.onsetTime.ms - event.onsetTime.ms <= CHORD_GESTURE_COHERENCE_MS
    ));
    if (gesture.length === expected.length
      && pitchSetsEqual(gesture.map((candidate) => candidate.pitch), expected)) {
      return gesture;
    }
  }
  return null;
}
