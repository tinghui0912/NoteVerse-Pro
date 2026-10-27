import { matchContinuousEvidence } from '@/lib/practice/continuous/domain/evaluation/matching';
import { assertContinuousBound, CONTINUOUS_ANALYSIS_BOUNDS_MS, CONTINUOUS_ASSIGNMENT_WINDOW_MS, directObservationClaimants, directStrikeCohort, directStrikeFrontier, withinContinuousWindow } from '@/lib/practice/continuous/domain/evaluation/finalization-policy';
import { compareContinuousId, ContinuousEvidenceStore } from '@/lib/practice/continuous/domain/evaluation/observation-store';
import { completeContinuousAssignment } from '@/lib/practice/continuous/domain/evaluation/assignment-projection';
import { ContinuousEvaluationError } from '@/lib/practice/continuous/domain/evaluation/evaluation-error';
import { immutableContinuousValue } from '@/lib/practice/continuous/domain/evaluation/immutable-value';
import type { ContinuousEvidencePublication, ContinuousObservation } from '@/lib/practice/continuous/domain/evaluation/evidence-types';
import type { ContinuousCompletion, ContinuousExpectedStrike, UnattributedContinuousObservation, ContinuousFinality, ContinuousGroupAssignment, ContinuousGroupResidualAssignment, ContinuousObservationAssignment, ContinuousStrikeAssignment, FinalizedContinuousStrikeAssignment } from '@/lib/practice/continuous/domain/evaluation/assignment-types';
import type { ContinuousAssignmentSnapshot } from '@/lib/practice/continuous/domain/evaluation/assignment-types';

type Group = { groupId: string; time: number; strikes: readonly ContinuousExpectedStrike[]; pitches: ReadonlySet<string> };
const byStrikeId = (a: ContinuousExpectedStrike, b: ContinuousExpectedStrike) => compareContinuousId(a.strikeId, b.strikeId);
const byObservationId = (a: ContinuousObservation, b: ContinuousObservation) => compareContinuousId(a.observationId, b.observationId);

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
  private publication: ContinuousEvidencePublication | null = null;
  private requestedCompletion: ContinuousCompletion | null = null;
  private completion: ContinuousCompletion | null = null;
  private failure: Error | null = null;

  constructor(sessionDomainId: string, expectedStrikes: readonly ContinuousExpectedStrike[]) {
    this.evidence = new ContinuousEvidenceStore(sessionDomainId);
    this.strikes = immutableContinuousValue(structuredClone([...expectedStrikes]).sort((a, b) =>
      a.expectedPerformanceTimeMs - b.expectedPerformanceTimeMs || byStrikeId(a, b)));
    const grouped = new Map<string, ContinuousExpectedStrike[]>();
    const ids = new Set<string>();
    for (const strike of this.strikes) {
      if (!strike.strikeId || ids.has(strike.strikeId) || !strike.groupId || !strike.pitch
        || !Number.isFinite(strike.expectedPerformanceTimeMs) || strike.expectedPerformanceTimeMs < 0
        || !Array.isArray(strike.renderNoteIds)) throw new ContinuousEvaluationError('INVALID_EXPECTED_GROUP');
      ids.add(strike.strikeId);
      const group = grouped.get(strike.groupId) ?? [];
      if (group.some(other => other.expectedPerformanceTimeMs !== strike.expectedPerformanceTimeMs)) {
        throw new ContinuousEvaluationError('INVALID_EXPECTED_GROUP', 'A practice group must share one canonical onset time.');
      }
      group.push(strike);
      grouped.set(strike.groupId, group);
    }
    this.groups = [...grouped].map(([groupId, strikes]) => ({
      groupId, strikes, time: strikes[0].expectedPerformanceTimeMs, pitches: new Set(strikes.map(strike => strike.pitch)),
    })).sort((a, b) => a.time - b.time || compareContinuousId(a.groupId, b.groupId));
    for (const strike of this.strikes) this.strikeFrontiers.set(strike.strikeId, directStrikeFrontier(strike, this.strikes));
  }

  publish(publication: ContinuousEvidencePublication): ContinuousAssignmentSnapshot {
    if (this.failure) throw this.failure;
    try {
      if (this.requestedCompletion && publication.analyzedThroughPerformanceMs > this.requestedCompletion.performanceTimeMs) {
        throw new ContinuousEvaluationError('PUBLICATION_AFTER_COMPLETION');
      }
      const accepted = this.evidence.accept(publication, this.completion !== null);
      if (!accepted) return this.snapshot();
      if (this.requestedCompletion && accepted.availabilitySessionTimeMs < this.requestedCompletion.availabilitySessionTimeMs) {
        throw new ContinuousEvaluationError('INVALID_PUBLICATION');
      }
      this.publication = accepted;
      this.commit();
      this.closeCompletion();
      return this.snapshot();
    } catch (error) {
      this.failure = error instanceof Error ? error : new Error(String(error));
      throw this.failure;
    }
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
    this.requestedCompletion = immutableContinuousValue({ ...completion });
    if (this.evidence.analyzedThrough >= completion.performanceTimeMs) {
      this.publication = { publicationId: 'completion', sessionDomainId: this.evidence.sessionDomainId,
        analyzedThroughPerformanceMs: this.evidence.analyzedThrough,
        availabilitySessionTimeMs: Math.max(this.evidence.availableSessionTimeMs, completion.availabilitySessionTimeMs), observations: [] };
      this.commit();
      this.closeCompletion();
    }
    return this.snapshot();
  }

  snapshot(): ContinuousAssignmentSnapshot {
    return immutableContinuousValue({
      sessionDomainId: this.evidence.sessionDomainId,
      analyzedThroughPerformanceMs: Number.isFinite(this.evidence.analyzedThrough) ? this.evidence.analyzedThrough : null,
      groups: this.groups.map(group => this.committedGroups.get(group.groupId) ?? {
        groupId: group.groupId, performanceTimeMs: group.time, state: 'PENDING' as const,
        strikes: group.strikes.map(strike => this.strikeState(strike)), residualAssignments: [] as const, finality: null,
      }),
      observations: this.evidence.values(), unattributedObservations: [...this.unattributedObservations], observationAssignments: [...this.owners.values()].sort((a, b) => compareContinuousId(a.observationId, b.observationId)),
      reservedObservationIds: this.residual().filter(observation => this.claimants(observation).some(strike => !this.committedStrikes.has(strike.strikeId)))
        .map(observation => observation.observationId).sort(compareContinuousId),
      completion: this.completion,
    });
  }

  completedAssignment() { return completeContinuousAssignment(this.snapshot()); }

  /** Read-only semantic coverage need, using the same frontiers as commit(). */
  nextRequiredAnalysisFrontier(): number | null {
    if (this.failure) throw this.failure;
    if (this.completion) return null;
    const needs = this.strikes.filter(strike => !this.committedStrikes.has(strike.strikeId)).map(strike => this.frontier(strike));
    for (const group of this.groups) {
      if (!this.committedGroups.has(group.groupId) && group.strikes.every(strike => this.committedStrikes.has(strike.strikeId))) {
        needs.push(this.groupFrontier(group));
      }
    }
    for (const observation of this.residual()) needs.push(this.unattributedFrontier(observation));
    const uncovered = needs.filter(frontier => frontier > this.evidence.analyzedThrough);
    return uncovered.length ? Math.min(...uncovered) : null;
  }

  private strikeState(strike: ContinuousExpectedStrike): ContinuousStrikeAssignment {
    return this.committedStrikes.get(strike.strikeId) ?? { ...strike, state: 'PENDING' };
  }
  private get terminal(): number {
    return this.requestedCompletion && this.evidence.analyzedThrough >= this.requestedCompletion.performanceTimeMs
      ? this.requestedCompletion.performanceTimeMs : Infinity;
  }
  private frontier(strike: ContinuousExpectedStrike): number { return this.strikeFrontiers.get(strike.strikeId)!; }
  private claimants(observation: ContinuousObservation) { return directObservationClaimants(observation, this.strikes); }
  private residual() { return this.evidence.values().filter(observation => !this.owners.has(observation.observationId)); }
  private claim(assignment: ContinuousObservationAssignment): void {
    if (this.owners.has(assignment.observationId)) throw new ContinuousEvaluationError('OWNERSHIP_VIOLATION');
    this.owners.set(assignment.observationId, immutableContinuousValue(assignment));
  }
  private finality(required: number): ContinuousFinality {
    const publication = this.publication!;
    return { requiredAnalysisFrontierMs: Math.min(required, this.terminal), unclampedRequiredFrontierMs: required,
      enablingPublicationId: publication.publicationId, enablingAnalysisFrontierMs: this.evidence.analyzedThrough,
      finalizationSessionTimeMs: publication.availabilitySessionTimeMs, terminalClamp: required > this.terminal };
  }

  private groupFrontier(group: Group): number {
    const local = this.evidence.values().filter(observation => !group.pitches.has(observation.pitch)
      && withinContinuousWindow(group.time, observation.performanceTimeMs));
    // A literal claimant contributes its OWN fixed frontier, never its group's frontier.
    const required = Math.max(group.time + CONTINUOUS_ASSIGNMENT_WINDOW_MS,
      ...group.strikes.map(strike => this.frontier(strike)),
      ...local.flatMap(observation => this.claimants(observation).map(strike => this.frontier(strike))));
    assertContinuousBound(required, group.time, CONTINUOUS_ANALYSIS_BOUNDS_MS.group);
    return required;
  }

  private commit(): void {
    this.commitStrikes();
    const ready: Group[] = [];
    for (const group of this.groups) {
      if (this.committedGroups.has(group.groupId)) continue;
      const states = group.strikes.map(strike => this.strikeState(strike));
      if (states.some(strike => strike.state === 'PENDING')) continue;
      if (states.some(strike => strike.state === 'NOT_REACHED')) this.finishGroup(group, [], this.groupFrontier(group));
      else if (states.every(strike => strike.state === 'MATCHED')) this.finishGroup(group, [], Math.max(...group.strikes.map(strike => this.frontier(strike))));
      else if (Math.min(this.groupFrontier(group), this.terminal) <= this.evidence.analyzedThrough) ready.push(group);
    }
    this.commitGroupResidualAssignments(ready);
    this.commitUnattributedObservations();
  }

  private commitStrikes(): void {
    for (const anchor of this.strikes) {
      if (this.committedStrikes.has(anchor.strikeId) || Math.min(this.frontier(anchor), this.terminal) > this.evidence.analyzedThrough) continue;
      const cohort = directStrikeCohort(anchor, this.strikes).filter(strike => !this.committedStrikes.has(strike.strikeId)).sort(byStrikeId);
      const observations = this.residual().filter(observation => cohort.some(strike => strike.pitch === observation.pitch
        && withinContinuousWindow(strike.expectedPerformanceTimeMs, observation.performanceTimeMs))).sort(byObservationId);
      const pairs = matchContinuousEvidence(cohort, observations, (strike, observation) =>
        withinContinuousWindow(strike.expectedPerformanceTimeMs, observation.performanceTimeMs)
          ? Math.abs(strike.expectedPerformanceTimeMs - observation.performanceTimeMs) : Infinity);
      const pair = pairs.find(([i]) => cohort[i].strikeId === anchor.strikeId);
      const finality = this.finality(this.frontier(anchor));
      if (pair) {
        const observation = observations[pair[1]];
        this.claim({ kind: 'STRIKE_MATCH', observationId: observation.observationId, strikeId: anchor.strikeId });
        this.committedStrikes.set(anchor.strikeId, immutableContinuousValue({ ...anchor, state: 'MATCHED',
          match: { observation, timingOffsetMs: observation.performanceTimeMs - anchor.expectedPerformanceTimeMs }, finality }));
      } else {
        const notReached = this.requestedCompletion?.reason === 'STOPPED_BY_USER'
          && anchor.expectedPerformanceTimeMs + CONTINUOUS_ASSIGNMENT_WINDOW_MS > this.terminal;
        this.committedStrikes.set(anchor.strikeId, immutableContinuousValue({ ...anchor, state: notReached ? 'NOT_REACHED' : 'UNMATCHED', finality }));
      }
    }
  }

  private commitGroupResidualAssignments(ready: readonly Group[]): void {
    const slots = ready.flatMap(group => group.strikes.filter(strike => this.strikeState(strike).state === 'UNMATCHED')
      .map(strike => ({ group, strike }))).sort((a, b) => byStrikeId(a.strike, b.strike));
    const observations = this.residual().filter(observation => this.claimants(observation)
      .every(strike => this.committedStrikes.has(strike.strikeId))).sort(byObservationId);
    const residualByGroup = new Map<string, ContinuousGroupResidualAssignment[]>();
    for (const [i, j] of matchContinuousEvidence(slots, observations, ({ group }, observation) =>
      !group.pitches.has(observation.pitch) && withinContinuousWindow(group.time, observation.performanceTimeMs)
        ? Math.abs(group.time - observation.performanceTimeMs) : Infinity)) {
      const { group, strike } = slots[i], observation = observations[j];
      this.claim({ kind: 'GROUP_RESIDUAL', observationId: observation.observationId, groupId: group.groupId, strikeId: strike.strikeId });
      residualByGroup.set(group.groupId, [...(residualByGroup.get(group.groupId) ?? []), {
        strikeId: strike.strikeId, observation,
        timingOffsetMs: observation.performanceTimeMs - strike.expectedPerformanceTimeMs,
      }]);
    }
    for (const group of ready) {
      const residualAssignments = residualByGroup.get(group.groupId) ?? [];
      this.finishGroup(group, residualAssignments, this.groupFrontier(group));
    }
  }

  private finishGroup(group: Group, residualAssignments: readonly ContinuousGroupResidualAssignment[], required: number): void {
    const strikes = group.strikes.map(strike => this.strikeState(strike));
    if (!strikes.every((strike): strike is FinalizedContinuousStrikeAssignment => strike.state !== 'PENDING')) {
      throw new ContinuousEvaluationError('UNRESOLVED_RESERVATION');
    }
    this.committedGroups.set(group.groupId, immutableContinuousValue({
      groupId: group.groupId, performanceTimeMs: group.time, state: 'FINALIZED', strikes,
      residualAssignments: [...residualAssignments], finality: this.finality(required),
    }));
  }

  private commitUnattributedObservations(): void {
    for (const observation of this.residual().sort(byObservationId)) {
      const claimants = this.claimants(observation);
      const residualGroups = this.groups.filter(group => !group.pitches.has(observation.pitch)
        && withinContinuousWindow(group.time, observation.performanceTimeMs));
      const required = this.unattributedFrontier(observation);
      if (Math.min(required, this.terminal) > this.evidence.analyzedThrough
        || claimants.some(strike => !this.committedStrikes.has(strike.strikeId))
        || residualGroups.some(group => !this.committedGroups.has(group.groupId))) continue;
      this.claim({ kind: 'UNATTRIBUTED', observationId: observation.observationId });
      this.unattributedObservations.push(immutableContinuousValue({ observation, finality: this.finality(required) }));
    }
  }

  private unattributedFrontier(observation: ContinuousObservation): number {
    const residualGroups = this.groups.filter(group => !group.pitches.has(observation.pitch)
      && withinContinuousWindow(group.time, observation.performanceTimeMs));
    const required = Math.max(observation.performanceTimeMs, ...this.claimants(observation).map(strike => this.frontier(strike)),
      ...residualGroups.map(group => this.groupFrontier(group)));
    assertContinuousBound(required, observation.performanceTimeMs, CONTINUOUS_ANALYSIS_BOUNDS_MS.residual);
    return required;
  }

  private closeCompletion(): void {
    if (!this.requestedCompletion || !Number.isFinite(this.terminal)) return;
    if (this.committedStrikes.size !== this.strikes.length || this.committedGroups.size !== this.groups.length || this.residual().length) {
      throw new ContinuousEvaluationError('UNRESOLVED_RESERVATION');
    }
    this.completion = immutableContinuousValue({ ...this.requestedCompletion,
      availabilitySessionTimeMs: Math.max(this.requestedCompletion.availabilitySessionTimeMs, this.evidence.availableSessionTimeMs) });
  }
}
