import { matchOrderedSameKeyEvidence } from '@/lib/practice/continuous/domain/evaluation/same-key-matching';
import { CONTINUOUS_ASSIGNMENT_WINDOW_MS as W } from '@/lib/practice/continuous/domain/evaluation/finalization-policy';
import { sequences, exhaustiveSolution, genericSolution, orderedSolution, nearestTargetGreedy, crossing } from './ordered-solvers';
import { candidatePolicies, legal } from './candidate-policies';
import { scenario } from './timing-audit-workloads';

const objectiveEqual=(a:{cardinality:number;cost:number},b:{cardinality:number;cost:number})=>a.cardinality===b.cardinality&&a.cost===b.cost;
const samePairs=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
export function matcherProof() {
  const values=Array.from({length:6},(_,i)=>i*W/2);
  const targets=sequences(values,3,false),events=sequences(values,3,true);
  const currentPairs=(ts:readonly number[],os:readonly number[])=>matchOrderedSameKeyEvidence(
    ts.map((time,i)=>({strikeId:`t${i}`,pianoKey:60,expectedPerformanceTimeMs:time,scoreOrder:i})),
    os.map((time,i)=>({observationId:`o${i}`,pianoKey:60,performanceTimeMs:time})))
      .map(m=>[Number(m.strikeId.slice(1)),Number(m.observationId.slice(1))]);
  let currentOrderedPairDifferences=0;
  let graphs=0,nonCrossingFailures=0,objectiveMismatches=0,exactOwnershipDifferences=0,targetSetDifferences=0,crossingGenericOptima=0;
  let firstOwnershipDifference:unknown=null;
  for(const ts of targets)for(const os of events) {
    const costs=ts.map(t=>os.map(o=>Math.abs(t-o)<=W?Math.abs(t-o):Infinity));
    const all=exhaustiveSolution(costs,os.length), generic=genericSolution(costs,os.length),ordered=orderedSolution(costs,os.length);
    if(!samePairs(currentPairs(ts,os),ordered.pairs))currentOrderedPairDifferences++;
    graphs++;
    if(!objectiveEqual(all.best,all.nonCrossing))nonCrossingFailures++;
    if(!objectiveEqual(all.best,generic)||!objectiveEqual(all.best,ordered))objectiveMismatches++;
    if(!samePairs(generic.pairs.map(pair=>pair[0]),ordered.pairs.map(pair=>pair[0])))targetSetDifferences++;
    if(crossing(generic.pairs))crossingGenericOptima++;
    if(!samePairs(generic.pairs,ordered.pairs)){
      exactOwnershipDifferences++;
      firstOwnershipDifference??={targets:ts,observations:os,generic,ordered};
    }
  }
  let state=20261028,generatedGraphs=0,generatedObjectiveMismatches=0,generatedOwnershipDifferences=0,generatedCurrentPairDifferences=0;
  const rand=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state;};
  for(let run=0;run<2000;run++) {
    const ts=[...new Set(Array.from({length:rand()%5},()=>rand()%20*W/4))].sort((a,b)=>a-b);
    const os=Array.from({length:rand()%5},()=>rand()%20*W/4).sort((a,b)=>a-b);
    const costs=ts.map(t=>os.map(o=>Math.abs(t-o)<=W?Math.abs(t-o):Infinity));
    const g=genericSolution(costs,os.length),d=orderedSolution(costs,os.length);
    if(!samePairs(currentPairs(ts,os),d.pairs))generatedCurrentPairDifferences++;
    generatedGraphs++; if(!objectiveEqual(g,d))generatedObjectiveMismatches++;
    if(!samePairs(g.pairs,d.pairs))generatedOwnershipDifferences++;
  }
  let variableGraphs=0,variableNonCrossingFailures=0;
  for(const ts of sequences([0,W,2*W,3*W],2,false))for(const os of sequences([0,W,2*W,3*W],2,true)) {
    for(let mask=0;mask<2**ts.length;mask++) {
      const radii=ts.map((_,i)=>mask&(1<<i)?3*W:W);
      const costs=ts.map((t,i)=>os.map(o=>Math.abs(t-o)<=radii[i]?Math.abs(t-o):Infinity));
      const all=exhaustiveSolution(costs,os.length);variableGraphs++;
      if(!objectiveEqual(all.best,all.nonCrossing))variableNonCrossingFailures++;
    }
  }
  const variableTargets=[1000,1250],variableEvents=[1500,1750],radii=[3*W,W];
  const variableCosts=variableTargets.map((t,i)=>variableEvents.map(o=>Math.abs(t-o)<=radii[i]?Math.abs(t-o):Infinity));
  const counterexample={targets:variableTargets,observations:variableEvents,radii,
    exhaustive:exhaustiveSolution(variableCosts,2),ordered:orderedSolution(variableCosts,2)};
  let uniqueGraphs=0,uniqueOverlapFailures=0,uniqueNonCrossingFailures=0;
  for(const p of candidatePolicies.filter(p=>p.unique))for(const ts of sequences([0,W,2*W,3*W],2,false))for(const os of sequences([0,W,2*W,3*W],2,true)) {
    const s=scenario('unique',ts,os,{terminalMs:5*W});
    const costs=s.targets.map(t=>s.events.map(o=>legal(s,p,t,o)?Math.abs(t.expectedPerformanceTimeMs-o.timeMs):Infinity));
    const all=exhaustiveSolution(costs,os.length);uniqueGraphs++;
    if(os.some((_,j)=>costs.filter(row=>Number.isFinite(row[j])).length>1))uniqueOverlapFailures++;
    if(!objectiveEqual(all.best,all.nonCrossing))uniqueNonCrossingFailures++;
  }
  const greedyCosts=[[200,100],[Infinity,150]];
  return {genericReferenceIdentity:'RESEARCH_V3_GENERIC_REFERENCE',fixed:{currentOrderedPairDifferences,graphs,nonCrossingFailures,objectiveMismatches,exactOwnershipDifferences,targetSetDifferences,crossingGenericOptima,firstOwnershipDifference},
    generated:{currentOrderedPairDifferences:generatedCurrentPairDifferences,graphs:generatedGraphs,objectiveMismatches:generatedObjectiveMismatches,exactOwnershipDifferences:generatedOwnershipDifferences},
    variable:{graphs:variableGraphs,nonCrossingFailures:variableNonCrossingFailures,minimumVertexCounterexample:counterexample},
    unique:{graphs:uniqueGraphs,overlapFailures:uniqueOverlapFailures,nonCrossingFailures:uniqueNonCrossingFailures},
    greedy:{costs:[[200,100],[null,150]],nearestPerTarget:nearestTargetGreedy(greedyCosts),optimum:genericSolution(greedyCosts,2)}};
}
