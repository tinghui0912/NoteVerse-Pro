import {scenarioArtifact} from '../step_waiting/product-replay';
import {StepPracticeRuntime} from '../../../apps/customer-web/src/lib/practice/local-core/step-runtime';
import {ManualClock} from '../../../apps/customer-web/src/lib/practice/local-core/timebase';
import type {StepAttemptIdentity} from '../../../apps/customer-web/src/lib/practice/local-core/step-attempt';
import type {DecodedPublication} from '../step_decoded_sufficiency/acoustic-gestures';
import {WaitingAcousticAssembly,type GenericAttempt} from './waiting-assembly';

type Evidence={id:string;rate:number;publications:DecodedPublication[];assembly:{warmWitness:{availableMs:number}|null}};
type Group={time:number;notes:{pitch:number;time:number}[]};
export type TruthCase={id:string;family:string;physicalPitches:number[];ownedStart:number;ownedEnd:number;
  scoredEnd:number;eventTime:number;warmBoundary:number;truth:Group[];guards:{start:number;end:number;tags:string[]}[]};
const pitch=(m:number)=>`${['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][m%12]}${Math.floor(m/12)-1}`;
const names=(p:readonly number[])=>[...new Set(p.map(pitch))].sort();
const same=(a:readonly string[],b:readonly string[])=>JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
export function targetVariants(physical:readonly number[]){
  const p=[...physical].sort((a,b)=>a-b),top=p.at(-1)!;
  const absent=(delta:number)=>{const up=top+delta,down=top-delta;return up<=108&&!p.includes(up)?up:down>=21&&!p.includes(down)?down:null;};
  const variants=[{name:'exact',pitches:p}];
  if(p.length>1)variants.push({name:'subset',pitches:p.slice(0,-1)});
  variants.push({name:'superset',pitches:[...p,Array.from({length:88},(_,i)=>21+i).find(n=>!p.includes(n))!]});
  for(const [name,delta] of [['semitone',1],['octave',12]] as const){const n=absent(delta);if(n===null)throw Error('COUNTERFACTUAL_NOT_AVAILABLE');variants.push({name,pitches:[...p.slice(0,-1),n]});}
  return variants;
}
export function scoreProduct(evidence:Evidence,truth:TruthCase,target:readonly number[],mode:'normal'|'busy'|'late'='normal',availabilityShift=0){
  const session=`${truth.id}:${evidence.rate}:${mode}:${target.join('-')}:${availabilityShift}`;
  const regionStart=evidence.publications[0].frontierMs-600;
  const assembly=new WaitingAcousticAssembly(evidence.rate,`${truth.id}:${evidence.rate}`,regionStart,truth.scoredEnd*1000);
  const clock=new ManualClock(regionStart),runtime=new StepPracticeRuntime({artifact:scenarioArtifact([target,target,target,target]),
    scope:{kind:'FULL'},inputSource:'MICROPHONE',localSessionId:session,clock,metadataClock:{nowEpochMs:()=>0}});
  const outcomes:{attempt:GenericAttempt;attemptId:string;generation:number;verdict:string;verdictMs:number;watermark:number;
    physicalSample:number;truthGroup:number|null;corroborated:boolean;target:readonly string[]}[]=[];
  const receipts:{id:string;eventMs:number|null;opened:boolean;late:boolean;eligibleAfter:number;busy:boolean}[]=[];
  let identity:StepAttemptIdentity|null=null,pending:GenericAttempt|null=null,due=Infinity,warmed=false;
  const finish=(time:number)=>{
    if(!pending||!identity)throw Error('NO_ACTIVE_PRODUCT_ATTEMPT');
    clock.set(time);
    const verdict=runtime.completeAttempt(identity,{kind:'EVIDENCE',confidence:pending.confidence,
      observedAttackPitches:pending.pitches,captureEndSessionTime:{domainId:session,ms:pending.captureEndMs}});
    if(verdict.kind!=='FINALIZED')throw Error('PRODUCTION_ATTEMPT_REJECTED');
    const watermark=assembly.commit(time);
    const nearest=truth.truth.map((g,index)=>({g,index,error:Math.abs(g.time*1000-pending!.eventMs)}))
      .filter(g=>g.error<=100).sort((a,b)=>a.error-b.error||a.index-b.index)[0];
    outcomes.push({attempt:pending,attemptId:identity.attemptId,generation:identity.targetGeneration,verdict:verdict.record.verdict,
      verdictMs:time,watermark:watermark.inputEligibleAfter,physicalSample:watermark.capturedThroughSourceSample,
      truthGroup:nearest?.index??null,corroborated:!!nearest&&same(names(nearest.g.notes.map(n=>n.pitch)),names(target)),target:names(target)});
    if(!runtime.isCompleted)runtime.rearm({domainId:session,ms:watermark.inputEligibleAfter});
    pending=null;identity=null;due=Infinity;
  };
  const sequence=evidence.publications.map(p=>({p:{...p,availabilityMs:p.availabilityMs+availabilityShift},late:false}));
  for(let i=0;i<sequence.length;i++){
    const {p,late}=sequence[i];
    if(pending&&due<=p.availabilityMs)finish(due);
    clock.set(p.availabilityMs);const wasBusy=pending!==null,update=assembly.push(p),snapshot=assembly.snapshot();
    if(!warmed&&snapshot.warmReady){
      runtime.acceptInputAfter({domainId:session,ms:snapshot.inputEligibleAfter});warmed=true;
    }
    if(update.opened){
      if(identity||pending)throw Error('SECOND_ATTEMPT_WHILE_BUSY');
      const anchor=update.sealed?.eventMs??snapshot.active!.eventMs;
      identity=runtime.openAttempt({domainId:session,ms:anchor});if(!identity)throw Error('ASSEMBLY_DOMAIN_ELIGIBILITY_DIVERGENCE');
    }
    receipts.push({id:p.publicationId,eventMs:update.sealed?.eventMs??snapshot.active?.eventMs??null,opened:!!update.opened,
      late,eligibleAfter:snapshot.inputEligibleAfter,busy:wasBusy});
    if(update.sealed){
      if(!identity||!runtime.analyzeAttempt(identity))throw Error('PRODUCTION_ANALYSIS_REJECTED');
      pending=update.sealed;due=p.availabilityMs+(mode==='normal'?0:1000);
      if(mode==='normal')finish(due);
      // A delayed receipt preserves original event identity; it does not rewrite source time.
      if(mode==='late'&&!late){
        const remaining=[...sequence.slice(i+1),{p:{...p,availabilityMs:due+1},late:true}]
          .sort((a,b)=>a.p.availabilityMs-b.p.availabilityMs);
        sequence.splice(i+1,sequence.length-i-1,...remaining);
      }
    }
  }
  if(pending)finish(due);
  const unfinished=identity!==null;runtime.end();
  const used=new Set<string>(),reused:string[]=[],duplicates:number[]=[],truthMatches=new Set<number>();
  let stale=0,busyCarry=0,lateCarry=0;
  for(const o of outcomes){
    for(const id of o.attempt.observationIds){if(used.has(id))reused.push(id);used.add(id);}
    if(o.attempt.eventMs<=o.attempt.inputEligibleAfter)stale++;
    if(o.verdict==='MATCH'&&o.truthGroup!==null){if(truthMatches.has(o.truthGroup))duplicates.push(o.truthGroup);truthMatches.add(o.truthGroup);}
    if(o.verdict==='MATCH'&&o.attempt.eventMs<=outcomes[outcomes.indexOf(o)-1]?.watermark)busyCarry++;
  }
  for(const r of receipts)if(r.late&&r.opened)lateCarry++;
  return {outcomes,receipts,snapshot:runtime.snapshot(),unfinished,
    architecture:{doubleAdvanceFromOneTruthGesture:duplicates.length,busyPeriodCarryoverAdvance:busyCarry,
      latePublicationCarryoverAdvance:lateCarry,crossAttemptObservationReuse:reused.length,staleEqualWatermarkAdvance:stale,
      secondAttemptWhileBusy:receipts.filter(r=>r.busy&&r.opened).length},
    waitingOpportunityAfterActualReady:truth.family.endsWith('negative')||truth.eventTime*1000>=(evidence.assembly.warmWitness?.availableMs??Infinity)};
}
