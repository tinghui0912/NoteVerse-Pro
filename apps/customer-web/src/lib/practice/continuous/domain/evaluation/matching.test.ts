import { expect, it } from 'vitest';
import { matchContinuousEvidence, type ContinuousMatchingEdge } from './matching';

it('sparse solver exactly matches the approved all-pairs reference on deterministic generated graphs', () => {
  let seed = 192837;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
  for (let run = 0; run < 500; run++) {
    const left = Array.from({ length: run % 7 }, (_, i) => i), right = Array.from({ length: Math.floor(run / 7) % 7 }, (_, i) => i);
    const costs = left.map(() => right.map(() => random() % 3 === 0 ? Infinity : random() % 4));
    const edges: ContinuousMatchingEdge[] = left.flatMap(i => right.filter(j => Number.isFinite(costs[i][j])).map(j => ({ left: i, right: j, cost: costs[i][j] })));
    const expected = referenceMatching(left, right, (i, j) => costs[i][j]);
    expect(matchContinuousEvidence(left.length, right.length, edges)).toEqual(expected);
    expect(matchContinuousEvidence(left.length, right.length, [...edges].reverse())).toEqual(expected);
  }
});
it.each([
  [[0, Infinity], [Infinity, 0]], [[0, 0], [0, 0]], [[1, 0], [Infinity, 0]],
  [[Infinity, Infinity], [Infinity, Infinity]], [[0, 1], [0, Infinity]],
].map(costs => ({ costs })))('retains disconnected/max-cardinality/min-cost/equal-cost tie behavior for %j', ({ costs }) => {
  const left = [0, 1], right = [0, 1];
  const edges = left.flatMap(i => right.filter(j => Number.isFinite(costs[i][j])).map(j => ({ left: i, right: j, cost: costs[i][j] })));
  expect(matchContinuousEvidence(2, 2, edges)).toEqual(referenceMatching(left, right, (i, j) => costs[i][j]));
});
it.each([{ left: -1, right: 0, cost: 0 }, { left: 0, right: 1, cost: 0 }, { left: 0, right: 0, cost: Infinity }])('rejects malformed sparse edge %j', edge => {
  expect(() => matchContinuousEvidence(1, 1, [edge])).toThrow();
});

// Approved all-pairs implementation. Test reference only, never imported by runtime.
type Edge = { to: number; capacity: number; cost: number; reverse: number; pair?: readonly [number, number] };

/** Ordered inputs define stable ties. Successive shortest augmentations prioritize cardinality before cost. */
function referenceMatching<L, R>(
  left: readonly L[], right: readonly R[], cost: (left: L, right: R) => number,
): readonly (readonly [number, number])[] {
  const size = left.length + right.length + 2;
  const source = size - 2, sink = size - 1;
  const graph: Edge[][] = Array.from({ length: size }, () => []);
  const connect = (from: number, to: number, weight: number, pair?: readonly [number, number]) => {
    const edge: Edge = { to, capacity: 1, cost: weight, reverse: graph[to].length, pair };
    graph[from].push(edge);
    graph[to].push({ to: from, capacity: 0, cost: -weight, reverse: graph[from].length - 1 });
  };
  left.forEach((_, index) => connect(source, index, 0));
  right.forEach((_, index) => connect(left.length + index, sink, 0));
  left.forEach((a, i) => right.forEach((b, j) => {
    const weight = cost(a, b);
    if (Number.isFinite(weight)) connect(i, left.length + j, weight, [i, j]);
  }));
  for (;;) {
    const distances = Array<number>(size).fill(Infinity);
    const previous: (readonly [number, number] | undefined)[] = Array(size);
    distances[source] = 0;
    for (let pass = 0; pass < size - 1; pass += 1) {
      let changed = false;
      for (let from = 0; from < size; from += 1) {
        if (!Number.isFinite(distances[from])) continue;
        graph[from].forEach((edge, index) => {
          if (edge.capacity && distances[from] + edge.cost < distances[edge.to]) {
            distances[edge.to] = distances[from] + edge.cost;
            previous[edge.to] = [from, index];
            changed = true;
          }
        });
      }
      if (!changed) break;
    }
    if (!previous[sink]) break;
    for (let to = sink; to !== source;) {
      const [from, index] = previous[to]!;
      const edge = graph[from][index];
      edge.capacity = 0;
      graph[to][edge.reverse].capacity = 1;
      to = from;
    }
  }
  return graph.slice(0, left.length).flatMap(edges => edges.flatMap(edge =>
    edge.pair && !edge.capacity ? [edge.pair] : []));
}
