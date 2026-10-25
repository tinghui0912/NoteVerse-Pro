type Edge = { to: number; capacity: number; cost: number; reverse: number; pair?: readonly [number, number] };

/** Ordered inputs define stable ties. Successive shortest augmentations prioritize cardinality before cost. */
export function matchContinuousEvidence<L, R>(
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
