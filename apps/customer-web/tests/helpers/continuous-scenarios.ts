import { ContinuousAssignmentFinalizer } from '@/lib/practice/continuous/domain/evaluation/assignment-finalizer';
import type { ContinuousEvidencePublication } from '@/lib/practice/continuous/domain/evaluation/evidence-types';
import type { ContinuousExpectedStrike } from '@/lib/practice/continuous/domain/evaluation/assignment-types';
export type TruthNote={id:string;pianoKey:number;timeMs:number;velocity:number;endMs:number};

/** Deterministic expected-strike transformations for Continuous behavior tests. */
export function replayContinuousScenarios(notes:TruthNote[], publications:ContinuousEvidencePublication[]) {
  const groups:{id:string;timeMs:number;notes:TruthNote[]}[]=[];
  for(const note of [...notes].sort((a,b)=>a.timeMs-b.timeMs||a.id.localeCompare(b.id))) {
    const last=groups.at(-1);
    if(!last||note.timeMs-last.timeMs>20||last.notes.some(n=>n.pianoKey===note.pianoKey))groups.push({id:'g'+groups.length,timeMs:note.timeMs,notes:[note]});
    else last.notes.push(note);
  }
  const base:ContinuousExpectedStrike[]=groups.flatMap(g=>g.notes.map(n=>({strikeId:n.id,groupId:g.id,pianoKey:n.pianoKey,expectedPerformanceTimeMs:g.timeMs,renderNoteIds:[]})));
  const absent=(time:number)=>Array.from({length:88},(_,i)=>21+i).find(p=>!notes.some(n=>n.pianoKey===p&&Math.abs(n.timeMs-time)<=250));
  const specs:{family:string;expected:ContinuousExpectedStrike[];target:string|null;expectedStates:string[];unattributedAnchorId?:string}[]=[];
  if(groups[0])specs.push({family:'EXACT_MATCH',expected:base,target:groups[0].id,expectedStates:groups[0].notes.map(()=> 'MATCHED')});
  const first=groups[0],chord=groups.find(g=>g.notes.length>1);
  if(first&&absent(first.timeMs)!==undefined)specs.push({family:'UNMATCHED_TARGET',expected:[...base,{strikeId:'missing',groupId:'missing',pianoKey:absent(first.timeMs)!,expectedPerformanceTimeMs:first.timeMs,renderNoteIds:[]}],target:'missing',expectedStates:['UNMATCHED']});
  const unsupported=groups.find(g=>g.notes.length===1&&g.notes[0].pianoKey<108&&!notes.some(n=>n.pianoKey===g.notes[0].pianoKey+1&&Math.abs(n.timeMs-g.timeMs)<=250));
  if(unsupported)specs.push({family:'NON_TARGET_OBSERVATION',expected:base.map(s=>s.groupId===unsupported.id?{...s,pianoKey:unsupported.notes[0].pianoKey+1}:s),target:unsupported.id,expectedStates:['UNMATCHED']});
  if(chord&&absent(chord.timeMs)!==undefined)specs.push({family:'PARTIAL_MATCH',expected:[...base,{strikeId:'absent-chord',groupId:chord.id,pianoKey:absent(chord.timeMs)!,expectedPerformanceTimeMs:chord.timeMs,renderNoteIds:[]}],target:chord.id,expectedStates:[...chord.notes.map(n=>({id:n.id,state:'MATCHED'})),{id:'absent-chord',state:'UNMATCHED'}].sort((a,b)=>a.id.localeCompare(b.id)).map(n=>n.state)});
  if(first)specs.push({family:'UNATTRIBUTED',expected:base.filter(s=>s.strikeId!==first.notes[0].id),target:null,expectedStates:[],unattributedAnchorId:first.notes[0].id});
  specs.push({family:'NOT_REACHED',expected:[...base,{strikeId:'future',groupId:'future',pianoKey:60,expectedPerformanceTimeMs:7500,renderNoteIds:[]}],target:'future',expectedStates:['NOT_REACHED']});
  return specs.map(spec=>{
    const ledger=new ContinuousAssignmentFinalizer(publications[0].sessionDomainId,spec.expected);
    for(const p of publications.slice(0,-1))ledger.publish(p);
    ledger.complete({reason:spec.family==='NOT_REACHED'?'STOPPED_BY_USER':'SCOPE_COMPLETED',performanceTimeMs:6000,availabilitySessionTimeMs:publications.at(-1)!.availabilitySessionTimeMs});
    ledger.publish(publications.at(-1)!);
    const completed=ledger.completedAssignment();
    if(completed.status!=='COMPLETE')throw new Error('PRODUCT_REPLAY_INCOMPLETE');
    const ids=completed.assignment.observationAssignments.map(o=>o.observationId);
    if(new Set(ids).size!==ids.length)throw new Error('DOUBLE_OWNERSHIP');
    const target=completed.assignment.groups.find(g=>g.groupId===spec.target);
    const anchor=notes.find(n=>n.id===spec.unattributedAnchorId);
    const unattributed=anchor?completed.assignment.unattributedObservations.filter(e=>e.observation.pianoKey===anchor.pianoKey&&Math.abs(e.observation.performanceTimeMs-anchor.timeMs)<=250):[];
    return {family:spec.family, expectedTargetStates:spec.expectedStates,
      targetStates:target?.strikes.map(strike=>strike.state)??[], unattributedCount:unattributed.length,
      targetGroupId:spec.target,unattributedAnchorId:spec.unattributedAnchorId??null,expected:spec.expected,assignment:completed.assignment,
      doubleOwnership:0,limitation:'Counterfactual target support; every accepted observation remains an exact match or an unattributed fact.'};
  });
}
