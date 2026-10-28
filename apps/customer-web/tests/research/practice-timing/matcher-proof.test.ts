import { beforeAll,expect,it } from 'vitest';
import { matcherProof } from './matcher-proof';
import { exhaustiveSolution, genericSolution, orderedSolution } from './ordered-solvers';
let proof:ReturnType<typeof matcherProof>;
beforeAll(()=>{proof=matcherProof();});
it('exhaustively supports a non-crossing optimum for common-radius one-dimensional absolute costs',()=>{
  expect(proof.fixed.graphs).toBe(3528);expect(proof.fixed.nonCrossingFailures).toBe(0);expect(proof.fixed.objectiveMismatches).toBe(0);
  expect(proof.generated.graphs).toBe(2000);expect(proof.generated.objectiveMismatches).toBe(0);
});
it('keeps historical generic tie differences while current V4 exactly matches ordered ownership',()=>{
  expect(proof.fixed.currentOrderedPairDifferences).toBe(0);expect(proof.generated.currentOrderedPairDifferences).toBe(0);
  expect(proof.genericReferenceIdentity).toBe('RESEARCH_V3_GENERIC_REFERENCE');
  expect(proof.fixed.exactOwnershipDifferences).toBeGreaterThan(0);expect(proof.generated.exactOwnershipDifferences).toBeGreaterThan(0);
  expect(proof.fixed.firstOwnershipDifference).toMatchObject({targets:[0,125],observations:[125,125],
    generic:{pairs:[[0,1],[1,0]],cardinality:2,cost:125},ordered:{pairs:[[0,0],[1,1]],cardinality:2,cost:125}});
});
it('finds a minimum-vertex crossing counterexample for variable symmetric radii',()=>{
  expect(proof.variable.graphs).toBe(495);expect(proof.variable.nonCrossingFailures).toBeGreaterThan(0);
  const c=proof.variable.minimumVertexCounterexample;
  expect(c.exhaustive.best).toMatchObject({pairs:[[0,1],[1,0]],cardinality:2});
  expect(c.exhaustive.nonCrossing.cardinality).toBe(1);expect(c.ordered.cardinality).toBe(1);
});
it('checks disjoint midpoint candidate families without assuming interval endpoints are exclusive everywhere',()=>{
  expect(proof.unique.graphs).toBe(660);expect(proof.unique.overlapFailures).toBe(0);expect(proof.unique.nonCrossingFailures).toBe(0);
});
it('retains the nearest-per-target greedy cardinality counterexample',()=>{
  expect(proof.greedy.nearestPerTarget.cardinality).toBe(1);expect(proof.greedy.optimum.cardinality).toBe(2);
});
it('covers empty, disconnected and equal-cost graphs with an independent enumeration',()=>{
  for(const costs of [[],[[]],[[Infinity,Infinity],[Infinity,Infinity]],[[0,Infinity],[Infinity,0]],[[0,0],[0,0]]]) {
    const count=costs[0]?.length??0,all=exhaustiveSolution(costs,count),g=genericSolution(costs,count),d=orderedSolution(costs,count);
    expect([g.cardinality,g.cost]).toEqual([all.best.cardinality,all.best.cost]);expect([d.cardinality,d.cost]).toEqual([all.nonCrossing.cardinality,all.nonCrossing.cost]);
  }
});
