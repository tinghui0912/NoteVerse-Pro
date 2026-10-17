import { ContinuousFinalizer } from '../../src/lib/practice/local-core/continuous-finalizer';
import type { ContinuousEvidencePublication, ContinuousExpectedStrike } from '../../src/lib/practice/local-core/continuous-evaluation-types';
export type TruthNote={id:string;pitch:number;timeMs:number;velocity:number;endMs:number};
export const pitchName=(n:number)=>['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][n%12]+(Math.floor(n/12)-1);

/** Recipe is frozen before model execution; only truth determines transformations. */
export function replayProductScenarios(notes:TruthNote[], publications:ContinuousEvidencePublication[]) {
  const groups:{id:string;timeMs:number;notes:TruthNote[]}[]=[];
  for(const note of [...notes].sort((a,b)=>a.timeMs-b.timeMs||a.id.localeCompare(b.id))) {
    const last=groups.at(-1);
    if(!last||note.timeMs-last.timeMs>20||last.notes.some(n=>n.pitch===note.pitch))groups.push({id:'g'+groups.length,timeMs:note.timeMs,notes:[note]});
    else last.notes.push(note);
  }
  const base:ContinuousExpectedStrike[]=groups.flatMap(g=>g.notes.map(n=>({strikeId:n.id,groupId:g.id,pitch:pitchName(n.pitch),expectedPerformanceTimeMs:g.timeMs,renderNoteIds:[]})));
  const absent=(time:number)=>Array.from({length:88},(_,i)=>21+i).find(p=>!notes.some(n=>n.pitch===p&&Math.abs(n.timeMs-time)<=250));
  const specs:{family:string;expected:ContinuousExpectedStrike[];target:string|null;truth:string;extraTruthId?:string}[]=[];
  if(groups[0])specs.push({family:'CORRECT',expected:base,target:groups[0].id,truth:'CORRECT'});
  const first=groups[0],chord=groups.find(g=>g.notes.length>1);
  if(first&&absent(first.timeMs)!==undefined)specs.push({family:'MISSING',expected:[...base,{strikeId:'missing',groupId:'missing',pitch:pitchName(absent(first.timeMs)!),expectedPerformanceTimeMs:first.timeMs,renderNoteIds:[]}],target:'missing',truth:'MISSING'});
  const wrong=groups.find(g=>g.notes.length===1&&g.notes[0].pitch<108&&!notes.some(n=>n.pitch===g.notes[0].pitch+1&&Math.abs(n.timeMs-g.timeMs)<=250));
  if(wrong)specs.push({family:'WRONG',expected:base.map(s=>s.groupId===wrong.id?{...s,pitch:pitchName(wrong.notes[0].pitch+1)}:s),target:wrong.id,truth:'WRONG'});
  if(chord&&absent(chord.timeMs)!==undefined)specs.push({family:'INCOMPLETE_CHORD',expected:[...base,{strikeId:'absent-chord',groupId:chord.id,pitch:pitchName(absent(chord.timeMs)!),expectedPerformanceTimeMs:chord.timeMs,renderNoteIds:[]}],target:chord.id,truth:'INCOMPLETE_CHORD'});
  if(first)specs.push({family:'EXTRA',expected:base.filter(s=>s.strikeId!==first.notes[0].id),target:null,truth:'EXTRA',extraTruthId:first.notes[0].id});
  specs.push({family:'NOT_REACHED',expected:[...base,{strikeId:'future',groupId:'future',pitch:'C4',expectedPerformanceTimeMs:7500,renderNoteIds:[]}],target:'future',truth:'NOT_REACHED'});
  return specs.map(spec=>{
    const ledger=new ContinuousFinalizer(publications[0].sessionDomainId,spec.expected);
    for(const p of publications.slice(0,-1))ledger.publish(p);
    ledger.complete({reason:spec.family==='NOT_REACHED'?'STOPPED_BY_USER':'SCOPE_COMPLETED',performanceTimeMs:6000,availabilityTimeMs:publications.at(-1)!.availabilityTimeMs});
    ledger.publish(publications.at(-1)!);
    const completed=ledger.completedEvaluation();
    if(completed.status!=='COMPLETE')throw new Error('PRODUCT_REPLAY_INCOMPLETE');
    const ids=completed.observationOwnership.map(o=>o.observationId);
    if(new Set(ids).size!==ids.length)throw new Error('DOUBLE_OWNERSHIP');
    const target=completed.groups.find(g=>g.groupId===spec.target);
    const anchor=notes.find(n=>n.id===spec.extraTruthId);
    const extras=anchor?completed.extras.filter(e=>e.observation.pitch===pitchName(anchor.pitch)&&Math.abs(e.observation.performanceTimeMs-anchor.timeMs)<=250):[];
    return {family:spec.family,truth:spec.truth,predicted:spec.target?target!.verdict:extras.length?'EXTRA':'NOT_DETECTED',
      targetGroupId:spec.target,extraTruthId:spec.extraTruthId??null,expected:spec.expected,completed,
      doubleOwnership:0,limitation:'Counterfactual target; legal WRONG ownership may conflict with synthetic EXTRA target, observation is never duplicated.'};
  });
}
