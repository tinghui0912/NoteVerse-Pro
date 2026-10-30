import { ContinuousAssignmentFinalizer } from '@/lib/practice/continuous/domain/evaluation/assignment-finalizer';
import { assertCompletedAssignment } from '@/lib/practice/continuous/domain/evaluation/assignment-projection';
import { CONTINUOUS_ASSIGNMENT_WINDOW_MS as W, directStrikeFrontier, withinContinuousWindow } from '@/lib/practice/continuous/domain/evaluation/finalization-policy';
import type { ContinuousExpectedStrike } from '@/lib/practice/continuous/domain/evaluation/assignment-types';
import { genericSolution } from './ordered-solvers';

export type AuditTarget = ContinuousExpectedStrike & { beatDurationMs: number };
export type AuditEvent = { id: string; pianoKey: number; timeMs: number };
export type AuditScenario = { id: string; targets: AuditTarget[]; events: AuditEvent[]; terminalMs: number; scoreGroupOnsets: number[] };
const beatFractions = [1/16,1/8,1/4,1/2,1] as const;
export const candidatePolicies = [
  {id:'CURRENT_FIXED_MS', family:'CURRENT_FIXED_MS',fraction:null,unique:false},
  {id:'MIDPOINT_ONLY',family:'MIDPOINT_ONLY',fraction:null,unique:true},
  {id:'CURRENT_WINDOW_MIDPOINT',family:'CURRENT_WINDOW_MIDPOINT',fraction:null,unique:true},
  ...beatFractions.map(fraction=>({id:`BEAT_RELATIVE_${fraction}`,family:'BEAT_RELATIVE',fraction,unique:false})),
  {id:'GROUP_IOI_HALF_MIDPOINT',family:'GROUP_IOI_HALF_MIDPOINT',fraction:1/2,unique:true},
  {id:'SAME_PITCH_IOI_HALF_MIDPOINT',family:'SAME_PITCH_IOI_HALF_MIDPOINT',fraction:1/2,unique:true},
] as const;
export type Candidate = typeof candidatePolicies[number];
export type CandidateInterval = { targetId:string; eligibilityStartMs:number; eligibilityEndMs:number;
  startMs:number; endMs:number; endInclusive:boolean; missingLocalIoi:boolean };
export type AuditOutcome = { policyId:string; targets:{id:string;state:'MATCHED'|'UNMATCHED'; requiredFrontierMs:number;
  unclampedFrontierMs:number;latencyMs:number;latencyLocalBeats:number; terminalClamp:boolean}[];
  events:{id:string;assignedTargetId:string|null;relation:'STRIKE_MATCH'|'UNATTRIBUTED';offsetMs:number|null;eligibilityClaimants:number;ownershipClaimants:number}[] };
const onset=(t:AuditTarget)=>t.expectedPerformanceTimeMs;
const targetOrder=(a:AuditTarget,b:AuditTarget)=>onset(a)-onset(b)||a.strikeId.localeCompare(b.strikeId);
const samePitch=(s:AuditScenario,t:AuditTarget)=>s.targets.filter(x=>x.pianoKey===t.pianoKey).sort(targetOrder);
export function intervals(s:AuditScenario,p:Candidate):CandidateInterval[] {
  return s.targets.map(t=>{
    const peers=samePitch(s,t), at=peers.findIndex(x=>x.strikeId===t.strikeId);
    const previous=peers[at-1], next=peers[at+1];
    const left=previous?(onset(previous)+onset(t))/2:0, right=next?(onset(t)+onset(next))/2:s.terminalMs;
    const coordinates=p.family==='GROUP_IOI_HALF_MIDPOINT' ? [...new Set(s.scoreGroupOnsets)] : peers.map(onset);
    const gaps=coordinates.filter(x=>x!==onset(t)).map(x=>Math.abs(x-onset(t)));
    const missingLocalIoi=gaps.length===0;
    const radius=p.family==='CURRENT_FIXED_MS'||p.family==='CURRENT_WINDOW_MIDPOINT'?W
      :p.family==='BEAT_RELATIVE'?p.fraction!*t.beatDurationMs
        :p.family==='MIDPOINT_ONLY'||missingLocalIoi?null:p.fraction!*Math.min(...gaps);
    const lo=radius===null?0:Math.max(0,onset(t)-radius);
    const hi=radius===null?s.terminalMs:onset(t)+radius;
    const endMs=p.unique?Math.min(hi,right):hi;
    return {targetId:t.strikeId, eligibilityStartMs:lo,eligibilityEndMs:hi,
      startMs:p.unique?Math.max(lo,left):lo,endMs,
      endInclusive:!p.unique||!next||hi<right, missingLocalIoi:radius===null&&p.family!=='MIDPOINT_ONLY'};
  });
}
export function legal(s:AuditScenario,p:Candidate,t:AuditTarget,o:AuditEvent,ownership=true):boolean {
  if(t.pianoKey!==o.pianoKey || o.timeMs<0 || o.timeMs>s.terminalMs)return false;
  if((p.family==='CURRENT_FIXED_MS'||p.family==='CURRENT_WINDOW_MIDPOINT')&&!withinContinuousWindow(onset(t),o.timeMs))return false;
  const w=intervals(s,p).find(x=>x.targetId===t.strikeId)!;
  return ownership?o.timeMs>=w.startMs&&(o.timeMs<w.endMs||w.endInclusive&&o.timeMs===w.endMs)
    :o.timeMs>=w.eligibilityStartMs&&o.timeMs<=w.eligibilityEndMs;
}
/** Conservative offline component frontier for overlapping variable-width candidates. Never a production planner. */
function componentFrontier(s:AuditScenario,p:Candidate,t:AuditTarget,ws:CandidateInterval[]):number {
  const ids=new Set([t.strikeId]);let changed=true;
  while(changed){changed=false;for(const other of s.targets.filter(x=>x.pianoKey===t.pianoKey))if(!ids.has(other.strikeId)){
    const b=ws.find(x=>x.targetId===other.strikeId)!;
    if(ws.some(a=>ids.has(a.targetId)&&a.eligibilityStartMs<=b.eligibilityEndMs&&b.eligibilityStartMs<=a.eligibilityEndMs)){
      ids.add(other.strikeId);changed=true;
    }
  }}
  return Math.max(...ws.filter(w=>ids.has(w.targetId)).map(w=>w.eligibilityEndMs));
}
export function characterizeCandidate(s:AuditScenario,p:Candidate):AuditOutcome {
  const ws=intervals(s,p), byId=new Map(ws.map(w=>[w.targetId,w]));
  const eligible=(t:AuditTarget,o:AuditEvent,ownership=true)=>{
    if(t.pianoKey!==o.pianoKey||o.timeMs<0||o.timeMs>s.terminalMs)return false;
    if((p.family==='CURRENT_FIXED_MS'||p.family==='CURRENT_WINDOW_MIDPOINT')&&!withinContinuousWindow(onset(t),o.timeMs))return false;
    const w=byId.get(t.strikeId)!;
    return ownership?o.timeMs>=w.startMs&&(o.timeMs<w.endMs||w.endInclusive&&o.timeMs===w.endMs)
      :o.timeMs>=w.eligibilityStartMs&&o.timeMs<=w.eligibilityEndMs;
  };
  const owners=new Map<string,string>(),frontiers=new Map<string,{required:number;unclamped:number}>();
  if(p.family==='CURRENT_FIXED_MS') {
    const f=new ContinuousAssignmentFinalizer('timing-audit',s.targets.map(t=>({strikeId:t.strikeId,groupId:t.groupId,pianoKey:t.pianoKey,expectedPerformanceTimeMs:t.expectedPerformanceTimeMs,renderNoteIds:t.renderNoteIds})));
    // Request before tail publication so natural terminal clamp is genuinely generated by production.
    f.complete({reason:'SCOPE_COMPLETED',performanceTimeMs:s.terminalMs,availabilitySessionTimeMs:s.terminalMs});
    f.publish({publicationId:'terminal',sessionDomainId:'timing-audit',analyzedThroughPerformanceMs:s.terminalMs,
      availabilitySessionTimeMs:s.terminalMs,observations:s.events.map(e=>({observationId:e.id,pianoKey:e.pianoKey,performanceTimeMs:e.timeMs,confidence:1,source:'MIDI'}))});
    const result=f.completedAssignment();if(result.status!=='COMPLETE')throw Error('AUDIT_CURRENT_INCOMPLETE');
    assertCompletedAssignment(result.assignment);
    for(const g of result.assignment.groups)for(const t of g.strikes){
      if(t.state==='MATCHED')owners.set(t.match.observation.observationId,t.strikeId);
      frontiers.set(t.strikeId,{required:t.finality.requiredAnalysisFrontierMs,unclamped:t.finality.unclampedRequiredFrontierMs});
    }
  } else {
    for(const pianoKey of [...new Set(s.targets.map(t=>t.pianoKey))]) {
      const ts=s.targets.filter(t=>t.pianoKey===pianoKey).sort((a,b)=>a.strikeId.localeCompare(b.strikeId)),os=s.events.filter(o=>o.pianoKey===pianoKey).sort((a,b)=>a.id.localeCompare(b.id));
      const costs=ts.map(t=>os.map(o=>eligible(t,o)?Math.abs(onset(t)-o.timeMs):Infinity));
      const pairs=p.unique?ts.flatMap((_,i)=>{
        const row=costs[i].map((cost,j)=>({cost,j})).filter(x=>Number.isFinite(x.cost)).sort((a,b)=>a.cost-b.cost||os[a.j].id.localeCompare(os[b.j].id));
        return row.length?[[i,row[0].j] as const]:[];
      }):genericSolution(costs,os.length).pairs;
      for(const[i,j]of pairs)owners.set(os[j].id,ts[i].strikeId);
    }
    for(const t of s.targets) {
      const unclamped=p.unique?ws.find(w=>w.targetId===t.strikeId)!.endMs:componentFrontier(s,p,t,ws);
      frontiers.set(t.strikeId,{unclamped,required:Math.min(unclamped,s.terminalMs)});
    }
  }
  return {policyId:p.id,targets:[...s.targets].sort(targetOrder).map(t=>{
    const f=frontiers.get(t.strikeId)!;return {id:t.strikeId,state:[...owners.values()].includes(t.strikeId)?'MATCHED':'UNMATCHED',
      requiredFrontierMs:f.required,unclampedFrontierMs:f.unclamped,latencyMs:f.required-onset(t),
      latencyLocalBeats:(f.required-onset(t))/t.beatDurationMs,terminalClamp:f.unclamped>s.terminalMs};
  }),events:[...s.events].sort((a,b)=>a.id.localeCompare(b.id)).map(o=>{
    const id=owners.get(o.id)??null,t=s.targets.find(t=>t.strikeId===id);
    return {id:o.id,assignedTargetId:id,relation:id===null?'UNATTRIBUTED':'STRIKE_MATCH',offsetMs:t?o.timeMs-onset(t):null,
      eligibilityClaimants:s.targets.filter(t=>eligible(t,o,false)).length,ownershipClaimants:s.targets.filter(t=>eligible(t,o)).length};
  })};
}
export function naturalTerminal(targets:readonly ContinuousExpectedStrike[],events:readonly AuditEvent[]):number {
  return Math.max(0,...targets.map(t=>directStrikeFrontier(t,targets)),...events.map(o=>o.timeMs));
}

export function candidateDefinition(p:Candidate) {
  return {policyId:p.id,
    eligibility:p.family==='CURRENT_FIXED_MS'||p.family==='CURRENT_WINDOW_MIDPOINT'?'absolute offset <= current production W'
      :p.family==='MIDPOINT_ONLY'?'none beyond capture/scope boundaries'
        :p.family==='BEAT_RELATIVE'?`absolute offset <= ${p.fraction} * target-local beat duration`
          :`${p.fraction} * nearest ${p.family==='GROUP_IOI_HALF_MIDPOINT'?'canonical group':'same-pianoKey'} IOI; absent IOI uses scope bounds`,
    ownership:p.unique?'same-pianoKey midpoint cells: lower inclusive, upper exclusive; equality belongs to later onset; final scope endpoint inclusive'
      :'overlapping exact-pianoKey graph: maximum cardinality, minimum absolute error, CURRENT uses chronological non-crossing V4 direct-cohort commits; beat candidates use the research V3 generic reference on an offline full graph',
    decisionFrontier:p.family==='CURRENT_FIXED_MS'?'production directStrikeFrontier, terminal-clamped'
      :p.unique?'right edge of eligibility intersected with ownership/scope cell'
        :'maximum right edge of entire connected same-pianoKey interval component, terminal-clamped (conservative offline reference)',
    eligibilityOverlapPossible:true, // Inclusive half-IOI intervals can touch even without positive-width overlap.
    positiveWidthEligibilityOverlapPossible:!p.family.endsWith('IOI_HALF_MIDPOINT'),
    ownershipOverlapPossible:!p.unique,uniqueOwnership:p.unique,
    genericMatcherRequired:p.unique?'no':p.family==='CURRENT_FIXED_MS'
      ?'no; V4 production uses ordered scalar DP with chronological non-crossing ties'
      :'constant-radius objectives admit ordered DP; variable radii can require crossing; necessity of this generic implementation is unknown',
    acceptsArbitrarilyDistant:p.family==='MIDPOINT_ONLY'||p.family==='BEAT_RELATIVE'||p.family==='GROUP_IOI_HALF_MIDPOINT'||p.family==='SAME_PITCH_IOI_HALF_MIDPOINT',
    localityDomain:p.family==='BEAT_RELATIVE'?'finite absolute radius on the tested 40..240 BPM grid; unbounded if local beat duration is unbounded':'fixed W is absolute; IOI/scope geometry has no independent absolute cap',
    freeParameters:p.fraction===null?p.family==='MIDPOINT_ONLY'?[]:['production W (unqualified algorithm-policy parameter)']:[`research fraction ${p.fraction} (unqualified policy parameter)`],
    structuralChoices:p.unique?['same-pianoKey midpoint geometry','right-owned half-open equality','scope endpoints']:['source-blind exact-pianoKey graph'],
    pathology:p.family==='MIDPOINT_ONLY'?'uncapped first/last/sparse cells accept arbitrarily distant events as scope grows'
      :p.family.endsWith('IOI_HALF_MIDPOINT')?'large IOIs yield huge radii; isolated fallback spans scope; no independently qualified locality'
        :p.family==='BEAT_RELATIVE'?'variable local tempi can require crossing optimum; fractions require qualification'
          :'W is not structurally justified; midpoint clipping intentionally changes ownership/cardinality in overlap cases'};
}
