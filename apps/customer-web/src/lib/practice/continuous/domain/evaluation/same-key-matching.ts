import type { ContinuousExpectedStrike } from './assignment-types';
import type { ContinuousObservation } from './evidence-types';
import { compareContinuousId } from './observation-store';
import { withinContinuousWindow } from './finalization-policy';
import { ContinuousEvaluationError } from './evaluation-error';

type OrderedTarget = Pick<ContinuousExpectedStrike, 'strikeId' | 'pianoKey' | 'expectedPerformanceTimeMs'> & Readonly<{ scoreOrder: number }>;
type SameKeyObservation = Pick<ContinuousObservation, 'observationId' | 'pianoKey' | 'performanceTimeMs'>;
type SameKeyMatch = Readonly<{ strikeId: string; observationId: string; timingOffsetMs: number }>;

/** Max cardinality, min absolute error, then lexicographically earliest chronological non-crossing pairs.
 * Scalar suffix objectives use O(targets * observations) storage. Reconstruction visits each candidate
 * at most once; no growing pair arrays, artificial cost encoding or capacity/timing limit is used.
 */
export function matchOrderedSameKeyEvidence(targets: readonly OrderedTarget[], observations: readonly SameKeyObservation[]): readonly SameKeyMatch[] {
  const pianoKey = targets[0]?.pianoKey ?? observations[0]?.pianoKey;
  const targetIds = new Set<string>(), observationIds = new Set<string>();
  for (const target of targets) {
    if (!target.strikeId || !target.pianoKey || target.pianoKey !== pianoKey || targetIds.has(target.strikeId)
      || !Number.isFinite(target.expectedPerformanceTimeMs) || target.expectedPerformanceTimeMs < 0
      || !Number.isSafeInteger(target.scoreOrder) || target.scoreOrder < 0) throw new ContinuousEvaluationError('INVALID_PUBLICATION');
    targetIds.add(target.strikeId);
  }
  for (const observation of observations) {
    if (!observation.observationId || !observation.pianoKey || observation.pianoKey !== pianoKey || observationIds.has(observation.observationId)
      || !Number.isFinite(observation.performanceTimeMs) || observation.performanceTimeMs < 0) throw new ContinuousEvaluationError('INVALID_PUBLICATION');
    observationIds.add(observation.observationId);
  }
  const ts = [...targets].sort((a,b) => a.expectedPerformanceTimeMs-b.expectedPerformanceTimeMs
    || a.scoreOrder-b.scoreOrder || compareContinuousId(a.strikeId,b.strikeId));
  const os = [...observations].sort((a,b) => a.performanceTimeMs-b.performanceTimeMs || compareContinuousId(a.observationId,b.observationId));
  if(!ts.length||!os.length)return Object.freeze([]);
  const counts = Array.from({length:ts.length+1},()=>new Float64Array(os.length+1));
  const costs = Array.from({length:ts.length+1},()=>new Float64Array(os.length+1));
  for (let i=ts.length-1;i>=0;i--) for (let j=os.length-1;j>=0;j--) {
    let count=counts[i+1][j],cost=costs[i+1][j];
    if(counts[i][j+1]>count || counts[i][j+1]===count && costs[i][j+1]<cost) {
      count=counts[i][j+1];cost=costs[i][j+1];
    }
    if(withinContinuousWindow(ts[i].expectedPerformanceTimeMs,os[j].performanceTimeMs)) {
      const pairedCount=1+counts[i+1][j+1];
      const pairedCost=Math.abs(ts[i].expectedPerformanceTimeMs-os[j].performanceTimeMs)+costs[i+1][j+1];
      if(pairedCount>count || pairedCount===count && pairedCost<cost){count=pairedCount;cost=pairedCost;}
    }
    counts[i][j]=count;costs[i][j]=cost;
  }
  const matches: SameKeyMatch[]=[];
  let targetStart=0,observationStart=0,remaining=counts[0][0],remainingCost=costs[0][0];
  while(remaining>0) {
    let found=false;
    for(let i=targetStart;i<ts.length&&!found;i++) for(let j=observationStart;j<os.length;j++) {
      const offset=os[j].performanceTimeMs-ts[i].expectedPerformanceTimeMs;
      if(withinContinuousWindow(ts[i].expectedPerformanceTimeMs,os[j].performanceTimeMs)
        && 1+counts[i+1][j+1]===remaining && Math.abs(offset)+costs[i+1][j+1]===remainingCost) {
        matches.push(Object.freeze({strikeId:ts[i].strikeId,observationId:os[j].observationId,timingOffsetMs:offset}));
        targetStart=i+1;observationStart=j+1;
        remaining=counts[targetStart][observationStart];remainingCost=costs[targetStart][observationStart];
        found=true;break;
      }
    }
    if(!found)throw new ContinuousEvaluationError('UNRESOLVED_RESERVATION');
  }
  return Object.freeze(matches);
}
