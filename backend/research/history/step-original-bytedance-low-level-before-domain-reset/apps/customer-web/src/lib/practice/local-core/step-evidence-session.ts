import { normalizePitchSet, pitchSetsEqual, type StepVerifierObservation } from './evidence';
import type { StepPracticeRuntime, StepRuntimeDecision } from './step-runtime';
import type { SessionTime } from './timebase';

export type StepAcousticEvidenceEvent = {
  pitch: string;
  onsetTime: SessionTime;
  confidence: number;
};

export type TargetVerificationPolicy = {
  gestureCoherenceMs: number;
  requiredGestureLookbackMs: number;
};

export type StepEvidencePublication = {
  sessionDomainId: string;
  events: readonly StepAcousticEvidenceEvent[];
  analyzedThroughSessionTimeMs: number;
};

export type StepEvidencePublicationResult = {
  decisions: StepRuntimeDecision[];
  consumedEventCount: number;
  pendingEventCount: number;
  prunedEventCount: number;
};

class StepEvidencePublicationDomainError extends Error {
  readonly code = 'STEP_EVIDENCE_PUBLICATION_DOMAIN_MISMATCH' as const;

  constructor(message = 'STEP evidence publication belongs to a different session domain.') {
    super(message);
    this.name = 'StepEvidencePublicationDomainError';
  }
}

export class StepEvidenceSession {
  private readonly pendingEvents: StepAcousticEvidenceEvent[] = [];
  private analyzedThroughSessionTimeMs = 0;

  constructor(
    private readonly runtime: StepPracticeRuntime,
    private readonly policy: TargetVerificationPolicy
  ) {
    assertTargetVerificationPolicy(policy);
  }

  publishAcousticEvents(publication: StepEvidencePublication): StepEvidencePublicationResult {
    this.validatePublication(publication);

    this.pendingEvents.push(...publication.events);
    this.pendingEvents.sort((left, right) => left.onsetTime.ms - right.onsetTime.ms);
    this.analyzedThroughSessionTimeMs = Math.max(
      this.analyzedThroughSessionTimeMs,
      publication.analyzedThroughSessionTimeMs
    );

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
        this.policy
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
    const afterConsumed = this.pendingEvents.length;
    const pruneBeforeMs = this.analyzedThroughSessionTimeMs - this.policy.requiredGestureLookbackMs;
    while (this.pendingEvents.length > 0 && this.pendingEvents[0].onsetTime.ms < pruneBeforeMs) {
      this.pendingEvents.shift();
    }

    return {
      decisions,
      consumedEventCount: before - afterConsumed,
      prunedEventCount: afterConsumed - this.pendingEvents.length,
      pendingEventCount: this.pendingEvents.length,
    };
  }

  private validatePublication(publication: StepEvidencePublication): void {
    if (publication.sessionDomainId !== this.runtime.localSessionId) {
      throw new StepEvidencePublicationDomainError();
    }
    if (
      !Number.isFinite(publication.analyzedThroughSessionTimeMs)
      || publication.analyzedThroughSessionTimeMs < this.analyzedThroughSessionTimeMs
    ) {
      throw new Error('STEP evidence analysis frontier must be finite and monotonic.');
    }
    for (const event of publication.events) {
      if (event.onsetTime.domainId !== publication.sessionDomainId) {
        throw new StepEvidencePublicationDomainError(
          'STEP evidence event belongs to a different session domain.'
        );
      }
      if (!Number.isFinite(event.onsetTime.ms) || event.onsetTime.ms < 0) {
        throw new Error('STEP evidence event time must be finite and non-negative.');
      }
      if (event.onsetTime.ms > publication.analyzedThroughSessionTimeMs) {
        throw new Error('STEP evidence event time cannot be after the analyzed frontier.');
      }
    }
  }
}

export function observationForCurrentTarget(
  events: readonly StepAcousticEvidenceEvent[],
  target: ReturnType<StepPracticeRuntime['currentTarget']>,
  policy: TargetVerificationPolicy
): StepVerifierObservation | null {
  assertTargetVerificationPolicy(policy);
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
      && candidate.onsetTime.ms - event.onsetTime.ms <= policy.gestureCoherenceMs
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

function assertTargetVerificationPolicy(policy: TargetVerificationPolicy): void {
  if (
    !Number.isFinite(policy.gestureCoherenceMs)
    || policy.gestureCoherenceMs <= 0
    || !Number.isFinite(policy.requiredGestureLookbackMs)
    || policy.requiredGestureLookbackMs < policy.gestureCoherenceMs
  ) {
    throw new Error('Target verification policy must define finite gesture and lookback windows.');
  }
}
