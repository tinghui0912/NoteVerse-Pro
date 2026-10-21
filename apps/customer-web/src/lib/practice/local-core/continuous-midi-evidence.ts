import type { ContinuousEvidencePublication, ContinuousObservation } from './continuous-evaluation-types';

/** MIDI identity is a session-local capture sequence, not a pitch/time collision key. */
export class ContinuousMidiEvidence {
  private observationSequence = 0;
  private publicationSequence = 0;
  private frontier = -Infinity;
  private pending: ContinuousObservation[] = [];

  constructor(private readonly sessionDomainId: string) {}

  observe(pitch: string, performanceTimeMs: number, confidence: number): void {
    if (performanceTimeMs <= this.frontier) throw new Error('MIDI_EVIDENCE_AFTER_COVERAGE');
    this.pending.push({ observationId: `${this.sessionDomainId}:midi:${this.observationSequence++}`,
      pitch, performanceTimeMs, confidence, source: 'MIDI' });
  }

  cover(frontier: number, availabilityTimeMs: number): ContinuousEvidencePublication | null {
    if (frontier <= this.frontier) return null;
    const observations = this.pending.filter(observation => observation.performanceTimeMs <= frontier);
    this.pending = this.pending.filter(observation => observation.performanceTimeMs > frontier);
    this.frontier = frontier;
    return { publicationId: `${this.sessionDomainId}:midi-publication:${this.publicationSequence++}`,
      sessionDomainId: this.sessionDomainId, analyzedThroughPerformanceMs: frontier, availabilityTimeMs, observations };
  }
}
