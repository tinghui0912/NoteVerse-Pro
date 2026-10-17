import {describe,it,expect} from 'vitest';
import {replayProductScenarios,pitchName} from '../../scripts/continuous-product-replay/product-scenarios';
import type {ContinuousEvidencePublication} from '../../src/lib/practice/local-core/continuous-evaluation-types';
import {replayAvailabilityMs} from '../../scripts/continuous-product-replay/replay-clock';
describe('truth-side replay recipe uses the unique product finalizer',()=>{
  it('accelerated source availability never precedes coverage; remains monotonic without retiming attacks',()=>{
    const values=[[-100,0],[770,600],[1370,800],[1970,1000],[6500,2000]];
    let last=-Infinity;
    for(const [source,processing] of values){const now=replayAvailabilityMs(source,processing);
      expect(now).toBeGreaterThanOrEqual(Math.max(0,source));expect(now).toBeGreaterThanOrEqual(last);last=now;}
  });
  it('perfect immutable acoustic evidence exercises all product semantics and terminal truth',()=>{
    const notes=[{id:'a',pitch:60,timeMs:1000,endMs:1300,velocity:70},
      {id:'b',pitch:64,timeMs:2000,endMs:2300,velocity:70},{id:'c',pitch:67,timeMs:2000,endMs:2300,velocity:70}];
    const pubs:ContinuousEvidencePublication[]=[{publicationId:'p',sessionDomainId:'test',analyzedThroughPerformanceMs:5999,availabilityTimeMs:6100,
      observations:notes.map(n=>({observationId:n.id,pitch:pitchName(n.pitch),performanceTimeMs:n.timeMs,confidence:1,source:'ACOUSTIC' as const}))},
      {publicationId:'terminal',sessionDomainId:'test',analyzedThroughPerformanceMs:6000,availabilityTimeMs:6200,observations:[]}];
    const before=JSON.stringify(pubs),results=replayProductScenarios(notes,pubs);
    expect(results.map(r=>r.predicted)).toEqual(['CORRECT','MISSING','WRONG','INCOMPLETE_CHORD','EXTRA','NOT_REACHED']);
    expect(results.every(r=>r.doubleOwnership===0&&r.completed.status==='COMPLETE')).toBe(true);
    expect(JSON.stringify(pubs)).toBe(before);
  });
});
