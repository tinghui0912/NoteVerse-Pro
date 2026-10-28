import {expect,it} from 'vitest';
import {beatsToMs} from '@/lib/practice/kernel/tempo';
import {candidatePolicies,characterizeCandidate,intervals,legal} from './candidate-policies';
import {adversarialScenarios,scenario,pauseCoordinateExperiment,tempoScalingScenarios} from './timing-audit-workloads';
import {orderedSolution} from './ordered-solvers';
import {outcomeSignature} from './timing-semantics-audit';
const current=candidatePolicies[0],midpoint=candidatePolicies[1],clipped=candidatePolicies[2];
it.each(['isolated-far-event','long-rest-between-C4','first-target-long-prerest','final-target-long-postrest','sparse-score'])('%s exposes uncapped score-ownership pathology',id=>{
  const s=adversarialScenarios().find(s=>s.id===id)!;
  expect(characterizeCandidate(s,current).events[0].assignedTargetId).toBeNull();
  expect(characterizeCandidate(s,clipped).events[0].assignedTargetId).toBeNull();
  expect(characterizeCandidate(s,midpoint).events[0].assignedTargetId).not.toBeNull();
  for(const p of candidatePolicies.filter(p=>p.family.endsWith('IOI_HALF_MIDPOINT'))) {
    const owner=characterizeCandidate(s,p).events[0].assignedTargetId;
    if(id==='first-target-long-prerest'||id==='final-target-long-postrest')expect(owner).toBeNull();
    else expect(owner).not.toBeNull();
  }
});
it('midpoint equality is right-owned, with infinitesimal probes on both sides',()=>{
  for(const [offset,owner] of [[-1e-6,'t0'],[0,'t1'],[1e-6,'t1']] as const){
    const s=scenario('boundary',[1000,1300],[1150+offset]);
    expect(characterizeCandidate(s,clipped).events[0].assignedTargetId).toBe(owner);
    expect(characterizeCandidate(s,clipped).events[0].ownershipClaimants).toBe(1);
  }
});
it('production identity-based midpoint ties can change which target is green',()=>{
  const left=adversarialScenarios().find(s=>s.id==='id-tie-left-low')!,right=adversarialScenarios().find(s=>s.id==='id-tie-right-low')!;
  expect(characterizeCandidate(left,current).targets.map(t=>t.state)).toEqual(['MATCHED','UNMATCHED']);
  expect(characterizeCandidate(right,current).targets.map(t=>t.state)).toEqual(['UNMATCHED','MATCHED']);
  expect(characterizeCandidate(left,clipped).targets.map(t=>t.state)).toEqual(['UNMATCHED','MATCHED']);
  expect(characterizeCandidate(right,clipped).targets.map(t=>t.state)).toEqual(['UNMATCHED','MATCHED']);
});
it('unchanged acceptance cap plus unique ownership can sacrifice current matching cardinality',()=>{
  const s=adversarialScenarios().find(s=>s.id==='two-events-same-midpoint-cell')!;
  expect(characterizeCandidate(s,current).targets.filter(t=>t.state==='MATCHED')).toHaveLength(2);
  expect(characterizeCandidate(s,clipped).targets.filter(t=>t.state==='MATCHED')).toHaveLength(1);
});
it('retains natural terminal clamp from the real production finalizer',()=>{
  const s=adversarialScenarios().find(s=>s.id==='natural-terminal-clamp')!;
  const result=characterizeCandidate(s,current).targets[0];
  expect(result).toMatchObject({requiredFrontierMs:s.terminalMs,terminalClamp:true});
  expect(result.unclampedFrontierMs).toBeGreaterThan(s.terminalMs);
});
it('all adversarial families are deterministic, retain source-blind facts and do not mutate fixtures',()=>{
  const cases=adversarialScenarios(),before=structuredClone(cases),serialized=JSON.stringify(cases);
  expect(cases).toHaveLength(25);
  for(const s of cases)for(const p of candidatePolicies){
    const a=characterizeCandidate(s,p);expect(characterizeCandidate(s,p)).toEqual(a);
    expect(new Set(a.events.flatMap(o=>o.assignedTargetId?[o.assignedTargetId]:[])).size).toBe(a.events.filter(o=>o.assignedTargetId!==null).length);
    expect(a.targets.every(t=>t.requiredFrontierMs<=s.terminalMs)).toBe(true);
    expect(a.events.every(o=>o.relation===(o.assignedTargetId===null?'UNATTRIBUTED':'STRIKE_MATCH'))).toBe(true);
    if(p.unique){expect(a.events.every(o=>o.ownershipClaimants<=1)).toBe(true);
      for(const t of a.targets)expect(t.requiredFrontierMs).toBe(Math.min(s.terminalMs,intervals(s,p).find(w=>w.targetId===t.id)!.endMs));}
  }
  expect(cases).toEqual(before);expect(JSON.stringify(cases)).toBe(serialized);expect(cases.every(s=>!Object.isFrozen(s.targets))).toBe(true);
});
it('beat-relative radii can create a crossing-only cardinality optimum across a tempo change',()=>{
  const s=adversarialScenarios().find(s=>s.id==='variable-beat-crossing-required')!,p=candidatePolicies.find(p=>p.id==='BEAT_RELATIVE_1')!;
  expect(legal(s,p,s.targets[0],s.events[1])).toBe(true);expect(legal(s,p,s.targets[1],s.events[0])).toBe(true);
  expect(legal(s,p,s.targets[1],s.events[1])).toBe(false);
  expect(characterizeCandidate(s,p).events.map(o=>o.assignedTargetId)).toEqual(['t1','t0']);
});
it('tempo scaling characterizes changed fixed-ms decisions without assuming that invariance is best',()=>{
  const rows=tempoScalingScenarios().filter(s=>s.id.endsWith('/0.2'));
  const outcomes=rows.map(s=>characterizeCandidate(s,current));
  expect(new Set(outcomes.map(o=>JSON.stringify(o.targets.map(t=>t.state)))).size).toBeGreaterThan(1);
  expect(new Set(outcomes.map(o=>JSON.stringify(o.events.map(e=>e.ownershipClaimants)))).size).toBeGreaterThan(1);
  for(const p of candidatePolicies.filter(p=>p.family==='BEAT_RELATIVE')) {
    const signatures=rows.map(s=>outcomeSignature(characterizeCandidate(s,p)));
    expect(signatures.every(s=>JSON.stringify(s)===JSON.stringify(signatures[0]))).toBe(true);
  }
});
it('pause/resume count-in changes reached Session Time but not Performance-Time assignment geometry',()=>{
  const {clock,setNow}=pauseCoordinateExperiment();clock.start();setNow(1000);clock.pause();
  setNow(11000);const resume=clock.resume();expect(clock.snapshot().performanceTimeMs).toBe(1000);
  setNow(11000+resume.countInTotalMs);clock.advanceToNow();expect(clock.snapshot().performanceTimeMs).toBe(1000);
  const capture=11000+resume.countInTotalMs+250;setNow(capture);clock.advanceToNow();
  expect(clock.performanceTimeAtCapture(capture)).toBe(1250);expect(clock.sessionTimeAtReachedPerformance(1250)?.ms).toBe(capture);
  for(const p of candidatePolicies)expect(characterizeCandidate(scenario('geometry',[1000,1500],[1250]),p))
    .toEqual(characterizeCandidate(scenario('geometry',[1000,1500],[clock.performanceTimeAtCapture(capture)!]),p));
});

it.each(candidatePolicies.filter(p=>p.family==='BEAT_RELATIVE'))('$id has a scaled variable-tempo crossing counterexample',p=>{
  const gap=p.fraction!*beatsToMs(1,240);
  const s=scenario('scaled-crossing',[1000,1000+gap],[1000+2*gap,1000+3*gap],{beats:[beatsToMs(1,80),beatsToMs(1,240)]});
  const costs=s.targets.map(t=>s.events.map(o=>legal(s,p,t,o)?Math.abs(t.expectedPerformanceTimeMs-o.timeMs):Infinity));
  expect(orderedSolution(costs,2).cardinality).toBe(1);
  expect(characterizeCandidate(s,p).events.map(o=>o.assignedTargetId)).toEqual(['t1','t0']);
});

it('current-window candidate uses the production predicate even when floating-point interval endpoints round outward',()=>{
  const t=2**60,s=scenario('floating-endpoint',[t],[t+256]);
  expect(characterizeCandidate(s,current).events[0].ownershipClaimants).toBe(0);
  expect(characterizeCandidate(s,clipped).events[0].ownershipClaimants).toBe(0);
  expect(characterizeCandidate(s,clipped).targets[0].state).toBe('UNMATCHED');
});
