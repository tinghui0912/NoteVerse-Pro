import { ContinuousFinalizationLedger } from '../local-core/continuous-finalization-ledger';
import type { ExpectedStrike } from '../audio-analysis/continuous/performance-reconciler';
import type { ObservedAttack } from '../audio-analysis/continuous/observed-attack';

export type ResearchPublication = {
  publicationId: string;
  analyzedThroughPerformanceMs: number;
  availabilityTimeMs: number;
  observations: (ObservedAttack & { availabilityTimeMs: number })[];
};
export type FiveVerdict = 'CORRECT' | 'MISSING' | 'WRONG' | 'INCOMPLETE_CHORD' | 'EXTRA';
export type FinalResearchVerdict = {
  id: string; groupId?: string; verdict: FiveVerdict; performanceTimeMs: number;
  finalizationTimeMs: number; finalizationLatencyMs: number; deadlineMs: number;
  evidenceObservationIds: string[]; consumedObservationIds: string[]; reason: string;
};

// Unit capacities; shortest augmenting paths maximize cardinality before minimizing
// timing cost. Sorted caller inputs and first-path ties define a stable tie-break.
export function minimumCostOneToOne(leftCount: number, rightCount: number,
  cost: (left: number, right: number) => number | null): [number, number][] {
  type Edge = { to: number; reverse: number; capacity: number; cost: number };
  const sink = leftCount + rightCount + 1, graph: Edge[][] = Array.from({ length: sink + 1 }, () => []);
  const add = (from: number, to: number, price: number) => {
    const edge = { to, reverse: graph[to].length, capacity: 1, cost: price };
    graph[from].push(edge); graph[to].push({ to: from, reverse: graph[from].length - 1, capacity: 0, cost: -price });
    return edge;
  };
  const links: { left: number; right: number; edge: Edge }[] = [];
  for (let left = 0; left < leftCount; left += 1) add(0, left + 1, 0);
  for (let right = 0; right < rightCount; right += 1) add(leftCount + 1 + right, sink, 0);
  for (let left = 0; left < leftCount; left += 1) for (let right = 0; right < rightCount; right += 1) {
    const price = cost(left, right);
    if (price !== null) links.push({ left, right, edge: add(left + 1, leftCount + 1 + right, price) });
  }
  while (true) {
    const distance = Array(graph.length).fill(Infinity) as number[];
    const previous: ([number, number] | undefined)[] = Array(graph.length);
    distance[0] = 0;
    for (let round = 0; round < graph.length - 1; round += 1) {
      let changed = false;
      for (let from = 0; from < graph.length; from += 1) graph[from].forEach((edge, index) => {
        if (edge.capacity && distance[from] + edge.cost < distance[edge.to]) {
          distance[edge.to] = distance[from] + edge.cost; previous[edge.to] = [from, index]; changed = true;
        }
      });
      if (!changed) break;
    }
    if (!previous[sink]) break;
    let at = sink;
    while (at !== 0) {
      const [from, index] = previous[at]!; const edge = graph[from][index];
      edge.capacity -= 1; graph[at][edge.reverse].capacity += 1; at = from;
    }
  }
  return links.filter(link => link.edge.capacity === 0).map(link => [link.left, link.right]);
}

export function latencyInBeats(latencyMs: number, bpm: number) { return latencyMs * bpm / 60000; }

export class ResearchFiveVerdictProjector {
  private readonly ledger: ContinuousFinalizationLedger;
  private readonly groups: { id: string; strikes: ExpectedStrike[]; time: number; deadline: number }[];
  private readonly observations = new Map<string, ObservedAttack>();
  private readonly finalized = new Map<string, FinalResearchVerdict>();
  private readonly used = new Map<string, 'MATCHED' | 'WRONG' | 'EXTRA'>();
  private availability = -Infinity;
  private terminalMs = Infinity;
  private readonly windowMs = 250;

  constructor(strikes: readonly ExpectedStrike[]) {
    const ordered = [...strikes].sort((a, b) => a.expectedPerformanceTimeMs - b.expectedPerformanceTimeMs || a.strikeId.localeCompare(b.strikeId));
    this.ledger = new ContinuousFinalizationLedger({ expectedStrikes: ordered, assignmentWindowMs: this.windowMs });
    const byGroup = new Map<string, ExpectedStrike[]>();
    for (const strike of ordered) byGroup.set(strike.groupId, [...(byGroup.get(strike.groupId) ?? []), strike]);
    this.groups = [...byGroup].map(([id, group]) => ({ id, strikes: group,
      time: Math.min(...group.map(strike => strike.expectedPerformanceTimeMs)),
      deadline: Math.max(...group.map(strike => strike.expectedPerformanceTimeMs)) + this.windowMs }))
      .sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
  }

  publish(publication: ResearchPublication) {
    if (!Number.isFinite(publication.availabilityTimeMs) || publication.availabilityTimeMs < this.availability) throw new Error('NON_MONOTONIC_AVAILABILITY');
    if (publication.observations.some(event => event.availabilityTimeMs !== publication.availabilityTimeMs
      || event.performanceTimeMs > event.availabilityTimeMs)) throw new Error('INVALID_PUBLICATION_AVAILABILITY');
    this.ledger.publishObservations(publication.observations, publication.analyzedThroughPerformanceMs);
    this.availability = publication.availabilityTimeMs;
    for (const event of publication.observations) this.observations.set(event.observationId, event);
    const snapshot = this.ledger.snapshot();
    for (const strike of snapshot.strikes) if (strike.verdict === 'MATCHED') this.claim(strike.matchedObservationId, 'MATCHED');
    const states = new Map(this.groups.map(group => [group.id, snapshot.strikes.filter(strike => strike.groupId === group.id)]));
    for (const group of this.groups) {
      if (this.finalized.has(group.id)) continue;
      const strikes = states.get(group.id)!;
      if (strikes.every(strike => strike.verdict === 'MATCHED')) {
        const ids = strikes.flatMap(strike => strike.verdict === 'MATCHED' ? [strike.matchedObservationId] : []);
        this.finish(group.id, 'CORRECT', group.time, group.deadline, ids, ids, 'ALL_LEDGER_STRIKES_IRREVERSIBLY_MATCHED', group.id);
      }
    }
    // Wrong explanations also form temporal conflict components. Do not commit a
    // locally attractive explanation while an overlapping group can still claim it.
    const components: typeof this.groups[] = [];
    let component: typeof this.groups = [], end = -Infinity;
    for (const group of this.groups) {
      if (group.time - this.windowMs > end && component.length) { components.push(component); component = []; }
      component.push(group); end = Math.max(end, group.deadline);
    }
    if (component.length) components.push(component);
    for (const part of components) {
      if (publication.analyzedThroughPerformanceMs < Math.min(this.terminalMs, Math.max(...part.map(group => group.deadline)))
        || part.some(group => states.get(group.id)!.some(strike => strike.verdict === 'PENDING'))) continue;
      const waiting = part.filter(group => !this.finalized.has(group.id));
      const slots = waiting.flatMap(group => states.get(group.id)!.filter(strike => strike.verdict === 'MISSING')
        .map(strike => ({ group, strikeId: strike.strikeId })));
      const residual = snapshot.extras.filter(event => !this.used.has(event.observationId))
        .sort((a, b) => a.performanceTimeMs - b.performanceTimeMs || a.observationId.localeCompare(b.observationId));
      const pairs = minimumCostOneToOne(slots.length, residual.length, (i, j) => {
        const group = slots[i].group, event = residual[j], delta = Math.abs(event.performanceTimeMs - group.time);
        return delta <= this.windowMs && event.performanceTimeMs <= group.deadline
          && !group.strikes.some(strike => strike.pitch === event.pitch) ? delta : null;
      });
      const wrong = new Map<string, string[]>();
      for (const [i, j] of pairs) {
        const id = residual[j].observationId; this.claim(id, 'WRONG');
        wrong.set(slots[i].group.id, [...(wrong.get(slots[i].group.id) ?? []), id]);
      }
      for (const group of waiting) {
        const strikes = states.get(group.id)!;
        const matched = strikes.flatMap(strike => strike.verdict === 'MATCHED' ? [strike.matchedObservationId] : []);
        const wrongIds = wrong.get(group.id) ?? [];
        this.finish(group.id, wrongIds.length ? 'WRONG' : matched.length && group.strikes.length > 1 ? 'INCOMPLETE_CHORD' : 'MISSING',
          group.time, group.deadline, [...matched, ...wrongIds], [...matched, ...wrongIds], 'GROUP_AND_WRONG_ASSOCIATION_COMPONENT_CLOSED', group.id);
      }
    }
    for (const event of snapshot.extras) {
      if (this.used.has(event.observationId)) continue;
      const openClaim = this.groups.some(group => !this.finalized.has(group.id)
        && Math.abs(event.performanceTimeMs - group.time) <= this.windowMs
        && event.performanceTimeMs <= group.deadline);
      if (openClaim) continue;
      this.claim(event.observationId, 'EXTRA');
      this.finish(`extra:${event.observationId}`, 'EXTRA', event.performanceTimeMs, event.performanceTimeMs,
        [event.observationId], [event.observationId], 'LEDGER_RESIDUAL_AND_ALL_LEGAL_GROUP_CLAIMS_CLOSED');
    }
    return this.snapshot();
  }

  completeNaturalScope(analyzedThroughPerformanceMs: number, availabilityTimeMs: number) {
    this.terminalMs = analyzedThroughPerformanceMs;
    this.ledger.complete({ reason: 'SCOPE_COMPLETED', performanceTimeMs: analyzedThroughPerformanceMs,
      terminalPerformanceMs: analyzedThroughPerformanceMs });
    return this.publish({ publicationId: 'natural-scope-complete', analyzedThroughPerformanceMs,
      availabilityTimeMs, observations: [] });
  }

  private claim(id: string, kind: 'MATCHED' | 'WRONG' | 'EXTRA') {
    if (this.used.has(id) && this.used.get(id) !== kind) throw new Error('OBSERVATION_DOUBLE_CONSUMPTION');
    this.used.set(id, kind);
  }
  private finish(id: string, verdict: FiveVerdict, time: number, deadline: number, evidence: string[], consumed: string[], reason: string, groupId?: string) {
    if (this.finalized.has(id)) throw new Error('FINAL_VERDICT_MUTATION');
    this.finalized.set(id, { id, groupId, verdict, performanceTimeMs: time,
      finalizationTimeMs: this.availability, finalizationLatencyMs: this.availability - time,
      deadlineMs: deadline, evidenceObservationIds: evidence, consumedObservationIds: consumed, reason });
  }
  snapshot() { return { verdicts: [...this.finalized.values()], lowLevel: this.ledger.snapshot(), observationConsumption: [...this.used].map(([observationId, disposition]) => ({ observationId, disposition })) }; }
}
