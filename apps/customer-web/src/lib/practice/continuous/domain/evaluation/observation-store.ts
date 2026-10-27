import { ContinuousEvaluationError } from './evaluation-error';
import { immutableContinuousValue } from './immutable-value';
import { CONTINUOUS_EVALUATION_RESOURCES as resources, assertContinuousResourceCount, assertContinuousIdentityBudget } from './resource-policy';
import type { ContinuousEvidencePublication, ContinuousObservation } from './evidence-types';

export const compareContinuousId = (a: string, b: string): number => a.localeCompare(b);

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => compareContinuousId(a, b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value);
}

type PublicationReceipt = Readonly<{ sessionDomainId: string; analyzedThroughPerformanceMs: number;
  availabilitySessionTimeMs: number; headerIdentity: string; observationIds: readonly string[] }>;
export type PreparedContinuousEvidence = Readonly<{ publication: ContinuousEvidencePublication;
  byTime: readonly ContinuousObservation[]; byPitch: ReadonlyMap<string, readonly ContinuousObservation[]> }>;

/** Evidence retention and local indexes, without score/assignment knowledge. */
export class ContinuousEvidenceStore {
  private readonly publications = new Map<string, PublicationReceipt>();
  private readonly observations = new Map<string, ContinuousObservation>();
  private readonly retained: ContinuousObservation[] = [];
  private readonly byTime: ContinuousObservation[] = [];
  private readonly byPitch = new Map<string, ContinuousObservation[]>();
  private frontier = -Infinity;
  private availability = -Infinity;
  private failure: ContinuousEvaluationError | null = null;

  constructor(readonly sessionDomainId: string) {
    if (!sessionDomainId) throw new ContinuousEvaluationError('SESSION_DOMAIN_MISMATCH');
  }
  get analyzedThrough(): number { return this.frontier; }
  get availableSessionTimeMs(): number { return this.availability; }
  get observationCount(): number { return this.retained.length; }
  get publicationCount(): number { return this.publications.size; }
  observation(id: string): ContinuousObservation | undefined { return this.observations.get(id); }
  values(): readonly ContinuousObservation[] { return Object.freeze([...this.retained]); }
  inRange(start: number, end: number, pitch?: string): readonly ContinuousObservation[] {
    return observationsInRange(pitch === undefined ? this.byTime : this.byPitch.get(pitch) ?? [], start, end);
  }
  accept(input: ContinuousEvidencePublication, closed: boolean): ContinuousEvidencePublication | null {
    const prepared = this.prepare(input, closed);
    if (!prepared) return null;
    this.retain(prepared);
    return prepared.publication;
  }
  /** Validate and budget the entire incoming publication before any retained mutation. */
  prepare(input: ContinuousEvidencePublication, closed: boolean): PreparedContinuousEvidence | null {
    if (this.failure) throw this.failure;
    try { return this.preparePublication(input, closed); }
    catch (error) {
      if (error instanceof ContinuousEvaluationError && error.code === 'CONTINUOUS_EVALUATION_RESOURCE_LIMIT_EXCEEDED') this.failure = error;
      throw error;
    }
  }
  private preparePublication(input: ContinuousEvidencePublication, closed: boolean): PreparedContinuousEvidence | null {
    if (!Array.isArray(input.observations)) throw new ContinuousEvaluationError('INVALID_PUBLICATION');
    const previous = this.publications.get(input.publicationId);
    if (previous) {
      if (input.observations.length !== previous.observationIds.length
        || canonical({ ...input, observations: undefined }) !== previous.headerIdentity) throw new ContinuousEvaluationError('PUBLICATION_MUTATED');
      const observations = [...input.observations].sort((a, b) => compareContinuousId(a.observationId, b.observationId));
      if (input.sessionDomainId !== previous.sessionDomainId || input.analyzedThroughPerformanceMs !== previous.analyzedThroughPerformanceMs
        || input.availabilitySessionTimeMs !== previous.availabilitySessionTimeMs || observations.length !== previous.observationIds.length
        || observations.some((o, i) => o.observationId !== previous.observationIds[i] || canonical(o) !== canonical(this.observations.get(o.observationId)))) {
        throw new ContinuousEvaluationError('PUBLICATION_MUTATED');
      }
      return null;
    }
    if (closed) throw new ContinuousEvaluationError('PUBLICATION_AFTER_COMPLETION');
    if (input.sessionDomainId !== this.sessionDomainId) throw new ContinuousEvaluationError('SESSION_DOMAIN_MISMATCH');
    assertContinuousResourceCount(input.observations.length, resources.maxObservationsPerPublication);
    assertContinuousIdentityBudget(input.sessionDomainId);
    assertContinuousIdentityBudget(input.publicationId);
    const { analyzedThroughPerformanceMs: frontier, availabilitySessionTimeMs: availability } = input;
    if (!input.publicationId || !Number.isFinite(frontier) || frontier < 0 || frontier < this.frontier
      || !Number.isFinite(availability) || availability < 0 || availability < this.availability) throw new ContinuousEvaluationError('INVALID_PUBLICATION');
    const incoming = new Set<string>();
    for (const observation of input.observations) {
      if (!observation.observationId || !observation.pitch || !Number.isFinite(observation.performanceTimeMs)
        || observation.performanceTimeMs < 0 || observation.performanceTimeMs > frontier
        || !Number.isFinite(observation.confidence) || observation.confidence < 0 || observation.confidence > 1
        || !['MIDI', 'ACOUSTIC'].includes(observation.source)) throw new ContinuousEvaluationError('INVALID_PUBLICATION');
      assertContinuousIdentityBudget(observation.observationId); assertContinuousIdentityBudget(observation.pitch, true);
      if (incoming.has(observation.observationId) || this.observations.has(observation.observationId)) throw new ContinuousEvaluationError('DUPLICATE_OBSERVATION');
      if (observation.performanceTimeMs <= this.frontier) throw new ContinuousEvaluationError('LATE_EVIDENCE');
      if (observation.provenance) {
        if (!observation.provenance.sourceDomainId || !Number.isFinite(observation.provenance.sourceEventSample)
          || observation.provenance.sourceEventSample < 0 || !Number.isFinite(observation.provenance.sourceSampleRateHz)
          || observation.provenance.sourceSampleRateHz <= 0) throw new ContinuousEvaluationError('INVALID_PUBLICATION');
        assertContinuousIdentityBudget(observation.provenance.sourceDomainId);
      }
      incoming.add(observation.observationId);
    }
    assertContinuousResourceCount(this.observations.size + input.observations.length, resources.maxRetainedObservations);
    assertContinuousResourceCount(this.publications.size + 1, resources.maxRetainedPublications);
    const publication = immutableContinuousValue(structuredClone({ ...input, observations: [...input.observations]
      .sort((a, b) => compareContinuousId(a.observationId, b.observationId)) }));
    const byTime = [...publication.observations].sort((a, b) => a.performanceTimeMs - b.performanceTimeMs || compareContinuousId(a.observationId, b.observationId));
    const byPitch = new Map<string, ContinuousObservation[]>();
    for (const o of byTime) { const bucket = byPitch.get(o.pitch) ?? []; bucket.push(o); byPitch.set(o.pitch, bucket); }
    return { publication, byTime, byPitch };
  }
  /** Called only after the assignment transaction has also passed all resource checks. */
  retain(prepared: PreparedContinuousEvidence): void {
    const { publication, byTime, byPitch } = prepared;
    for (const o of publication.observations) { this.observations.set(o.observationId, o); this.retained.push(o); }
    this.byTime.push(...byTime);
    for (const [pitch, batch] of byPitch) { const bucket = this.byPitch.get(pitch) ?? []; bucket.push(...batch); this.byPitch.set(pitch, bucket); }
    this.publications.set(publication.publicationId, Object.freeze({ sessionDomainId: publication.sessionDomainId,
      analyzedThroughPerformanceMs: publication.analyzedThroughPerformanceMs, availabilitySessionTimeMs: publication.availabilitySessionTimeMs, headerIdentity: canonical({ ...publication, observations: undefined }),
      observationIds: Object.freeze(publication.observations.map(o => o.observationId)) }));
    this.frontier = publication.analyzedThroughPerformanceMs; this.availability = publication.availabilitySessionTimeMs;
  }
}

/** Inclusive performance-time range over a monotonically appended source-blind index. */
export function observationsInRange(values: readonly ContinuousObservation[], start: number, end: number): readonly ContinuousObservation[] {
  let lo = 0, hi = values.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (values[mid].performanceTimeMs < start) lo = mid + 1; else hi = mid; }
  const begin = lo; hi = values.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (values[mid].performanceTimeMs <= end) lo = mid + 1; else hi = mid; }
  return values.slice(begin, lo);
}
