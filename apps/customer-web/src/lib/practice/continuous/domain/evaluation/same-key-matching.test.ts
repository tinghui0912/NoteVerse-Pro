import {describe,expect,it} from 'vitest';
import {matchOrderedSameKeyEvidence} from './same-key-matching';
import {CONTINUOUS_ASSIGNMENT_WINDOW_MS as W} from './finalization-policy';

const target=(time:number,i:number)=>({strikeId:`target-${100-i}`,pianoKey:60,expectedPerformanceTimeMs:time,scoreOrder:i});
const event=(time:number,i:number)=>({observationId:`event-${100-i}`,pianoKey:60,performanceTimeMs:time});
type Pair=readonly[number,number];
const pairsBefore=(a:readonly Pair[],b:readonly Pair[])=>{
  for(let k=0;k<a.length;k++)for(let axis=0;axis<2;axis++)if(a[k][axis]!==b[k][axis])return a[k][axis]<b[k][axis];
  return false;
};
/** Independent enumeration of every partial injective matching; no production/research solver reuse. */
function exhaustive(ts:readonly number[],os:readonly number[]) {
  let cardinality=-1,cost=Infinity,orderedPairs:Pair[]=[];
  const visit=(i:number,pairs:Pair[],used:Set<number>)=>{
    if(i===ts.length){
      const total=pairs.reduce((sum,[t,o])=>sum+Math.abs(ts[t]-os[o]),0),count=pairs.length;
      const nonCrossing=pairs.every((pair,k)=>k===0||pairs[k-1][1]<pair[1]);
      if(count>cardinality||count===cardinality&&total<cost){cardinality=count;cost=total;orderedPairs=[];}
      if(count===cardinality&&total===cost&&nonCrossing&&(orderedPairs.length!==count||pairsBefore(pairs,orderedPairs)))orderedPairs=[...pairs];
      return;
    }
    visit(i+1,pairs,used);
    for(let j=0;j<os.length;j++)if(!used.has(j)&&Math.abs(ts[i]-os[j])<=W){
      pairs.push([i,j]);used.add(j);visit(i+1,pairs,used);used.delete(j);pairs.pop();
    }
  };visit(0,[],new Set());return {cardinality,cost,orderedPairs};
}
function check(ts:readonly number[],os:readonly number[]) {
  const targets=ts.map(target),observations=os.map(event);
  const canonicalEvents=[...observations].sort((a,b)=>a.performanceTimeMs-b.performanceTimeMs||a.observationId.localeCompare(b.observationId));
  const before=structuredClone({targets,observations});
  const result=matchOrderedSameKeyEvidence(targets,observations),expected=exhaustive(ts,canonicalEvents.map(o=>o.performanceTimeMs));
  const pairs=result.map(m=>[targets.findIndex(t=>t.strikeId===m.strikeId),canonicalEvents.findIndex(o=>o.observationId===m.observationId)] as const);
  expect(result.length).toBe(expected.cardinality);expect(result.reduce((n,m)=>n+Math.abs(m.timingOffsetMs),0)).toBe(expected.cost);
  expect(pairs).toEqual(expected.orderedPairs);expect(pairs.every((p,k)=>k===0||pairs[k-1][0]<p[0]&&pairs[k-1][1]<p[1])).toBe(true);
  expect(matchOrderedSameKeyEvidence([...targets].reverse(),[...observations].reverse())).toEqual(result);
  expect({targets,observations}).toEqual(before);expect(targets.every(t=>!Object.isFrozen(t))).toBe(true);
  expect(observations.every(o=>!Object.isFrozen(o))).toBe(true);expect(Object.isFrozen(result)).toBe(true);
}
function sequences(values:readonly number[],length:number,repeat:boolean):number[][] {
  if(length===0)return [[]];
  return values.flatMap((v,i)=>sequences(values.slice(repeat?i:i+1),length-1,repeat).map(tail=>[v,...tail]));
}
describe('Continuous ordered common-radius objectives and canonical ties',()=>{
  it.each([0,1,2,3])('exhaustively checks %i targets against every 0..3 observation multiset',n=>{
    const grid=Array.from({length:6},(_,i)=>i*W/2),ts=sequences(grid,n,false),os=[0,1,2,3].flatMap(m=>sequences(grid,m,true));
    let count=0;for(const targets of ts)for(const observations of os){check(targets,observations);count++;}
    expect(count).toBe([84,504,1260,1680][n]);
  });
  it('checks 2000 deterministic generated small graphs with an independent exhaustive oracle',()=>{
    let seed=20261028;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
    for(let run=0;run<2000;run++){
      const ts=[...new Set(Array.from({length:random()%5},()=>random()%20*W/4))].sort((a,b)=>a-b);
      const os=Array.from({length:random()%5},()=>random()%20*W/4).sort((a,b)=>a-b);check(ts,os);
    }
  });
  it.each([['a','z'],['z','a']])('earlier unresolved midpoint target wins regardless of IDs %s/%s',(a,b)=>{
    const ts=[{...target(1000,0),strikeId:a},{...target(1300,1),strikeId:b}];
    for(const id of ['a-event','z-event'])expect(matchOrderedSameKeyEvidence([...ts].reverse(),[{...event(1150,0),observationId:id}]))
      .toEqual([{strikeId:a,observationId:id,timingOffsetMs:150}]);
  });
  it('uses chronological non-crossing pairs for indistinguishable equal-time observations',()=>{
    const ts=[target(0,0),target(W/2,1)],os=[{...event(W/2,0),observationId:'z'},{...event(W/2,1),observationId:'a'}];
    expect(matchOrderedSameKeyEvidence(ts,os)).toEqual([
      {strikeId:ts[0].strikeId,observationId:'a',timingOffsetMs:W/2},
      {strikeId:ts[1].strikeId,observationId:'z',timingOffsetMs:0},
    ]);
  });
  it('uses canonical score order only for genuinely identical target times, then IDs as a final fallback',()=>{
    const a={...target(1000,2),strikeId:'a'},z={...target(1000,1),strikeId:'z'};
    expect(matchOrderedSameKeyEvidence([a,z],[event(1000,0)])[0].strikeId).toBe('z');
    expect(matchOrderedSameKeyEvidence([a,{...z,scoreOrder:2}],[event(1000,0)])[0].strikeId).toBe('a');
  });
  it.each([[[1000,1250],[1100,1110]],[[1000,1250],[800,1100]]])('retains both overlapping matches and defeats nearest greedy: %j / %j',(ts,os)=>{
    check(ts,os);expect(matchOrderedSameKeyEvidence(ts.map(target),os.map(event))).toHaveLength(2);
  });
  it.each([-1,1])('keeps inclusive W eligibility and rejects W+1 on side %s',sign=>{
    expect(matchOrderedSameKeyEvidence([target(1000,0)],[event(1000+sign*W,0)])).toHaveLength(1);
    expect(matchOrderedSameKeyEvidence([target(1000,0)],[event(1000+sign*(W+1),0)])).toHaveLength(0);
  });
  it('uses the policy predicate rather than a rounded-outward interval endpoint',()=>{
    const t=2**60;expect(matchOrderedSameKeyEvidence([target(t,0)],[event(t+256,0)])).toHaveLength(0);
  });
  it.each(['target pianoKey','event pianoKey','target duplicate','event duplicate','target time','event time','score order','target id','event id'])('rejects malformed %s without mutating inputs',kind=>{
    const ts=[target(1000,0)],os=[event(1000,0)];
    if(kind==='target pianoKey')ts.push({...target(1200,1),pianoKey:62});if(kind==='event pianoKey')os[0].pianoKey=62;
    if(kind==='target duplicate')ts.push({...ts[0]});if(kind==='event duplicate')os.push({...os[0]});
    if(kind==='target time')ts[0].expectedPerformanceTimeMs=NaN;if(kind==='event time')os[0].performanceTimeMs=-1;
    if(kind==='score order')ts[0].scoreOrder=-1;if(kind==='target id')ts[0].strikeId='';if(kind==='event id')os[0].observationId='';
    const before=structuredClone({ts,os});expect(()=>matchOrderedSameKeyEvidence(ts,os)).toThrow('INVALID_PUBLICATION');expect({ts,os}).toEqual(before);
  });
});
