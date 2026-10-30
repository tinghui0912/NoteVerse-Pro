import { expect, it } from 'vitest';
import { resolveMetronomePlan } from './metronome-plan';
import { stepSessionPlan, continuousSessionPlan } from '../__fixtures__/session-plan';
import fixture from '../__fixtures__/canonical-practice-score-artifact.json';
import type { PracticeScoreArtifact } from '../kernel/artifact';

it.each(['STEP','CONTINUOUS'] as const)('%s projects exact resolved timing and freezes all nested plan values',mode=>{
  const artifact=structuredClone(fixture) as PracticeScoreArtifact;
  const session=mode==='STEP'?stepSessionPlan(artifact,{metronomeEnabled:true}):continuousSessionPlan(artifact,{metronomeEnabled:true});
  const plan=session.metronomePlan;
  expect(plan).toMatchObject({mode,initiallyEnabled:true,scopeStartBeat:session.scope.startBeat,
    scopeEndBeat:session.scope.terminalBeat,timelineEndBeat:artifact.scoreEndBeat});
  expect(plan.tempoPlan).toBe(session.tempoPlan);expect(plan.meterSegments).toEqual(artifact.meterSegments);
  expect(Object.isFrozen(plan)).toBe(true);expect(Object.isFrozen(plan.meterSegments)).toBe(true);
  expect(Object.isFrozen(plan.meterSegments[0])).toBe(true);expect(Object.isFrozen(plan.tempoPlan.segments)).toBe(true);
  expect(()=>Object.assign(plan,{mode:'OTHER'})).toThrow();expect(()=>Object.assign(plan.meterSegments[0],{numerator:3})).toThrow();
});
it('empty meter input resolves explicit default 4/4 while terminal timing is always required',()=>{
  const base=stepSessionPlan(structuredClone(fixture) as PracticeScoreArtifact).metronomePlan;
  const plan=resolveMetronomePlan({...base,meterSegments:[],timelineEndBeat:12,scopeEndBeat:12});
  expect(plan.meterSegments).toEqual([{startBeat:0,numerator:4,denominator:4,measureDurationBeats:4,countInPulses:4,source:'DEFAULT_4_4'}]);
  expect(plan.timelineEndBeat).toBe(12);
  for(const terminal of [undefined,NaN,Infinity,-1])expect(()=>resolveMetronomePlan({...base,timelineEndBeat:terminal} as never)).toThrow();
});
