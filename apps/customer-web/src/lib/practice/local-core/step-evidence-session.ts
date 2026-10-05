import { normalizePitchSet, pitchSetsEqual, type StepVerifierObservation } from './evidence';
import type { StepPracticeRuntime, StepRuntimeDecision } from './step-runtime';
import type { SessionTime } from './timebase';

const DEFAULT_CHORD_GESTURE_COHERENCE_MS = 170;

export type StepAcousticEvidenceEvent = {
  pitch: string;
  onsetTime: SessionTime;
  confidence: number;
};

export type StepEvidencePublicationResult = {
  decisions: StepRuntimeDecision[];
  consumedEventCount: number;
  pendingEventCount: number;
};

export class StepEvidenceSession {
  private readonly pendingEvents: StepAcousticEvidenceEvent[] = [];

  constructor(
    private readonly runtime: StepPracticeRuntime,
    private readonly chordGestureCoherenceMs = DEFAULT_CHORD_GESTURE_COHERENCE_MS
  ) {}

  publishAcousticEvents(events: readonly StepAcousticEvidenceEvent[]): StepEvidencePublicationResult {
    this.pendingEvents.push(...events);
    this.pendingEvents.sort((left, right) => left.onsetTime.ms - right.onsetTime.ms);

    const decisions: StepRuntimeDecision[] = [];
    let consumedThroughMs: number | null = null;

    while (true) {
      const target = this.runtime.currentTarget();
      if (!target) {
        break;
      }
      const observation = observationForCurrentTarget(
        this.pendingEvents,
        target,
        this.chordGestureCoherenceMs
      );
      if (!observation) {
        break;
      }
      const decision = this.runtime.observe(observation);
      decisions.push(decision);
      if (decision.kind !== 'MATCH') {
        break;
      }
      consumedThroughMs = Math.max(consumedThroughMs ?? Number.NEGATIVE_INFINITY, observation.attackOnsetTime.ms);
    }

    const before = this.pendingEvents.length;
    if (consumedThroughMs !== null) {
      while (this.pendingEvents.length > 0 && this.pendingEvents[0].onsetTime.ms <= consumedThroughMs) {
        this.pendingEvents.shift();
      }
    }

    return {
      decisions,
      consumedEventCount: before - this.pendingEvents.length,
      pendingEventCount: this.pendingEvents.length,
    };
  }
}

export function observationForCurrentTarget(
  events: readonly StepAcousticEvidenceEvent[],
  target: ReturnType<StepPracticeRuntime['currentTarget']>,
  chordGestureCoherenceMs = DEFAULT_CHORD_GESTURE_COHERENCE_MS
): StepVerifierObservation | null {
  if (!target) {
    return null;
  }
  const expected = normalizePitchSet(target.attackPitches);
  const fresh = events
    .filter((event) => event.onsetTime.domainId === target.activationBoundary.domainId)
    .filter((event) => event.onsetTime.ms > target.activationBoundary.ms)
    .sort((left, right) => left.onsetTime.ms - right.onsetTime.ms);

  for (const event of fresh) {
    const gesture = fresh.filter((candidate) => (
      candidate.onsetTime.ms >= event.onsetTime.ms
      && candidate.onsetTime.ms - event.onsetTime.ms <= chordGestureCoherenceMs
    ));
    if (gesture.length === expected.length
      && pitchSetsEqual(gesture.map((candidate) => candidate.pitch), expected)) {
      const latest = gesture.reduce((winner, candidate) => (
        candidate.onsetTime.ms > winner.onsetTime.ms ? candidate : winner
      ));
      return {
        stepId: target.stepId,
        activationGeneration: target.activationGeneration,
        attackOnsetTime: latest.onsetTime,
        captureTime: latest.onsetTime,
        observedAttackPitches: expected,
        confidence: Math.min(...gesture.map((candidate) => candidate.confidence)),
        source: 'ACOUSTIC',
      };
    }
  }
  return null;
}
