import { isPracticePianoKey } from '@/lib/practice/kernel/piano-key';
import type { PracticePianoKey } from '@/lib/practice/kernel/piano-key';
import { matchOrderedSameKeyEvidence } from '@/lib/practice/continuous/domain/evaluation/same-key-matching';
import { CONTINUOUS_ASSIGNMENT_WINDOW_MS, directObservationClaimants, directStrikeCohort, directStrikeFrontier, withinContinuousWindow } from '@/lib/practice/continuous/domain/evaluation/finalization-policy';
import { compareContinuousId, ContinuousEvidenceStore, observationsInRange, type PreparedContinuousEvidence } from '@/lib/practice/continuous/domain/evaluation/observation-store';
import { completeContinuousAssignment } from '@/lib/practice/continuous/domain/evaluation/assignment-projection';
import { ContinuousEvaluationError } from '@/lib/practice/continuous/domain/evaluation/evaluation-error';
import { immutableContinuousValue } from '@/lib/practice/continuous/domain/evaluation/immutable-value';
import type { ContinuousEvidencePublication, ContinuousObservation } from '@/lib/practice/continuous/domain/evaluation/evidence-types';
import type { ContinuousCompletion, ContinuousExpectedStrike, UnattributedContinuousObservation, ContinuousFinality, ContinuousGroupAssignment, ContinuousTargetState, ContinuousObservationAssignment, ContinuousStrikeAssignment, FinalizedContinuousStrikeAssignment } from '@/lib/practice/continuous/domain/evaluation/assignment-types';
import type { ContinuousAssignmentSnapshot } from '@/lib/practice/continuous/domain/evaluation/assignment-types';


type Group = { groupId: string; time: number; strikes: readonly ContinuousExpectedStrike[] };
const byStrikeId = (a: ContinuousExpectedStrike, b: ContinuousExpectedStrike) => compareContinuousId(a.strikeId, b.strikeId);
const byObservationId = (a: ContinuousObservation, b: ContinuousObservation) => compareContinuousId(a.observationId, b.observationId);

type AssignmentTransaction = {
  evidence: PreparedContinuousEvidence | null;
  publication: ContinuousEvidencePublication;
  requested: ContinuousCompletion | null;
  strikes: Map<string, ContinuousStrikeAssignment>;
  groups: Map<string, ContinuousGroupAssignment>;
  owners: Map<string, ContinuousObservationAssignment>;
  unattributed: UnattributedContinuousObservation[];
  strikeCursor: number;
  completion: ContinuousCompletion | null;
};

/** Source-blind assignment finality. No capture clock, score parser, model, or UI authority. */
export class ContinuousAssignmentFinalizer {
  private readonly evidence: ContinuousEvidenceStore;
  private readonly strikes: readonly ContinuousExpectedStrike[];
  private readonly groups: readonly Group[];
  private readonly strikeFrontiers = new Map<string, number>();
  private readonly committedStrikes = new Map<string, ContinuousStrikeAssignment>();
  private readonly committedGroups = new Map<string, ContinuousGroupAssignment>();
  private readonly owners = new Map<string, ContinuousObservationAssignment>();
  private readonly unattributedObservations: UnattributedContinuousObservation[] = [];
  private readonly unowned = new Map<string, ContinuousObservation>();
  private readonly strikesByKey = new Map<PracticePianoKey, ContinuousExpectedStrike[]>();
  private readonly groupById = new Map<string, Group>();
  private readonly strikeOrder = new Map<string, number>();
  private readonly frontierOrder: readonly ContinuousExpectedStrike[];
  private strikeCursor = 0;
  private transaction: AssignmentTransaction | null = null;
  private requestedCompletion: ContinuousCompletion | null = null;
  private completion: ContinuousCompletion | null = null;
  private failure: Error | null = null;

  constructor(sessionDomainId: string, expectedStrikes: readonly ContinuousExpectedStrike[]) {
    this.evidence = new ContinuousEvidenceStore(sessionDomainId);
    this.strikes = immutableContinuousValue(structuredClone([...expectedStrikes]).sort((a, b) =>
      a.expectedPerformanceTimeMs - b.expectedPerformanceTimeMs || byStrikeId(a, b)));
    const grouped = new Map<string, ContinuousExpectedStrike[]>();
    const ids = new Set<string>();
    for (const [order, strike] of this.strikes.entries()) {
      if (!strike.strikeId || ids.has(strike.strikeId) || !strike.groupId || !isPracticePianoKey(strike.pianoKey)
        || !Number.isFinite(strike.expectedPerformanceTimeMs) || strike.expectedPerformanceTimeMs < 0
        || !Array.isArray(strike.renderNoteIds)) throw new ContinuousEvaluationError('INVALID_EXPECTED_GROUP');
      this.strikeOrder.set(strike.strikeId, order);
      const bucket = this.strikesByKey.get(strike.pianoKey) ?? [];
      bucket.push(strike); this.strikesByKey.set(strike.pianoKey, bucket);
      ids.add(strike.strikeId);
      const group = grouped.get(strike.groupId) ?? [];
      if (group.some(other => other.expectedPerformanceTimeMs !== strike.expectedPerformanceTimeMs)) {
        throw new ContinuousEvaluationError('INVALID_EXPECTED_GROUP', 'A practice group must share one canonical onset time.');
      }
      group.push(strike);
      grouped.set(strike.groupId, group);
    }
    this.groups = [...grouped].map(([groupId, strikes]) => ({
      groupId, strikes, time: strikes[0].expectedPerformanceTimeMs,
    })).sort((a, b) => a.time - b.time || compareContinuousId(a.groupId, b.groupId));
    for (const group of this.groups) this.groupById.set(group.groupId, group);
    for (const strike of this.strikes) this.strikeFrontiers.set(strike.strikeId, directStrikeFrontier(strike,
      this.strikeRange(strike.pianoKey, strike.expectedPerformanceTimeMs - 2 * CONTINUOUS_ASSIGNMENT_WINDOW_MS,
        strike.expectedPerformanceTimeMs + 2 * CONTINUOUS_ASSIGNMENT_WINDOW_MS)));
    this.frontierOrder = [...this.strikes].sort((a, b) => this.frontier(a) - this.frontier(b)
      || this.strikeOrder.get(a.strikeId)! - this.strikeOrder.get(b.strikeId)!);
  }

  publish(publication: ContinuousEvidencePublication): void {
    if (this.failure) throw this.failure;
    try {
      if (this.requestedCompletion && publication.analyzedThroughPerformanceMs > this.requestedCompletion.performanceTimeMs) {
        throw new ContinuousEvaluationError('PUBLICATION_AFTER_COMPLETION');
      }
      const prepared = this.evidence.prepare(publication, this.completion !== null);
      if (prepared) {
        if (this.requestedCompletion && publication.availabilitySessionTimeMs < this.requestedCompletion.availabilitySessionTimeMs) throw new ContinuousEvaluationError('INVALID_PUBLICATION');
        this.planAndCommit(prepared.publication, prepared, this.requestedCompletion);
      }
      return;
    } catch (error) { return this.fail(error); }
  }

  complete(completion: ContinuousCompletion): void {
    if (this.failure) throw this.failure;
    if (!['SCOPE_COMPLETED', 'STOPPED_BY_USER'].includes(completion.reason)
      || !Number.isFinite(completion.performanceTimeMs) || completion.performanceTimeMs < 0 || completion.performanceTimeMs < this.evidence.analyzedThrough
      || !Number.isFinite(completion.availabilitySessionTimeMs) || completion.availabilitySessionTimeMs < 0
      || !this.requestedCompletion && completion.availabilitySessionTimeMs < this.evidence.availableSessionTimeMs) {
      throw new ContinuousEvaluationError('INVALID_PUBLICATION');
    }
    if (this.requestedCompletion) {
      if (JSON.stringify(this.requestedCompletion) !== JSON.stringify(completion)) throw new ContinuousEvaluationError('COMPLETION_MUTATED');
      return;
    }
    const requested = immutableContinuousValue({ ...completion });
    if (this.evidence.analyzedThrough >= completion.performanceTimeMs) {
      try {
        this.planAndCommit({ publicationId: 'completion', sessionDomainId: this.evidence.sessionDomainId,
          analyzedThroughPerformanceMs: this.evidence.analyzedThrough,
          availabilitySessionTimeMs: Math.max(this.evidence.availableSessionTimeMs, completion.availabilitySessionTimeMs), observations: [] }, null, requested);
      } catch (error) { return this.fail(error); }
    } else this.requestedCompletion = requested;
    return;
  }

  private fail(error: unknown): never {
    this.failure = error instanceof Error ? error : new Error(String(error));
    throw this.failure;
  }

  /** All incoming evidence/ownership/frontier work is staged. Correctness failure discards the plan. */
  private planAndCommit(publication: ContinuousEvidencePublication, evidence: PreparedContinuousEvidence | null, requested: ContinuousCompletion | null): void {
    const draft: AssignmentTransaction = { evidence, publication, requested, strikes: new Map(), groups: new Map(), owners: new Map(),
      unattributed: [], strikeCursor: this.strikeCursor, completion: this.completion };
    this.transaction = draft;
    try { this.commit(); this.closeCompletion(); }
    finally { this.transaction = null; }
    // No assignment computation remains after this point.
    if (evidence) {
      this.evidence.retain(evidence);
      for (const o of evidence.publication.observations) this.unowned.set(o.observationId, o);
    }
    for (const [id, value] of draft.strikes) this.committedStrikes.set(id, value);
    for (const [id, value] of draft.groups) this.committedGroups.set(id, value);
    for (const [id, value] of draft.owners) { this.owners.set(id, value); this.unowned.delete(id); }
    for (const observation of draft.unattributed) this.unattributedObservations.push(observation);
    this.strikeCursor = draft.strikeCursor;
    this.requestedCompletion = requested; this.completion = draft.completion;
  }

  /** Presentation reads only source-blind target identity/state, never a match payload. */
  targetStates(): readonly ContinuousTargetState[] {
    return immutableContinuousValue(this.groups.flatMap(group => group.strikes.map(strike => ({
      strikeId: strike.strikeId, renderNoteIds: strike.renderNoteIds, state: this.strikeState(strike).state,
    }))));
  }

  snapshot(): ContinuousAssignmentSnapshot {
    return Object.freeze({
      sessionDomainId: this.evidence.sessionDomainId,
      analyzedThroughPerformanceMs: Number.isFinite(this.evidence.analyzedThrough) ? this.evidence.analyzedThrough : null,
      groups: Object.freeze(this.groups.map(group => this.committedGroups.get(group.groupId) ?? Object.freeze({
        groupId: group.groupId, performanceTimeMs: group.time, state: 'PENDING' as const,
        strikes: Object.freeze(group.strikes.map(strike => this.strikeState(strike))), finality: null,
      }))),
      observations: this.evidence.values(), unattributedObservations: Object.freeze([...this.unattributedObservations]),
      observationAssignments: Object.freeze([...this.owners.values()].sort((a, b) => compareContinuousId(a.observationId, b.observationId))),
      reservedObservationIds: Object.freeze(this.unownedObservations().filter(observation => this.claimants(observation).some(strike => !this.hasStrike(strike.strikeId)))
        .map(observation => observation.observationId).sort(compareContinuousId)),
      completion: this.completion,
    });
  }

  completedAssignment() { return completeContinuousAssignment(this.snapshot()); }
  retentionSnapshot() {
    return Object.freeze({ observationCount: this.evidence.observationCount, publicationCount: this.evidence.publicationCount,
      unownedObservationCount: this.unowned.size, availabilitySessionTimeMs: this.evidence.availableSessionTimeMs });
  }

  /** Read-only semantic coverage need; no scan of finalized history. */
  nextRequiredAnalysisFrontier(): number | null {
    if (this.failure) throw this.failure;
    if (this.completion) return null;
    let next = Infinity;
    for (let i = this.strikeCursor; i < this.frontierOrder.length; i++) {
      const strike = this.frontierOrder[i];
      if (!this.hasStrike(strike.strikeId) && this.frontier(strike) > this.analyzedThrough) { next = this.frontier(strike); break; }
    }
    for (const observation of this.unowned.values()) {
      const frontier = this.unattributedFrontier(observation); if (frontier > this.analyzedThrough) next = Math.min(next, frontier);
    }
    return Number.isFinite(next) ? next : null;
  }

  private hasStrike(id: string): boolean { return this.transaction?.strikes.has(id) || this.committedStrikes.has(id); }
  private hasGroup(id: string): boolean { return this.transaction?.groups.has(id) || this.committedGroups.has(id); }
  private strikeState(strike: ContinuousExpectedStrike): ContinuousStrikeAssignment {
    return this.transaction?.strikes.get(strike.strikeId) ?? this.committedStrikes.get(strike.strikeId) ?? Object.freeze({ ...strike, state: 'PENDING' });
  }
  private get analyzedThrough(): number { return this.transaction?.publication.analyzedThroughPerformanceMs ?? this.evidence.analyzedThrough; }
  private get terminal(): number {
    const requested = this.transaction?.requested ?? this.requestedCompletion;
    return requested && this.analyzedThrough >= requested.performanceTimeMs ? requested.performanceTimeMs : Infinity;
  }
  private frontier(strike: ContinuousExpectedStrike): number { return this.strikeFrontiers.get(strike.strikeId)!; }
  private strikeRange(pianoKey: PracticePianoKey, start: number, end: number): readonly ContinuousExpectedStrike[] {
    return assignmentTimeRange(this.strikesByKey.get(pianoKey) ?? [], start, end, strike => strike.expectedPerformanceTimeMs);
  }
  private claimants(observation: ContinuousObservation) {
    return directObservationClaimants(observation, this.strikeRange(observation.pianoKey,
      observation.performanceTimeMs - CONTINUOUS_ASSIGNMENT_WINDOW_MS, observation.performanceTimeMs + CONTINUOUS_ASSIGNMENT_WINDOW_MS));
  }
  private observationRange(start: number, end: number, pianoKey?: PracticePianoKey): readonly ContinuousObservation[] {
    const prepared = this.transaction?.evidence;
    const incoming = !prepared ? [] : observationsInRange(pianoKey === undefined ? prepared.byTime : prepared.byKey.get(pianoKey) ?? [], start, end);
    return [...this.evidence.inRange(start, end, pianoKey), ...incoming];
  }
  private isUnowned(id: string): boolean { return !this.owners.has(id) && !this.transaction?.owners.has(id); }
  private unownedObservations(): ContinuousObservation[] {
    return [...this.unowned.values(), ...this.transaction?.evidence?.publication.observations ?? []].filter(o => this.isUnowned(o.observationId));
  }
  private claim(assignment: ContinuousObservationAssignment): void {
    if (!this.isUnowned(assignment.observationId)) throw new ContinuousEvaluationError('OWNERSHIP_VIOLATION');
    this.transaction!.owners.set(assignment.observationId, immutableContinuousValue(assignment));
  }
  private finality(required: number): ContinuousFinality {
    const publication = this.transaction!.publication;
    return { requiredAnalysisFrontierMs: Math.min(required, this.terminal), unclampedRequiredFrontierMs: required,
      enablingPublicationId: publication.publicationId, enablingAnalysisFrontierMs: this.analyzedThrough,
      finalizationSessionTimeMs: publication.availabilitySessionTimeMs, terminalClamp: required > this.terminal };
  }

  private commit(): void {
    this.commitStrikes();
    // Only groups touched by newly finalized strikes need a completion check.
    const touched = new Set([...this.transaction!.strikes.values()].map(strike => this.groupById.get(strike.groupId)!));
    for (const group of [...touched].sort((a, b) => a.time - b.time || compareContinuousId(a.groupId, b.groupId))) {
      if (!this.hasGroup(group.groupId) && group.strikes.every(strike => this.strikeState(strike).state !== 'PENDING')) this.finishGroup(group);
    }
    this.commitUnattributedObservations();
  }

  private commitStrikes(): void {
    const draft = this.transaction!, eligible: ContinuousExpectedStrike[] = [];
    while (draft.strikeCursor < this.frontierOrder.length) {
      const strike = this.frontierOrder[draft.strikeCursor];
      if (Math.min(this.frontier(strike), this.terminal) > this.analyzedThrough) break;
      draft.strikeCursor++; if (!this.hasStrike(strike.strikeId)) eligible.push(strike);
    }
    eligible.sort((a, b) => this.strikeOrder.get(a.strikeId)! - this.strikeOrder.get(b.strikeId)!);
    for (const anchor of eligible) {
      const cohort = directStrikeCohort(anchor, this.strikeRange(anchor.pianoKey,
        anchor.expectedPerformanceTimeMs - 2 * CONTINUOUS_ASSIGNMENT_WINDOW_MS, anchor.expectedPerformanceTimeMs + 2 * CONTINUOUS_ASSIGNMENT_WINDOW_MS))
        .filter(strike => !this.hasStrike(strike.strikeId));
      const observations = this.observationRange(cohort.reduce((min, s) => Math.min(min, s.expectedPerformanceTimeMs), Infinity) - CONTINUOUS_ASSIGNMENT_WINDOW_MS,
        cohort.reduce((max, s) => Math.max(max, s.expectedPerformanceTimeMs), -Infinity) + CONTINUOUS_ASSIGNMENT_WINDOW_MS, anchor.pianoKey)
        .filter(o => this.isUnowned(o.observationId) && cohort.some(s => withinContinuousWindow(s.expectedPerformanceTimeMs, o.performanceTimeMs)));
      const matches = matchOrderedSameKeyEvidence(cohort.map(strike => ({
        strikeId: strike.strikeId, pianoKey: strike.pianoKey, expectedPerformanceTimeMs: strike.expectedPerformanceTimeMs,
        scoreOrder: this.strikeOrder.get(strike.strikeId)!,
      })), observations);
      const pair = matches.find(match => match.strikeId === anchor.strikeId);
      const finality = this.finality(this.frontier(anchor));
      if (pair) {
        const observation = observations.find(observation => observation.observationId === pair.observationId)!;
        this.claim({ kind: 'STRIKE_MATCH', observationId: observation.observationId, strikeId: anchor.strikeId });
        draft.strikes.set(anchor.strikeId, immutableContinuousValue({ ...anchor, state: 'MATCHED',
          match: { observation, timingOffsetMs: observation.performanceTimeMs - anchor.expectedPerformanceTimeMs }, finality }));
      } else {
        const notReached = draft.requested?.reason === 'STOPPED_BY_USER'
          && anchor.expectedPerformanceTimeMs + CONTINUOUS_ASSIGNMENT_WINDOW_MS > this.terminal;
        draft.strikes.set(anchor.strikeId, immutableContinuousValue({ ...anchor, state: notReached ? 'NOT_REACHED' : 'UNMATCHED', finality }));
      }
    }
  }

  private finishGroup(group: Group): void {
    const strikes = group.strikes.map(strike => this.strikeState(strike));
    if (!strikes.every((strike): strike is FinalizedContinuousStrikeAssignment => strike.state !== 'PENDING')) throw new ContinuousEvaluationError('UNRESOLVED_RESERVATION');
    const required = Math.max(...strikes.map(strike => strike.finality.unclampedRequiredFrontierMs));
    this.transaction!.groups.set(group.groupId, immutableContinuousValue({
      groupId: group.groupId, performanceTimeMs: group.time, state: 'FINALIZED', strikes, finality: this.finality(required),
    }));
  }

  private commitUnattributedObservations(): void {
    for (const observation of this.unownedObservations().sort(byObservationId)) {
      const claimants = this.claimants(observation);
      const required = this.unattributedFrontier(observation);
      if (Math.min(required, this.terminal) > this.analyzedThrough
        || claimants.some(strike => !this.hasStrike(strike.strikeId))) continue;
      this.claim({ kind: 'UNATTRIBUTED', observationId: observation.observationId });
      this.transaction!.unattributed.push(immutableContinuousValue({ observation, finality: this.finality(required) }));
    }
  }

  private unattributedFrontier(observation: ContinuousObservation): number {
    let required = observation.performanceTimeMs;
    for (const strike of this.claimants(observation)) required = Math.max(required, this.frontier(strike));
    return required;
  }

  private closeCompletion(): void {
    const draft = this.transaction!;
    if (!draft.requested || !Number.isFinite(this.terminal)) return;
    if (this.committedStrikes.size + draft.strikes.size !== this.strikes.length
      || this.committedGroups.size + draft.groups.size !== this.groups.length || this.unownedObservations().length) {
      throw new ContinuousEvaluationError('UNRESOLVED_RESERVATION');
    }
    draft.completion = immutableContinuousValue({ ...draft.requested,
      availabilitySessionTimeMs: Math.max(draft.requested.availabilitySessionTimeMs, draft.publication.availabilitySessionTimeMs) });
  }
}

/** Inclusive local score-coordinate lookup, owned only by assignment. */
function assignmentTimeRange<T>(values: readonly T[], start: number, end: number, time: (value: T) => number): readonly T[] {
  let lo = 0, hi = values.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (time(values[mid]) < start) lo = mid + 1; else hi = mid; }
  const begin = lo; hi = values.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (time(values[mid]) <= end) lo = mid + 1; else hi = mid; }
  return values.slice(begin, lo);
}
