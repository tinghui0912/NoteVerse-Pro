import {describe,it,expect} from 'vitest';
import {replayContinuousScenarios,pitchName} from '../helpers/continuous-scenarios';
import type { ContinuousEvidencePublication } from '@/lib/practice/continuous/domain/evaluation/evidence-types';
import {replayAvailabilityMs} from '../helpers/replay-clock';
describe('replay separates assignment scenarios from source-specific feedback',()=>{
  it('accelerated source availability never precedes coverage; remains monotonic without retiming attacks',()=>{
    const values=[[-100,0],[770,600],[1370,800],[1970,1000],[6500,2000]];
    let last=-Infinity;
    for(const [source,processing] of values){const now=replayAvailabilityMs(source,processing);
      expect(now).toBeGreaterThanOrEqual(Math.max(0,source));expect(now).toBeGreaterThanOrEqual(last);last=now;}
  });
  it.each(['MIDI','MICROPHONE'] as const)('%s replay preserves assignment ownership and source-specific feedback',(inputSource)=>{
    const notes=[{id:'a',pitch:60,timeMs:1000,endMs:1300,velocity:70},
      {id:'b',pitch:64,timeMs:2000,endMs:2300,velocity:70},{id:'c',pitch:67,timeMs:2000,endMs:2300,velocity:70}];
    const pubs:ContinuousEvidencePublication[]=[{publicationId:'p',sessionDomainId:'test',analyzedThroughPerformanceMs:5999,availabilitySessionTimeMs:6100,
      observations:notes.map(n=>({observationId:n.id,pitch:pitchName(n.pitch),performanceTimeMs:n.timeMs,confidence:1,source:inputSource==='MIDI'?'MIDI' as const:'ACOUSTIC' as const}))},
      {publicationId:'terminal',sessionDomainId:'test',analyzedThroughPerformanceMs:6000,availabilitySessionTimeMs:6200,observations:[]}];
    const before=JSON.stringify(pubs),results=replayContinuousScenarios(notes,pubs,inputSource);
    expect(results.map(r=>r.family)).toEqual(['EXACT_MATCH','UNMATCHED_TARGET','NON_TARGET_OBSERVATION','PARTIAL_MATCH','UNATTRIBUTED','NOT_REACHED']);
    expect(results.map(r=>r.predicted)).toEqual(results.map(r=>r.expectedFeedback));
    expect(results.every(r=>r.doubleOwnership===0&&r.assignment.completion!==null)).toBe(true);
    expect(JSON.stringify(pubs)).toBe(before);
  });
});
