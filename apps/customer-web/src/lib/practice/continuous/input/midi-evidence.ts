import { CONTINUOUS_MIDI_EVIDENCE_POLICY_ID } from './midi-evidence-identity';
import type { ContinuousClockDrivenEvidencePort } from '@/lib/practice/continuous/domain/clock-evidence-port';
import type { ContinuousEvidencePublication, ContinuousObservation } from '@/lib/practice/continuous/domain/evaluation/evidence-types';

export const DEFAULT_MIDI_COVERAGE_GRACE_MS = 250;

/** MIDI identity is a session-local capture sequence, not a pitch/time collision key. */
export class ContinuousMidiEvidence implements ContinuousClockDrivenEvidencePort {
  readonly evidencePolicyId = CONTINUOUS_MIDI_EVIDENCE_POLICY_ID;
  private observationSequence = 0;
  private publicationSequence = 0;
  private frontier = -Infinity;
  private pending: ContinuousObservation[] = [];

  constructor(private readonly sessionDomainId: string) {}

  observe(pitch: string, performanceTimeMs: number, confidence: number, deliveryPerformanceTimeMs: number): void {
    // A deadline closes before a delivery at the same instant, even if no refresh ran.
    if (performanceTimeMs <= this.frontier || deliveryPerformanceTimeMs >= performanceTimeMs + DEFAULT_MIDI_COVERAGE_GRACE_MS) {
      throw new Error('MIDI_EVIDENCE_AFTER_COVERAGE');
    }
    this.pending.push({ observationId: `${this.sessionDomainId}:midi:${this.observationSequence++}`,
      pitch, performanceTimeMs, confidence, source: 'MIDI' });
  }

  nextDeadline(requiredAnalysisFrontierMs: number | null) {
    let analyzedThroughPerformanceMs = requiredAnalysisFrontierMs !== null && requiredAnalysisFrontierMs > this.frontier
      ? requiredAnalysisFrontierMs : Infinity;
    for (const observation of this.pending) {
      if (observation.performanceTimeMs > this.frontier) analyzedThroughPerformanceMs = Math.min(analyzedThroughPerformanceMs, observation.performanceTimeMs);
    }
    if (!Number.isFinite(analyzedThroughPerformanceMs)) return null;
    return Object.freeze({ analyzedThroughPerformanceMs, duePerformanceTimeMs: analyzedThroughPerformanceMs + DEFAULT_MIDI_COVERAGE_GRACE_MS });
  }

  complete(terminalPerformanceMs: number, availabilitySessionTimeMs: number): ContinuousEvidencePublication | null {
    return this.cover(terminalPerformanceMs, availabilitySessionTimeMs);
  }

  cover(frontier: number, availabilitySessionTimeMs: number): ContinuousEvidencePublication | null {
    if (frontier <= this.frontier) return null;
    const observations = this.pending.filter(observation => observation.performanceTimeMs <= frontier);
    this.pending = this.pending.filter(observation => observation.performanceTimeMs > frontier);
    this.frontier = frontier;
    return { publicationId: `${this.sessionDomainId}:midi-publication:${this.publicationSequence++}`,
      sessionDomainId: this.sessionDomainId, analyzedThroughPerformanceMs: frontier, availabilitySessionTimeMs, observations };
  }
}
