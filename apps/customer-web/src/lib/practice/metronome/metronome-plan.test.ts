import { expect, it } from 'vitest';
import { resolveMetronomePlan } from './metronome-plan';
import { stepPracticePlan, continuousPracticePlan } from '../__fixtures__/practice-plan';
import fixture from '../__fixtures__/canonical-practice-score-artifact.json';
import type { PracticeScoreArtifact } from '../score/artifact';

it.each(['STEP','CONTINUOUS'] as const)('%s projects exact resolved timing and freezes all nested plan values',mode=>{
  const artifact=structuredClone(fixture) as PracticeScoreArtifact;
  const session=mode==='STEP'?stepPracticePlan(artifact,{metronomeEnabled:true}):continuousPracticePlan(artifact,{metronomeEnabled:true});
  const plan=session.metronomePlan;
  expect(plan).toMatchObject({mode,initiallyEnabled:true,scopeStartTick:session.scope.startTick,
    scopeEndTick:session.scope.terminalTick,timelineEndTick:artifact.scoreEndTick});
  expect(plan.tempoPlan).toBe(session.tempoPlan);expect(plan.meterSegments).toEqual(artifact.meterSegments);
  expect(Object.isFrozen(plan)).toBe(true);expect(Object.isFrozen(plan.meterSegments)).toBe(true);
  expect(Object.isFrozen(plan.meterSegments[0])).toBe(true);expect(Object.isFrozen(plan.tempoPlan.segments)).toBe(true);
  expect(()=>Object.assign(plan,{mode:'OTHER'})).toThrow();expect(()=>Object.assign(plan.meterSegments[0],{numerator:3})).toThrow();
});
it('meter and finite terminal timing are required without repair',()=>{
  const base=stepPracticePlan(structuredClone(fixture) as PracticeScoreArtifact).metronomePlan;
  expect(() => resolveMetronomePlan({...base,meterSegments:[]})).toThrow('initial meter');
  expect(() => resolveMetronomePlan({...base,meterSegments:[{...base.meterSegments[0],startTick:1}]})).toThrow('initial meter');
  for(const terminal of [undefined,NaN,Infinity,-1])expect(()=>resolveMetronomePlan({...base,timelineEndTick:terminal} as never)).toThrow();
});
