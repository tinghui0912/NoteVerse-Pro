import { matchContinuousEvidence, type ContinuousMatchingEdge } from '@/lib/practice/continuous/domain/evaluation/matching';

export type Pair = readonly [number, number];
export type Solution = { pairs: Pair[]; cardinality: number; cost: number };
const solution = (pairs: readonly Pair[], costs: readonly (readonly number[])[]): Solution => ({
  pairs: [...pairs].sort((a,b) => a[0]-b[0] || a[1]-b[1]), cardinality: pairs.length,
  cost: pairs.reduce((n,[i,j]) => n + costs[i][j], 0),
});
function better(a: Solution, b: Solution): Solution {
  if (a.cardinality !== b.cardinality) return a.cardinality > b.cardinality ? a : b;
  if (a.cost !== b.cost) return a.cost < b.cost ? a : b;
  // Research tie: lexicographic chronological (target index, observation index), not a production emulation.
  for (let k=0;k<a.pairs.length;k++) for (let axis=0;axis<2;axis++) {
    if (a.pairs[k][axis] !== b.pairs[k][axis]) return a.pairs[k][axis] < b.pairs[k][axis] ? a : b;
  }
  return a;
}
export function genericSolution(costs: readonly (readonly number[])[], rightCount: number): Solution {
  const edges: ContinuousMatchingEdge[] = costs.flatMap((row,i) => row.flatMap((cost,j) => Number.isFinite(cost) ? [{left:i,right:j,cost}] : []));
  return solution(matchContinuousEvidence(costs.length,rightCount,edges),costs);
}
/** Ordered DP is deliberately research-only; not a replacement for identity-based augmenting-path ties. */
export function orderedSolution(costs: readonly (readonly number[])[], rightCount: number): Solution {
  const dp: Solution[][] = Array.from({length:costs.length+1},()=>Array.from({length:rightCount+1},()=>({pairs:[],cardinality:0,cost:0})));
  for(let i=1;i<=costs.length;i++) for(let j=1;j<=rightCount;j++) {
    let best=better(dp[i-1][j],dp[i][j-1]);
    if(Number.isFinite(costs[i-1][j-1])) best=better(best,solution([...dp[i-1][j-1].pairs,[i-1,j-1]],costs));
    dp[i][j]=best;
  }
  return dp[costs.length][rightCount];
}
export const crossing = (pairs: readonly Pair[]): boolean => pairs.some(([i,j])=>pairs.some(([k,l])=>i<k && j>l));
/** Enumerates every partial injective assignment; independent of DP and augmenting paths. Small graphs only. */
export function exhaustiveSolution(costs: readonly (readonly number[])[], rightCount: number) {
  let best=solution([],costs), nonCrossing=solution([],costs), optimumCount=0;
  const visit=(i:number,pairs:Pair[],used:Set<number>)=>{
    if(i===costs.length) {
      const current=solution(pairs,costs);
      if(current.cardinality>best.cardinality || current.cardinality===best.cardinality && current.cost<best.cost) optimumCount=0;
      best=better(best,current);
      if(current.cardinality===best.cardinality && current.cost===best.cost) optimumCount++;
      if(!crossing(pairs)) nonCrossing=better(nonCrossing,current);
      return;
    }
    visit(i+1,pairs,used);
    for(let j=0;j<rightCount;j++) if(!used.has(j) && Number.isFinite(costs[i][j])) {
      used.add(j);pairs.push([i,j]);visit(i+1,pairs,used);pairs.pop();used.delete(j);
    }
  };
  visit(0,[],new Set()); return {best,nonCrossing,optimumCount};
}
/** Intentionally uncorrected negative control: each chronological target takes its nearest free event. */
export function nearestTargetGreedy(costs: readonly (readonly number[])[]): Solution {
  const pairs:Pair[]=[], used=new Set<number>();
  for(let i=0;i<costs.length;i++) {
    const next=costs[i].map((cost,j)=>({cost,j})).filter(e=>Number.isFinite(e.cost)&&!used.has(e.j)).sort((a,b)=>a.cost-b.cost||a.j-b.j)[0];
    if(next){pairs.push([i,next.j]);used.add(next.j);}
  }
  return solution(pairs,costs);
}
export function sequences(values: readonly number[], maxLength: number, repeat: boolean): number[][] {
  const rows:number[][]=[[]];
  const add=(prefix:number[],start:number)=>{
    if(prefix.length===maxLength)return;
    for(let i=start;i<values.length;i++){const next=[...prefix,values[i]];rows.push(next);add(next,repeat?i:i+1);}
  }; add([],0);return rows;
}
