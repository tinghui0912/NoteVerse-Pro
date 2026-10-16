// Research policy only. This deliberately does not replace the product ledger.
export const BOUNDED_POLICY = Object.freeze({ assignmentWindowMs: 250,
  expectedPriority: 'CLOSED_EXPECTED_THEN_CLOSED_WRONG_THEN_FINITE_HORIZON_EXTRA',
  openStrikePriority: 'OPEN_STRIKES_DO_NOT_RESERVE_OBSERVATIONS_AGAINST_CLOSED_DECISIONS',
  matching: 'MAX_CARDINALITY_MIN_TOTAL_ABSOLUTE_ERROR_STABLE_ID_TIES',
  classification: 'BOUNDED_ONLINE_POLICY_NOT_OFFLINE_COMPONENT_EQUIVALENCE' });

export function minimumCostPairs(left, right, cost) {
  const n = left.length + right.length + 2, source = n - 2, sink = n - 1;
  const graph = Array.from({ length: n }, () => []);
  const add = (u, v, c, tag) => { const a = { to: v, cap: 1, cost: c, rev: graph[v].length, tag };
    graph[u].push(a); graph[v].push({ to: u, cap: 0, cost: -c, rev: graph[u].length - 1 }); };
  left.forEach((_, i) => add(source, i, 0)); right.forEach((_, j) => add(left.length + j, sink, 0));
  left.forEach((a, i) => right.forEach((b, j) => { const c = cost(a, b); if (Number.isFinite(c)) add(i, left.length + j, c, [i, j]); }));
  for (;;) {
    const d = Array(n).fill(Infinity), prev = Array(n); d[source] = 0;
    for (let pass = 0; pass < n - 1; pass += 1) {
      let changed = false;
      for (let u = 0; u < n; u += 1) if (Number.isFinite(d[u])) graph[u].forEach((e, index) => {
        if (e.cap && d[u] + e.cost < d[e.to]) { d[e.to] = d[u] + e.cost; prev[e.to] = [u, index]; changed = true; }
      });
      if (!changed) break;
    }
    if (!prev[sink]) break;
    for (let v = sink; v !== source;) { const [u, i] = prev[v], e = graph[u][i]; e.cap = 0; graph[v][e.rev].cap = 1; v = u; }
  }
  return graph.slice(0, left.length).flatMap(edges => edges.filter(e => e.tag && !e.cap).map(e => e.tag));
}
const order = (a, b) => a.time - b.time || a.id.localeCompare(b.id);

export class BoundedContinuousFinalizationLedger {
  constructor(expectedStrikes, options = {}) {
    this.clock = options.clock;
    this.strikes = expectedStrikes.map(s => ({ ...s, id: s.strikeId, time: s.expectedPerformanceTimeMs, verdict: 'PENDING' })).sort(order);
    if (new Set(this.strikes.map(s => s.id)).size !== this.strikes.length || this.strikes.some(s => !Number.isFinite(s.time) || s.time < 0 || !s.pitch || !s.groupId)) throw new Error('BOUNDED_INVALID_STRIKES');
    this.groups = new Map();
    for (const s of this.strikes) { if (!this.groups.has(s.groupId)) this.groups.set(s.groupId, { id: s.groupId, time: s.time, strikes: [] }); this.groups.get(s.groupId).strikes.push(s); }
    for (const g of this.groups.values()) { g.deadline = Math.max(...g.strikes.map(s => s.time)) + 250; g.pitches = new Set(g.strikes.map(s => s.pitch)); }
    this.observations = new Map(); this.ownership = new Map(); this.verdicts = []; this.frontier = -Infinity; this.availability = -Infinity; this.terminal = Infinity;
  }
  claim(id, kind, owner) {
    if (this.ownership.has(id)) throw new Error(`BOUNDED_MIXED_OWNERSHIP:${id}`);
    this.ownership.set(id, { observationId: id, disposition: kind, owner });
  }
  publish(pub) {
    if (!Number.isFinite(pub.analyzedThroughPerformanceMs) || pub.analyzedThroughPerformanceMs < this.frontier
      || !Number.isFinite(pub.availabilityTimeMs) || pub.availabilityTimeMs < this.availability) throw new Error('BOUNDED_NONMONOTONIC_PUBLICATION');
    const incoming = new Set();
    for (const o of pub.observations) {
      if (!o.observationId || !o.pitch || !Number.isFinite(o.performanceTimeMs) || !Number.isFinite(o.confidence)
        || o.performanceTimeMs < 0 || o.performanceTimeMs > pub.analyzedThroughPerformanceMs || o.performanceTimeMs > pub.availabilityTimeMs
        || incoming.has(o.observationId)) throw new Error('BOUNDED_INVALID_OBSERVATION');
      incoming.add(o.observationId);
      const prior = this.observations.get(o.observationId);
      if (prior && (prior.pitch !== o.pitch || prior.performanceTimeMs !== o.performanceTimeMs || prior.confidence !== o.confidence)) throw new Error('BOUNDED_ID_MUTATION');
      if (!prior && o.performanceTimeMs <= this.frontier) throw new Error('BOUNDED_LATE_EVIDENCE');
    }
    for (const o of pub.observations) this.observations.set(o.observationId, { ...o, id: o.observationId, time: o.performanceTimeMs });
    this.frontier = pub.analyzedThroughPerformanceMs; this.availability = pub.availabilityTimeMs; this.pub = pub;
    this.commit(); return this.snapshot();
  }
  commit() {
    const closed = this.strikes.filter(s => s.verdict === 'PENDING' && Math.min(s.time + 250, this.terminal) <= this.frontier);
    for (const pitch of [...new Set(closed.map(s => s.pitch))].sort()) {
      const strikes = closed.filter(s => s.pitch === pitch).sort(order), residual = this.residual().filter(o => o.pitch === pitch).sort(order);
      const pairs = minimumCostPairs(strikes, residual, (s, o) => Math.abs(s.time - o.time) <= 250 ? Math.abs(s.time - o.time) : Infinity);
      for (const [i, j] of pairs) { const s = strikes[i], o = residual[j]; s.verdict = 'MATCHED'; s.matchedObservationId = o.id; s.timingOffsetMs = o.time - s.time; this.claim(o.id, 'MATCHED', s.id); }
      for (const s of strikes) if (s.verdict === 'PENDING') s.verdict = this.manual && s.time + 250 > this.terminal ? 'NOT_REACHED' : 'MISSING';
    }
    const groups = [...this.groups.values()].filter(g => !g.final && g.strikes.every(s => s.verdict !== 'PENDING')).sort(order);
    const slots = groups.flatMap(g => g.strikes.filter(s => s.verdict === 'MISSING').map(s => ({ ...g, slotId: s.id })));
    const residual = this.residual().sort(order), wrong = new Map();
    for (const [i, j] of minimumCostPairs(slots, residual, (g, o) => !g.pitches.has(o.pitch) && Math.abs(g.time - o.time) <= 250 ? Math.abs(g.time - o.time) : Infinity)) {
      const g = slots[i], o = residual[j]; if (!wrong.has(g.id)) wrong.set(g.id, []); wrong.get(g.id).push(o.id); this.claim(o.id, 'WRONG', g.id);
    }
    for (const g of groups) {
      g.final = true;
      if (g.strikes.some(s => s.verdict === 'NOT_REACHED')) continue;
      const matched = g.strikes.filter(s => s.verdict === 'MATCHED').map(s => s.matchedObservationId), incompatible = wrong.get(g.id) ?? [];
      const verdict = matched.length === g.strikes.length ? 'CORRECT' : incompatible.length ? 'WRONG' : matched.length ? 'INCOMPLETE_CHORD' : 'MISSING';
      this.finish(g.id, g.id, verdict, g.time, g.deadline, Math.min(g.deadline, this.terminal), [...matched, ...incompatible],
        verdict === 'CORRECT' ? 'ALL_EXPECTED_ASSIGNMENTS_COMMITTED' : 'LOCAL_LEGAL_WINDOW_COVERED_CLOSED_GROUP_ASSIGNMENT_COMMITTED');
    }
    for (const o of this.residual()) {
      const claimants = [...this.groups.values()].filter(g => Math.abs(g.time - o.time) <= 250 || g.strikes.some(s => s.pitch === o.pitch && Math.abs(s.time - o.time) <= 250));
      const required = Math.min(Math.max(o.time, ...claimants.map(g => g.deadline)), this.terminal);
      if (this.frontier >= required && claimants.every(g => g.final)) {
        this.claim(o.id, 'EXTRA', o.id); this.finish(o.id, undefined, 'EXTRA', o.time, required, required, [o.id], 'ALL_DIRECT_LOCAL_CLAIM_WINDOWS_CLOSED');
      }
    }
  }
  finish(id, groupId, verdict, time, deadline, required, evidence, reason) {
    const finalizedAt = this.clock ? Math.max(this.availability, this.clock()) : this.availability;
    this.verdicts.push({ id, groupId, verdict, performanceTimeMs: time, deadlineMs: deadline,
      finalizationTimeMs: finalizedAt, finalizationLatencyMs: finalizedAt - time,
      evidenceObservationIds: evidence, consumedObservationIds: evidence,
      reason, witness: { targetPerformanceTimeMs: time, localDeadlineMs: deadline, requiredAnalysisFrontierMs: required,
        enablingPublicationId: this.pub.publicationId, enablingAnalysisFrontierMs: this.frontier,
        publicationAvailabilityTimeMs: this.availability, finalizationTimeMs: finalizedAt,
        unrelatedFutureScoreWait: false, irreversibleReason: reason } });
  }
  residual() { return [...this.observations.values()].filter(o => !this.ownership.has(o.id)); }
  completeNaturalScope(frontier, availability) { this.terminal = frontier; this.publish({ publicationId: 'bounded:natural-completion', analyzedThroughPerformanceMs: frontier, availabilityTimeMs: availability, observations: [] }); return this.snapshot(); }
  completeManualScope(frontier, availability) { this.manual = true; return this.completeNaturalScope(frontier, availability); }
  snapshot() {
    const { strikes } = this;
    return { verdicts: [...this.verdicts], lowLevel: { strikes: strikes.map(s => ({ ...s })),
      extras: this.verdicts.filter(v => v.verdict === 'EXTRA').map(v => this.observations.get(v.id)) },
      observationConsumption: [...this.ownership.values()], pendingObservationIds: this.residual().map(o => o.id) };
  }
}
