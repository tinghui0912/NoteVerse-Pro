import { matchContinuousEvidence, type ContinuousMatchingEdge } from '@/lib/practice/continuous/domain/evaluation/matching';
import { assertContinuousBound, CONTINUOUS_ANALYSIS_BOUNDS_MS, CONTINUOUS_ASSIGNMENT_WINDOW_MS, directObservationClaimants, directStrikeCohort, directStrikeFrontier, withinContinuousWindow } from '@/lib/practice/continuous/domain/evaluation/finalization-policy';
import { compareContinuousId, ContinuousEvidenceStore, observationsInRange, type PreparedContinuousEvidence } from '@/lib/practice/continuous/domain/evaluation/observation-store';
import { completeContinuousAssignment } from '@/lib/practice/continuous/domain/evaluation/assignment-projection';
import { ContinuousEvaluationError } from '@/lib/practice/continuous/domain/evaluation/evaluation-error';
import { immutableContinuousValue } from '@/lib/practice/continuous/domain/evaluation/immutable-value';
import type { ContinuousEvidencePublication, ContinuousObservation } from '@/lib/practice/continuous/domain/evaluation/evidence-types';
import type { ContinuousCompletion, ContinuousExpectedStrike, UnattributedContinuousObservation, ContinuousFinality, ContinuousGroupAssignment, ContinuousGroupResidualAssignment, ContinuousObservationAssignment, ContinuousStrikeAssignment, FinalizedContinuousStrikeAssignment } from '@/lib/practice/continuous/domain/evaluation/assignment-types';
import type { ContinuousAssignmentSnapshot } from '@/lib/practice/continuous/domain/evaluation/assignment-types';


type Group = { order: number; groupId: string; time: number; strikes: readonly ContinuousExpectedStrike[]; pitches: ReadonlySet<string> };
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
  waitingGroups: Set<Group>;
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
  private readonly strikesByPitch = new Map<string, ContinuousExpectedStrike[]>();
  private readonly groupById = new Map<string, Group>();
  private readonly strikeOrder = new Map<string, number>();
  private readonly frontierOrder: readonly ContinuousExpectedStrike[];
  private waitingGroups = new Set<Group>();
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
      if (!strike.strikeId || ids.has(strike.strikeId) || !strike.groupId || !strike.pitch
        || !Number.isFinite(strike.expectedPerformanceTimeMs) || strike.expectedPerformanceTimeMs < 0
        || !Array.isArray(strike.renderNoteIds)) throw new ContinuousEvaluationError('INVALID_EXPECTED_GROUP');
      this.strikeOrder.set(strike.strikeId, order);
      const bucket = this.strikesByPitch.get(strike.pitch) ?? [];
      bucket.push(strike); this.strikesByPitch.set(strike.pitch, bucket);
      ids.add(strike.strikeId);
      const group = grouped.get(strike.groupId) ?? [];
      if (group.some(other => other.expectedPerformanceTimeMs !== strike.expectedPerformanceTimeMs)) {
        throw new ContinuousEvaluationError('INVALID_EXPECTED_GROUP', 'A practice group must share one canonical onset time.');
      }
      group.push(strike);
      grouped.set(strike.groupId, group);
    }
    this.groups = [...grouped].map(([groupId, strikes]) => ({
      order: 0, groupId, strikes, time: strikes[0].expectedPerformanceTimeMs, pitches: new Set(strikes.map(strike => strike.pitch)),
    })).sort((a, b) => a.time - b.time || compareContinuousId(a.groupId, b.groupId));
    this.groups.forEach((group, order) => { group.order = order; this.groupById.set(group.groupId, group); });
    for (const strike of this.strikes) this.strikeFrontiers.set(strike.strikeId, directStrikeFrontier(strike,
      this.strikeRange(strike.pitch, strike.expectedPerformanceTimeMs - 2 * CONTINUOUS_ASSIGNMENT_WINDOW_MS,
        strike.expectedPerformanceTimeMs + 2 * CONTINUOUS_ASSIGNMENT_WINDOW_MS)));
    this.frontierOrder = [...this.strikes].sort((a, b) => this.frontier(a) - this.frontier(b)
      || this.strikeOrder.get(a.strikeId)! - this.strikeOrder.get(b.strikeId)!);
  }

  publish(publication: ContinuousEvidencePublication): ContinuousAssignmentSnapshot {
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
      return this.snapshot();
    } catch (error) { return this.fail(error); }
  }

  complete(completion: ContinuousCompletion): ContinuousAssignmentSnapshot {
    if (this.failure) throw this.failure;
    if (!['SCOPE_COMPLETED', 'STOPPED_BY_USER'].includes(completion.reason)
      || !Number.isFinite(completion.performanceTimeMs) || completion.performanceTimeMs < 0 || completion.performanceTimeMs < this.evidence.analyzedThrough
      || !Number.isFinite(completion.availabilitySessionTimeMs) || completion.availabilitySessionTimeMs < 0
      || !this.requestedCompletion && completion.availabilitySessionTimeMs < this.evidence.availableSessionTimeMs) {
      throw new ContinuousEvaluationError('INVALID_PUBLICATION');
    }
    if (this.requestedCompletion) {
      if (JSON.stringify(this.requestedCompletion) !== JSON.stringify(completion)) throw new ContinuousEvaluationError('COMPLETION_MUTATED');
      return this.snapshot();
    }
    const requested = immutableContinuousValue({ ...completion });
    if (this.evidence.analyzedThrough >= completion.performanceTimeMs) {
      try {
        this.planAndCommit({ publicationId: 'completion', sessionDomainId: this.evidence.sessionDomainId,
          analyzedThroughPerformanceMs: this.evidence.analyzedThrough,
          availabilitySessionTimeMs: Math.max(this.evidence.availableSessionTimeMs, completion.availabilitySessionTimeMs), observations: [] }, null, requested);
      } catch (error) { return this.fail(error); }
    } else this.requestedCompletion = requested;
    return this.snapshot();
  }

  private fail(error: unknown): never {
    this.failure = error instanceof Error ? error : new Error(String(error));
    throw this.failure;
  }

  /** All incoming evidence/ownership/frontier work is staged. Correctness failure discards the plan. */
  private planAndCommit(publication: ContinuousEvidencePublication, evidence: PreparedContinuousEvidence | null, requested: ContinuousCompletion | null): void {
    const draft: AssignmentTransaction = { evidence, publication, requested, strikes: new Map(), groups: new Map(), owners: new Map(),
      unattributed: [], waitingGroups: new Set(this.waitingGroups), strikeCursor: this.strikeCursor, completion: this.completion };
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
    this.waitingGroups = draft.waitingGroups; this.strikeCursor = draft.strikeCursor;
    this.requestedCompletion = requested; this.completion = draft.completion;
  }

  snapshot(): ContinuousAssignmentSnapshot {
    return Object.freeze({
      sessionDomainId: this.evidence.sessionDomainId,
      analyzedThroughPerformanceMs: Number.isFinite(this.evidence.analyzedThrough) ? this.evidence.analyzedThrough : null,
      groups: Object.freeze(this.groups.map(group => this.committedGroups.get(group.groupId) ?? Object.freeze({
        groupId: group.groupId, performanceTimeMs: group.time, state: 'PENDING' as const,
        strikes: Object.freeze(group.strikes.map(strike => this.strikeState(strike))), residualAssignments: Object.freeze([] as const), finality: null,
      }))),
      observations: this.evidence.values(), unattributedObservations: Object.freeze([...this.unattributedObservations]),
      observationAssignments: Object.freeze([...this.owners.values()].sort((a, b) => compareContinuousId(a.observationId, b.observationId))),
      reservedObservationIds: Object.freeze(this.residual().filter(observation => this.claimants(observation).some(strike => !this.hasStrike(strike.strikeId)))
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
    for (const group of this.waitingGroups) {
      const frontier = this.groupFrontier(group); if (frontier > this.analyzedThrough) next = Math.min(next, frontier);
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
  private strikeRange(pitch: string, start: number, end: number): readonly ContinuousExpectedStrike[] {
    return assignmentTimeRange(this.strikesByPitch.get(pitch) ?? [], start, end, strike => strike.expectedPerformanceTimeMs);
  }
  private claimants(observation: ContinuousObservation) {
    return directObservationClaimants(observation, this.strikeRange(observation.pitch,
      observation.performanceTimeMs - CONTINUOUS_ASSIGNMENT_WINDOW_MS, observation.performanceTimeMs + CONTINUOUS_ASSIGNMENT_WINDOW_MS));
  }
  private observationRange(start: number, end: number, pitch?: string): readonly ContinuousObservation[] {
    const prepared = this.transaction?.evidence;
    const incoming = !prepared ? [] : observationsInRange(pitch === undefined ? prepared.byTime : prepared.byPitch.get(pitch) ?? [], start, end);
    return [...this.evidence.inRange(start, end, pitch), ...incoming];
  }
  private isUnowned(id: string): boolean { return !this.owners.has(id) && !this.transaction?.owners.has(id); }
  private residual(): ContinuousObservation[] {
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

  private groupFrontier(group: Group): number {
    const local = this.observationRange(group.time - CONTINUOUS_ASSIGNMENT_WINDOW_MS, group.time + CONTINUOUS_ASSIGNMENT_WINDOW_MS)
      .filter(observation => !group.pitches.has(observation.pitch) && withinContinuousWindow(group.time, observation.performanceTimeMs));
    // A literal claimant contributes its OWN fixed frontier, never its group's frontier.
    let required = group.time + CONTINUOUS_ASSIGNMENT_WINDOW_MS;
    for (const strike of group.strikes) required = Math.max(required, this.frontier(strike));
    for (const observation of local) for (const strike of this.claimants(observation)) required = Math.max(required, this.frontier(strike));
    assertContinuousBound(required, group.time, CONTINUOUS_ANALYSIS_BOUNDS_MS.group);
    return required;
  }

  private commit(): void {
    this.commitStrikes();
    const ready: Group[] = [];
    for (const group of [...this.transaction!.waitingGroups].sort((a, b) => a.order - b.order)) {
      if (this.hasGroup(group.groupId)) continue;
      const states = group.strikes.map(strike => this.strikeState(strike));
      if (states.some(strike => strike.state === 'PENDING')) continue;
      if (states.some(strike => strike.state === 'NOT_REACHED')) this.finishGroup(group, [], this.groupFrontier(group));
      else if (states.every(strike => strike.state === 'MATCHED')) this.finishGroup(group, [], Math.max(...group.strikes.map(strike => this.frontier(strike))));
      else if (Math.min(this.groupFrontier(group), this.terminal) <= this.analyzedThrough) ready.push(group);
    }
    this.commitGroupResidualAssignments(ready);
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
      const cohort = directStrikeCohort(anchor, this.strikeRange(anchor.pitch,
        anchor.expectedPerformanceTimeMs - 2 * CONTINUOUS_ASSIGNMENT_WINDOW_MS, anchor.expectedPerformanceTimeMs + 2 * CONTINUOUS_ASSIGNMENT_WINDOW_MS))
        .filter(strike => !this.hasStrike(strike.strikeId)).sort(byStrikeId);
      const observations = this.observationRange(cohort.reduce((min, s) => Math.min(min, s.expectedPerformanceTimeMs), Infinity) - CONTINUOUS_ASSIGNMENT_WINDOW_MS,
        cohort.reduce((max, s) => Math.max(max, s.expectedPerformanceTimeMs), -Infinity) + CONTINUOUS_ASSIGNMENT_WINDOW_MS, anchor.pitch)
        .filter(o => this.isUnowned(o.observationId) && cohort.some(s => withinContinuousWindow(s.expectedPerformanceTimeMs, o.performanceTimeMs))).sort(byObservationId);
      const right = new Map(observations.map((o, j) => [o.observationId, j]));
      const edges: ContinuousMatchingEdge[] = [];
      cohort.forEach((strike, i) => {
        for (const o of this.observationRange(strike.expectedPerformanceTimeMs - CONTINUOUS_ASSIGNMENT_WINDOW_MS,
          strike.expectedPerformanceTimeMs + CONTINUOUS_ASSIGNMENT_WINDOW_MS, strike.pitch)) {
          const j = right.get(o.observationId); if (j !== undefined && withinContinuousWindow(strike.expectedPerformanceTimeMs, o.performanceTimeMs)) this.candidateEdge(edges, i, j, Math.abs(strike.expectedPerformanceTimeMs - o.performanceTimeMs));
        }
      });
      const pairs = matchContinuousEvidence(cohort.length, observations.length, edges);
      const pair = pairs.find(([i]) => cohort[i].strikeId === anchor.strikeId);
      const finality = this.finality(this.frontier(anchor));
      if (pair) {
        const observation = observations[pair[1]];
        this.claim({ kind: 'STRIKE_MATCH', observationId: observation.observationId, strikeId: anchor.strikeId });
        draft.strikes.set(anchor.strikeId, immutableContinuousValue({ ...anchor, state: 'MATCHED',
          match: { observation, timingOffsetMs: observation.performanceTimeMs - anchor.expectedPerformanceTimeMs }, finality }));
      } else {
        const notReached = draft.requested?.reason === 'STOPPED_BY_USER'
          && anchor.expectedPerformanceTimeMs + CONTINUOUS_ASSIGNMENT_WINDOW_MS > this.terminal;
        draft.strikes.set(anchor.strikeId, immutableContinuousValue({ ...anchor, state: notReached ? 'NOT_REACHED' : 'UNMATCHED', finality }));
      }
      draft.waitingGroups.add(this.groupById.get(anchor.groupId)!);
    }
  }

  private candidateEdge(edges: ContinuousMatchingEdge[], left: number, right: number, cost: number): void {
    edges.push({ left, right, cost });
  }

  private commitGroupResidualAssignments(ready: readonly Group[]): void {
    const slots = ready.flatMap(group => group.strikes.filter(strike => this.strikeState(strike).state === 'UNMATCHED')
      .map(strike => ({ group, strike }))).sort((a, b) => byStrikeId(a.strike, b.strike));
    const candidates = new Map<string, ContinuousObservation>();
    for (const group of ready) {
      for (const o of this.observationRange(group.time - CONTINUOUS_ASSIGNMENT_WINDOW_MS, group.time + CONTINUOUS_ASSIGNMENT_WINDOW_MS)) {
        if (this.isUnowned(o.observationId) && withinContinuousWindow(group.time, o.performanceTimeMs) && !group.pitches.has(o.pitch) && this.claimants(o).every(s => this.hasStrike(s.strikeId))) candidates.set(o.observationId, o);
      }
    }
    const observations = [...candidates.values()].sort(byObservationId);
    const right = new Map(observations.map((o, j) => [o.observationId, j]));
    const edges: ContinuousMatchingEdge[] = [];
    slots.forEach(({ group }, i) => {
      for (const o of this.observationRange(group.time - CONTINUOUS_ASSIGNMENT_WINDOW_MS, group.time + CONTINUOUS_ASSIGNMENT_WINDOW_MS)) {
        const j = right.get(o.observationId);
        if (j !== undefined && withinContinuousWindow(group.time, o.performanceTimeMs) && !group.pitches.has(o.pitch)) this.candidateEdge(edges, i, j, Math.abs(group.time - o.performanceTimeMs));
      }
    });
    const residualByGroup = new Map<string, ContinuousGroupResidualAssignment[]>();
    for (const [i, j] of matchContinuousEvidence(slots.length, observations.length, edges)) {
      const { group, strike } = slots[i], observation = observations[j];
      this.claim({ kind: 'GROUP_RESIDUAL', observationId: observation.observationId, groupId: group.groupId, strikeId: strike.strikeId });
      residualByGroup.set(group.groupId, [...(residualByGroup.get(group.groupId) ?? []), {
        strikeId: strike.strikeId, observation, timingOffsetMs: observation.performanceTimeMs - strike.expectedPerformanceTimeMs,
      }]);
    }
    for (const group of ready) this.finishGroup(group, residualByGroup.get(group.groupId) ?? [], this.groupFrontier(group));
  }

  private finishGroup(group: Group, residualAssignments: readonly ContinuousGroupResidualAssignment[], required: number): void {
    const strikes = group.strikes.map(strike => this.strikeState(strike));
    if (!strikes.every((strike): strike is FinalizedContinuousStrikeAssignment => strike.state !== 'PENDING')) {
      throw new ContinuousEvaluationError('UNRESOLVED_RESERVATION');
    }
    this.transaction!.groups.set(group.groupId, immutableContinuousValue({
      groupId: group.groupId, performanceTimeMs: group.time, state: 'FINALIZED', strikes,
      residualAssignments: [...residualAssignments], finality: this.finality(required),
    }));
    this.transaction!.waitingGroups.delete(group);
  }

  private commitUnattributedObservations(): void {
    for (const observation of this.residual().sort(byObservationId)) {
      const claimants = this.claimants(observation);
      const residualGroups = this.residualGroups(observation);
      const required = this.unattributedFrontier(observation);
      if (Math.min(required, this.terminal) > this.analyzedThrough
        || claimants.some(strike => !this.hasStrike(strike.strikeId))
        || residualGroups.some(group => !this.hasGroup(group.groupId))) continue;
      this.claim({ kind: 'UNATTRIBUTED', observationId: observation.observationId });
      this.transaction!.unattributed.push(immutableContinuousValue({ observation, finality: this.finality(required) }));
    }
  }

  private unattributedFrontier(observation: ContinuousObservation): number {
    const residualGroups = this.residualGroups(observation);
    let required = observation.performanceTimeMs;
    for (const strike of this.claimants(observation)) required = Math.max(required, this.frontier(strike));
    for (const group of residualGroups) required = Math.max(required, this.groupFrontier(group));
    assertContinuousBound(required, observation.performanceTimeMs, CONTINUOUS_ANALYSIS_BOUNDS_MS.residual);
    return required;
  }

  private residualGroups(observation: ContinuousObservation): readonly Group[] {
    return assignmentTimeRange(this.groups, observation.performanceTimeMs - CONTINUOUS_ASSIGNMENT_WINDOW_MS,
      observation.performanceTimeMs + CONTINUOUS_ASSIGNMENT_WINDOW_MS, group => group.time).filter(group => !group.pitches.has(observation.pitch) && withinContinuousWindow(group.time, observation.performanceTimeMs));
  }

  private closeCompletion(): void {
    const draft = this.transaction!;
    if (!draft.requested || !Number.isFinite(this.terminal)) return;
    if (this.committedStrikes.size + draft.strikes.size !== this.strikes.length
      || this.committedGroups.size + draft.groups.size !== this.groups.length || this.residual().length) {
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
