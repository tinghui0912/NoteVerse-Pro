import {
  ContinuousEvaluationError, immutableContinuousValue,
  type ContinuousEvidencePublication, type ContinuousObservation,
} from './continuous-evaluation-types';

export const compareContinuousId = (a: string, b: string): number => a.localeCompare(b);

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => compareContinuousId(a, b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Evidence identity and coverage only. This store has no score or assignment knowledge. */
export class ContinuousEvidenceStore {
  private readonly publications = new Map<string, string>();
  private readonly observations = new Map<string, ContinuousObservation>();
  private frontier = -Infinity;
  private availability = -Infinity;

  constructor(readonly sessionDomainId: string) {
    if (!sessionDomainId) throw new ContinuousEvaluationError('SESSION_DOMAIN_MISMATCH');
  }

  get analyzedThrough(): number { return this.frontier; }
  get availableAt(): number { return this.availability; }
  values(): readonly ContinuousObservation[] { return [...this.observations.values()]; }

  accept(input: ContinuousEvidencePublication, closed: boolean): ContinuousEvidencePublication | null {
    if (!Array.isArray(input.observations)) throw new ContinuousEvaluationError('INVALID_PUBLICATION');
    const publication = { ...structuredClone(input),
      observations: [...structuredClone(input.observations)].sort((a, b) => compareContinuousId(a.observationId, b.observationId)) };
    const identity = canonical(publication);
    const previous = this.publications.get(publication.publicationId);
    if (previous !== undefined) {
      if (identity !== previous) throw new ContinuousEvaluationError('PUBLICATION_MUTATED');
      return null;
    }
    if (closed) throw new ContinuousEvaluationError('PUBLICATION_AFTER_COMPLETION');
    if (publication.sessionDomainId !== this.sessionDomainId) throw new ContinuousEvaluationError('SESSION_DOMAIN_MISMATCH');
    const { analyzedThroughPerformanceMs: frontier, availabilityTimeMs: availability } = publication;
    if (!publication.publicationId || !Number.isFinite(frontier) || frontier < 0 || frontier < this.frontier
      || !Number.isFinite(availability) || availability < frontier || availability < this.availability) {
      throw new ContinuousEvaluationError('INVALID_PUBLICATION');
    }
    const incoming = new Set<string>();
    for (const observation of publication.observations) {
      if (!observation.observationId || !observation.pitch || !Number.isFinite(observation.performanceTimeMs)
        || observation.performanceTimeMs < 0 || observation.performanceTimeMs > frontier
        || !Number.isFinite(observation.confidence) || observation.confidence < 0 || observation.confidence > 1
        || !['MIDI', 'ACOUSTIC'].includes(observation.source)) throw new ContinuousEvaluationError('INVALID_PUBLICATION');
      if (incoming.has(observation.observationId) || this.observations.has(observation.observationId)) {
        throw new ContinuousEvaluationError('DUPLICATE_OBSERVATION');
      }
      if (observation.performanceTimeMs <= this.frontier) throw new ContinuousEvaluationError('LATE_EVIDENCE');
      if (observation.provenance && (!observation.provenance.sourceDomainId
        || !Number.isFinite(observation.provenance.sourceEventSample)
        || observation.provenance.sourceEventSample < 0 || !Number.isFinite(observation.provenance.sourceSampleRateHz)
        || observation.provenance.sourceSampleRateHz <= 0)) throw new ContinuousEvaluationError('INVALID_PUBLICATION');
      incoming.add(observation.observationId);
    }
    const frozen = immutableContinuousValue(publication);
    for (const observation of frozen.observations) this.observations.set(observation.observationId, observation);
    this.publications.set(frozen.publicationId, identity);
    this.frontier = frontier;
    this.availability = availability;
    return frozen;
  }
}
