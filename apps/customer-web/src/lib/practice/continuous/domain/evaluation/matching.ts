import { ContinuousEvaluationError } from './evaluation-error';

export type ContinuousMatchingEdge = Readonly<{ left: number; right: number; cost: number }>;

type Edge = { to: number; capacity: number; cost: number; reverse: number; pair?: readonly [number, number] };

/** Ordered inputs define stable ties. Successive shortest augmentations prioritize cardinality before cost. */
export function matchContinuousEvidence(
  leftCount: number, rightCount: number, candidates: readonly ContinuousMatchingEdge[],
): readonly (readonly [number, number])[] {
  const ordered = [...candidates].sort((a, b) => a.left - b.left || a.right - b.right);
  if (!Number.isSafeInteger(leftCount) || leftCount < 0 || !Number.isSafeInteger(rightCount) || rightCount < 0
    || ordered.some((edge, i) => !Number.isSafeInteger(edge.left) || !Number.isSafeInteger(edge.right)
      || edge.left < 0 || edge.left >= leftCount || edge.right < 0 || edge.right >= rightCount || !Number.isFinite(edge.cost)
      || i > 0 && edge.left === ordered[i - 1].left && edge.right === ordered[i - 1].right)) throw new ContinuousEvaluationError('INVALID_PUBLICATION');
  const size = leftCount + rightCount + 2;
  const source = size - 2, sink = size - 1;
  const graph: Edge[][] = Array.from({ length: size }, () => []);
  const connect = (from: number, to: number, weight: number, pair?: readonly [number, number]) => {
    const edge: Edge = { to, capacity: 1, cost: weight, reverse: graph[to].length, pair };
    graph[from].push(edge);
    graph[to].push({ to: from, capacity: 0, cost: -weight, reverse: graph[from].length - 1 });
  };
  for (let i = 0; i < leftCount; i++) connect(source, i, 0);
  for (let j = 0; j < rightCount; j++) connect(leftCount + j, sink, 0);
  for (const edge of ordered) connect(edge.left, leftCount + edge.right, edge.cost, [edge.left, edge.right]);
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
  return graph.slice(0, leftCount).flatMap(edges => edges.flatMap(edge =>
    edge.pair && !edge.capacity ? [edge.pair] : []));
}
