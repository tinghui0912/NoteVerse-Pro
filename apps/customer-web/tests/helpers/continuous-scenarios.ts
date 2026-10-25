import { interpretContinuousAssignment } from '@/lib/practice/continuous/domain/evaluation/interpretation';
import type { PracticeInputSource } from '@/lib/practice/kernel/session';
import { ContinuousAssignmentFinalizer } from '@/lib/practice/continuous/domain/evaluation/assignment-finalizer';
import type { ContinuousEvidencePublication } from '@/lib/practice/continuous/domain/evaluation/evidence-types';
import type { ContinuousExpectedStrike } from '@/lib/practice/continuous/domain/evaluation/assignment-types';
export type TruthNote={id:string;pitch:number;timeMs:number;velocity:number;endMs:number};
export const pitchName=(n:number)=>['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][n%12]+(Math.floor(n/12)-1);

/** Deterministic expected-strike transformations for Continuous behavior tests. */
export function replayContinuousScenarios(notes:TruthNote[], publications:ContinuousEvidencePublication[], inputSource:PracticeInputSource) {
  const groups:{id:string;timeMs:number;notes:TruthNote[]}[]=[];
  for(const note of [...notes].sort((a,b)=>a.timeMs-b.timeMs||a.id.localeCompare(b.id))) {
    const last=groups.at(-1);
    if(!last||note.timeMs-last.timeMs>20||last.notes.some(n=>n.pitch===note.pitch))groups.push({id:'g'+groups.length,timeMs:note.timeMs,notes:[note]});
    else last.notes.push(note);
  }
  const base:ContinuousExpectedStrike[]=groups.flatMap(g=>g.notes.map(n=>({strikeId:n.id,groupId:g.id,pitch:pitchName(n.pitch),expectedPerformanceTimeMs:g.timeMs,renderNoteIds:[]})));
  const absent=(time:number)=>Array.from({length:88},(_,i)=>21+i).find(p=>!notes.some(n=>n.pitch===p&&Math.abs(n.timeMs-time)<=250));
  const specs:{family:string;expected:ContinuousExpectedStrike[];target:string|null;midiFeedback:string;acousticFeedback:string;unattributedAnchorId?:string}[]=[];
  if(groups[0])specs.push({family:'EXACT_MATCH',expected:base,target:groups[0].id,midiFeedback:'CORRECT',acousticFeedback:'SUPPORTED'});
  const first=groups[0],chord=groups.find(g=>g.notes.length>1);
  if(first&&absent(first.timeMs)!==undefined)specs.push({family:'UNMATCHED_TARGET',expected:[...base,{strikeId:'missing',groupId:'missing',pitch:pitchName(absent(first.timeMs)!),expectedPerformanceTimeMs:first.timeMs,renderNoteIds:[]}],target:'missing',midiFeedback:'MISSING',acousticFeedback:'UNCONFIRMED'});
  const wrong=groups.find(g=>g.notes.length===1&&g.notes[0].pitch<108&&!notes.some(n=>n.pitch===g.notes[0].pitch+1&&Math.abs(n.timeMs-g.timeMs)<=250));
  if(wrong)specs.push({family:'GROUP_RESIDUAL',expected:base.map(s=>s.groupId===wrong.id?{...s,pitch:pitchName(wrong.notes[0].pitch+1)}:s),target:wrong.id,midiFeedback:'WRONG',acousticFeedback:'UNCONFIRMED'});
  if(chord&&absent(chord.timeMs)!==undefined)specs.push({family:'PARTIAL_MATCH',expected:[...base,{strikeId:'absent-chord',groupId:chord.id,pitch:pitchName(absent(chord.timeMs)!),expectedPerformanceTimeMs:chord.timeMs,renderNoteIds:[]}],target:chord.id,midiFeedback:'INCOMPLETE_CHORD',acousticFeedback:'PARTIALLY_SUPPORTED'});
  if(first)specs.push({family:'UNATTRIBUTED',expected:base.filter(s=>s.strikeId!==first.notes[0].id),target:null,midiFeedback:'EXTRA',acousticFeedback:'DIAGNOSTIC_ONLY',unattributedAnchorId:first.notes[0].id});
  specs.push({family:'NOT_REACHED',expected:[...base,{strikeId:'future',groupId:'future',pitch:'C4',expectedPerformanceTimeMs:7500,renderNoteIds:[]}],target:'future',midiFeedback:'NOT_REACHED',acousticFeedback:'NOT_REACHED'});
  return specs.map(spec=>{
    const ledger=new ContinuousAssignmentFinalizer(publications[0].sessionDomainId,spec.expected);
    for(const p of publications.slice(0,-1))ledger.publish(p);
    ledger.complete({reason:spec.family==='NOT_REACHED'?'STOPPED_BY_USER':'SCOPE_COMPLETED',performanceTimeMs:6000,availabilityTimeMs:publications.at(-1)!.availabilityTimeMs});
    ledger.publish(publications.at(-1)!);
    const completed=ledger.completedAssignment();
    if(completed.status!=='COMPLETE')throw new Error('PRODUCT_REPLAY_INCOMPLETE');
    const ids=completed.assignment.observationAssignments.map(o=>o.observationId);
    if(new Set(ids).size!==ids.length)throw new Error('DOUBLE_OWNERSHIP');
    const interpretation=interpretContinuousAssignment(completed.assignment,inputSource);
    const target=interpretation.groups.find(g=>g.groupId===spec.target);
    const anchor=notes.find(n=>n.id===spec.unattributedAnchorId);
    const unattributed=anchor?completed.assignment.unattributedObservations.filter(e=>e.observation.pitch===pitchName(anchor.pitch)&&Math.abs(e.observation.performanceTimeMs-anchor.timeMs)<=250):[];
    return {family:spec.family,expectedFeedback:inputSource==='MIDI'?spec.midiFeedback:spec.acousticFeedback,predicted:spec.target?target!.verdict:unattributed.length?(inputSource==='MIDI'?'EXTRA':'DIAGNOSTIC_ONLY'):'NOT_DETECTED',
      targetGroupId:spec.target,unattributedAnchorId:spec.unattributedAnchorId??null,expected:spec.expected,assignment:completed.assignment,interpretation,
      doubleOwnership:0,limitation:'Counterfactual target; group residual ownership can compete with an unattributed observation opportunity; observations are never duplicated.'};
  });
}
