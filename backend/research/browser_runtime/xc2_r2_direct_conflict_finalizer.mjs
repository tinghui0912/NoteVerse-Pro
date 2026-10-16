import { BoundedContinuousFinalizationLedger, minimumCostPairs } from './xc2_r1_bounded_finalizer.mjs';

export const R2_POLICY = Object.freeze({ name: 'DIRECT_CONFLICT_RESERVATION_BOUNDED_POLICY', wMs: 250,
  classification: 'ONE_HOP_DIRECT_CONFLICT_POLICY_NOT_TRANSITIVE_OFFLINE_EQUIVALENCE',
  matching: 'MAX_CARDINALITY_MIN_TOTAL_ABSOLUTE_TIME_ERROR_SORTED_ID_STABLE_TRAVERSAL',
  reservation: 'REVERSIBLE_DIRECT_ELIGIBILITY_NOT_SEMANTIC_OWNERSHIP',
  wrong: 'NEVER_CONSUME_AN_OBSERVATION_WITH_AN_UNCOMMITTED_DIRECT_CORRECT_MATCH_CLAIMANT',
  unresolvedReservationAtGroupHorizon: 'FINALIZE_WITHOUT_WRONG_EVIDENCE; DO_NOT_WAIT_FOR_A_COMPETITORS_COMPETITORS' });
const byId = (a, b) => a.id.localeCompare(b.id);
const byTime = (a, b) => a.time - b.time || byId(a, b);
const within = (a, b, w = 250) => Math.abs(a - b) <= w;

// Research subclass reuses only R1 validation, immutable ownership and output
// projection. R1 commit() is never called; the historical implementation stays intact.
export class DirectConflictReservationFinalizer extends BoundedContinuousFinalizationLedger {
  constructor(expectedStrikes) {
    super(expectedStrikes);
    for (const s of this.strikes) {
      s.directCohortIds = this.strikes.filter(u => u.pitch === s.pitch && within(u.time, s.time, 500)).map(u => u.id).sort();
      s.directRequiredFrontierMs = Math.max(...this.strikes.filter(u => s.directCohortIds.includes(u.id)).map(u => u.time + 250));
      if (s.directRequiredFrontierMs > s.time + 750) throw new Error('R2_NONLOCAL_STRIKE_HORIZON');
    }
    this.strikeWitnesses = []; this.cohortSolves = []; this.provisionalReservations = []; this.reservationChanges = [];
  }
  directCorrectClaimants(o) { return this.strikes.filter(s => s.pitch === o.pitch && within(s.time, o.time)); }
  groupHorizon(g) {
    // All locally incompatible observations are included, even if consumed by a
    // different correct group. Once the local window is covered this horizon is
    // fixed; consumption cannot retroactively change a recorded enabling frontier.
    const local = [...this.observations.values()].filter(o => !g.pitches.has(o.pitch) && within(o.time, g.time));
    const claimantIds = [...new Set(local.flatMap(o => this.directCorrectClaimants(o).map(s => s.id)))].sort();
    const claimants = this.strikes.filter(s => claimantIds.includes(s.id));
    const required = Math.max(g.deadline, ...g.strikes.map(s => s.directRequiredFrontierMs), ...claimants.map(s => s.time + 250));
    if (required > Math.max(...g.strikes.map(s => s.time)) + 750) throw new Error('R2_NONLOCAL_GROUP_HORIZON');
    return { required, localIncompatibleObservationIds: local.map(o => o.id).sort(), directCorrectClaimantIds: claimantIds };
  }
  updateReservations() {
    const rows = this.residual().map(o => ({ o, claimants: this.directCorrectClaimants(o).filter(s => s.verdict === 'PENDING') }))
      .filter(r => r.claimants.length).map(({ o, claimants }) => ({ observationId: o.id,
        status: 'RESERVED', semanticDisposition: null, eligibleUncommittedStrikeIds: claimants.map(s => s.id).sort(),
        allCorrectClaimantsLocallyClosed: claimants.every(s => Math.min(s.time + 250, this.terminal) <= this.frontier),
        maximumDirectClaimantCommitFrontierMs: Math.min(Math.max(...claimants.map(s => s.directRequiredFrontierMs)), this.terminal) }))
      .sort((a, b) => a.observationId.localeCompare(b.observationId));
    const old = new Map(this.provisionalReservations.map(r => [r.observationId, r])), next = new Map(rows.map(r => [r.observationId, r]));
    for (const id of new Set([...old.keys(), ...next.keys()])) if (JSON.stringify(old.get(id)) !== JSON.stringify(next.get(id))) {
      this.reservationChanges.push({ observationId: id, publicationId: this.pub.publicationId, frontierMs: this.frontier,
        previous: old.get(id) ?? null, next: next.get(id) ?? null, semanticOwner: this.ownership.get(id) ?? null });
    }
    this.provisionalReservations = rows;
  }
  commit() {
    const eligible = this.strikes.filter(s => s.verdict === 'PENDING' && Math.min(s.directRequiredFrontierMs, this.terminal) <= this.frontier).sort(byTime);
    for (const anchor of eligible) {
      // Cohort membership is a literal one-hop interval-overlap query. Never
      // expand from any member, or use a member's own horizon for the anchor.
      const cohort = this.strikes.filter(s => s.verdict === 'PENDING' && anchor.directCohortIds.includes(s.id)).sort(byId);
      const observations = this.residual().filter(o => cohort.some(s => o.pitch === s.pitch && within(s.time, o.time))).sort(byId);
      const pairs = minimumCostPairs(cohort, observations, (s, o) => within(s.time, o.time) ? Math.abs(s.time - o.time) : Infinity);
      const proposal = pairs.map(([i, j]) => ({ strikeId: cohort[i].id, observationId: observations[j].id }));
      const assigned = proposal.find(p => p.strikeId === anchor.id);
      this.cohortSolves.push({ anchorStrikeId: anchor.id, oneHopCohortIds: anchor.directCohortIds, optimizationPendingCohortIds: cohort.map(s => s.id),
        requiredFrontierMs: Math.min(anchor.directRequiredFrontierMs, this.terminal), publicationId: this.pub.publicationId,
        provisionalProposalOnly: proposal, committedStrikeIds: [anchor.id] });
      if (assigned) {
        const o = this.observations.get(assigned.observationId); this.claim(o.id, 'MATCHED', anchor.id);
        anchor.verdict = 'MATCHED'; anchor.matchedObservationId = o.id; anchor.timingOffsetMs = o.time - anchor.time;
      } else anchor.verdict = this.manual && anchor.time + 250 > this.terminal ? 'NOT_REACHED' : 'MISSING';
      this.strikeWitnesses.push({ strikeId: anchor.id, pitch: anchor.pitch, targetTimeMs: anchor.time, localDeadlineMs: anchor.time + 250,
        requiredFrontierMs: Math.min(anchor.directRequiredFrontierMs, this.terminal), unclampedRequiredFrontierMs: anchor.directRequiredFrontierMs,
        oneHopCohortIds: anchor.directCohortIds, enablingPublicationId: this.pub.publicationId,
        enablingFrontierMs: this.frontier, availabilityTimeMs: this.availability, verdict: anchor.verdict,
        matchedObservationId: assigned?.observationId ?? null, terminalClamp: anchor.directRequiredFrontierMs > this.terminal });
    }
    this.updateReservations();
    const reserved = new Set(this.provisionalReservations.map(r => r.observationId));
    const ready = [];
    for (const g of [...this.groups.values()].sort(byTime)) {
      if (g.final || g.strikes.some(s => s.verdict === 'PENDING')) continue;
      if (g.strikes.some(s => s.verdict === 'NOT_REACHED')) { g.final = true; continue; }
      const matched = g.strikes.filter(s => s.verdict === 'MATCHED').map(s => s.matchedObservationId);
      if (matched.length === g.strikes.length) {
        const required = Math.min(Math.max(...g.strikes.map(s => s.directRequiredFrontierMs)), this.terminal);
        this.finish(g.id, g.id, 'CORRECT', g.time, g.deadline, required, matched, 'OWN_STRIKES_COMMITTED_AFTER_ONE_HOP_COHORT_COVERAGE'); g.final = true;
        this.verdicts.at(-1).witness.unclampedRequiredFrontierMs = Math.max(...g.strikes.map(s => s.directRequiredFrontierMs));
        this.verdicts.at(-1).witness.terminalClamp = this.verdicts.at(-1).witness.unclampedRequiredFrontierMs > this.terminal;
      } else {
        const horizon = this.groupHorizon(g);
        if (this.frontier >= Math.min(horizon.required, this.terminal)) ready.push({ ...g, horizon });
      }
    }
    const slots = ready.flatMap(g => g.strikes.filter(s => s.verdict === 'MISSING').map(s => ({ ...g, slotId: s.id })))
      .sort((a, b) => a.slotId.localeCompare(b.slotId));
    const residual = this.residual().filter(o => !reserved.has(o.id)).sort(byId), wrong = new Map();
    for (const [i, j] of minimumCostPairs(slots, residual, (g, o) => !g.pitches.has(o.pitch) && within(g.time, o.time) ? Math.abs(g.time - o.time) : Infinity)) {
      const g = slots[i], o = residual[j];
      if (this.directCorrectClaimants(o).some(s => s.verdict === 'PENDING' || Math.min(s.time + 250, this.terminal) > this.frontier)) throw new Error('R2_WRONG_PREEMPTS_CORRECT_CLAIMANT');
      if (!wrong.has(g.id)) wrong.set(g.id, []); wrong.get(g.id).push(o.id); this.claim(o.id, 'WRONG', g.id);
    }
    for (const g of ready) {
      const matched = g.strikes.filter(s => s.verdict === 'MATCHED').map(s => s.matchedObservationId), incompatible = wrong.get(g.id) ?? [];
      const verdict = incompatible.length ? 'WRONG' : matched.length ? 'INCOMPLETE_CHORD' : 'MISSING';
      this.finish(g.id, g.id, verdict, g.time, g.deadline, Math.min(g.horizon.required, this.terminal), [...matched, ...incompatible], 'DIRECT_CLAIMANT_WINDOWS_COVERED_NO_RESERVED_WRONG_CONSUMPTION');
      const v = this.verdicts.at(-1); v.witness.directConflict = g.horizon;
      v.witness.unclampedRequiredFrontierMs = g.horizon.required; v.witness.terminalClamp = g.horizon.required > this.terminal;
      v.witness.reservedLocalEvidenceNotConsumed = this.provisionalReservations.filter(r => { const o = this.observations.get(r.observationId); return within(o.time, g.time) && !g.pitches.has(o.pitch); });
      this.groups.get(g.id).final = true;
    }
    for (const o of this.residual()) {
      const correct = this.directCorrectClaimants(o), groups = [...this.groups.values()].filter(g => !g.pitches.has(o.pitch) && within(g.time, o.time));
      const horizons = groups.map(g => ({ groupId: g.id, ...this.groupHorizon(g) }));
      const unclamped = Math.max(o.time, ...correct.map(s => s.directRequiredFrontierMs), ...horizons.map(g => g.required));
      const required = Math.min(unclamped, this.terminal);
      if (this.frontier < required || correct.some(s => s.verdict === 'PENDING') || groups.some(g => !g.final)) continue;
      const span = Math.max(0, ...groups.map(g => Math.max(...g.strikes.map(s => s.time)) - g.time));
      if (required > o.time + 1000 + span) throw new Error('R2_NONLOCAL_EXTRA_HORIZON');
      this.claim(o.id, 'EXTRA', o.id);
      this.finish(o.id, undefined, 'EXTRA', o.time, required, required, [o.id], 'ALL_DIRECT_CORRECT_COMMIT_AND_WRONG_GROUP_HORIZONS_CLOSED');
      this.verdicts.at(-1).witness.directExtraClaimants = { correctStrikeIds: correct.map(s => s.id), wrongGroups: horizons, boundFromObservationMs: 1000 + span };
      this.verdicts.at(-1).witness.unclampedRequiredFrontierMs = unclamped; this.verdicts.at(-1).witness.terminalClamp = unclamped > this.terminal;
    }
    this.updateReservations();
  }
  finish(...args) {
    super.finish(...args); const v = this.verdicts.at(-1);
    v.witness.policy = R2_POLICY.name; v.witness.terminalClamp = v.witness.requiredAnalysisFrontierMs < v.deadlineMs;
    v.witness.reason = args.at(-1);
    if (v.groupId) v.witness.ownStrikeCommitWitnesses = this.strikeWitnesses.filter(s => this.groups.get(v.groupId).strikes.some(t => t.id === s.strikeId));
  }
  snapshot() {
    return { ...super.snapshot(), provisionalReservations: [...this.provisionalReservations], reservationChanges: [...this.reservationChanges],
      strikeWitnesses: [...this.strikeWitnesses], cohortSolves: [...this.cohortSolves] };
  }
}
