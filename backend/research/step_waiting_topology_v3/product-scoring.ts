import {StepPracticeRuntime} from '../../../apps/customer-web/src/lib/practice/local-core/step-runtime';
import {ManualClock} from '../../../apps/customer-web/src/lib/practice/local-core/timebase';
import type {StepAttemptIdentity} from '../../../apps/customer-web/src/lib/practice/local-core/step-attempt';
import {scenarioArtifact} from '../step_waiting/product-replay';
import {targetVariants} from '../step_waiting_attempt_v2/product-scoring';
import type {Action,Attempt} from './assembly';
export {targetVariants};
type Group={time:number;notes:{pitch:number;time:number}[]};
export type PhysicalCase={id:string;topology:string;intendedTime:number|null;physicalPitches:number[];truth:Group[];scoredEnd:number;arm:number;
 selected:{secondPhysical?:Group};source:{recordingId:string}};
export type AcousticCell={id:string;rate:number;actions:Action[];sourceOriginSample:number;captureTrace:[number,number,string][];
 ready:{sourceSample:number;wallMs:number};warm:{wallMs:number;sourceFrontier:number};receipts:{opened:boolean;state:string;late:boolean;publicationId:string}[]};
const name=(p:number)=>`${['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][p%12]}${Math.floor(p/12)-1}`;
const equal=(a:readonly string[],b:readonly string[])=>JSON.stringify([...new Set(a)].sort())===JSON.stringify([...new Set(b)].sort());
export function captureWitness(cell:AcousticCell,sourceSample:number){
 const index=cell.captureTrace.findIndex(t=>t[0]>sourceSample);
 return index<0?null:{sourceStart:index?cell.captureTrace[index-1][0]:cell.sourceOriginSample,
  sourceEnd:cell.captureTrace[index][0],wallMs:cell.captureTrace[index][1],state:cell.captureTrace[index][2],block:index};
}
export function replayProduct(cell:AcousticCell,physical:PhysicalCase,target:readonly number[],wallShift=0){
 const session=`${cell.id}:${cell.rate}:${target.join('-')}`,clock=new ManualClock(cell.sourceOriginSample/cell.rate*1000);
 const runtime=new StepPracticeRuntime({artifact:scenarioArtifact(Array.from({length:16},()=>target)),scope:{kind:'FULL'},
  localSessionId:session,inputSource:'MICROPHONE',clock,metadataClock:{nowEpochMs:()=>0}});
 const ms=(sample:number)=>sample/cell.rate*1000;
 let identity:StepAttemptIdentity|null=null,sealed:Attempt|null=null;
 const outcomes:{attempt:Attempt;attemptId:string;generation:number;verdict:string;verdictWallMs:number;verdictPhysicalSample:number;
  truthGroup:number|null;fullPhysicalSupport:boolean;physicalGestureEligible:boolean;target:readonly string[];
  physicalEventCapture:ReturnType<typeof captureWitness>;decodedEventCapture:ReturnType<typeof captureWitness>}[]=[];
 let stale=0,secondBusy=0;
 for(const action of cell.actions){
  clock.set(ms(action.sourceSample));
  if(action.type==='ARM')runtime.acceptInputAfter({domainId:session,ms:ms(action.sourceSample)});
  if(action.type==='OPEN'){
   if(identity)secondBusy++;
   identity=runtime.openAttempt({domainId:session,ms:ms(action.anchor!)});
   if(!identity){stale++;throw Error('PRODUCT_DOMAIN_REJECTED_OPEN');}
  }
  if(action.type==='SEAL'){
   sealed=action.attempt!;if(!identity||!runtime.analyzeAttempt(identity))throw Error('PRODUCT_DOMAIN_REJECTED_ANALYSIS');
  }
  if(action.type==='VERDICT_READY'){
   if(!sealed||!identity)throw Error('NO_ACTIVE_PRODUCT_IDENTITY');
   const nearest=physical.truth.map((g,index)=>({g,index,error:Math.abs(g.time*1000-ms(sealed!.anchor))}))
    .filter(g=>g.error<=100).sort((a,b)=>a.error-b.error||a.index-b.index)[0];
   const physicalGestureEligible=!!nearest&&nearest.g.time*cell.rate>sealed.eligibleAfter&&nearest.g.time<physical.scoredEnd;
   // Old context/busy truth with the same pitches cannot corroborate a new READY attempt.
   const targetNames=target.map(name).sort(),fullPhysicalSupport=physicalGestureEligible&&equal(nearest!.g.notes.map(n=>name(n.pitch)),targetNames);
   const verdict=runtime.completeAttempt(identity,{kind:'EVIDENCE',confidence:sealed.confidence,observedAttackPitches:sealed.pitches,
    captureEndSessionTime:{domainId:session,ms:ms(sealed.end)}});
   if(verdict.kind!=='FINALIZED')throw Error('PRODUCT_DOMAIN_REJECTED_VERDICT');
   outcomes.push({attempt:sealed,attemptId:identity.attemptId,generation:identity.targetGeneration,verdict:verdict.record.verdict,
    verdictWallMs:action.wallMs+wallShift,verdictPhysicalSample:action.sourceSample,truthGroup:nearest?.index??null,fullPhysicalSupport,
    physicalGestureEligible,target:targetNames,physicalEventCapture:nearest?captureWitness(cell,nearest.g.time*cell.rate):null,
    decodedEventCapture:captureWitness(cell,sealed.anchor)});
   identity=null;sealed=null;
  }
  if(action.type==='READY')runtime.rearm({domainId:session,ms:ms(action.sourceSample)});
 }
 runtime.end();
 const used=new Set<string>(),matchedTruth=new Set<number>();let reuse=0,double=0,busy=0,queued=0,unsupported=0;
 for(const o of outcomes){
  for(const obs of o.attempt.observations){if(used.has(obs.observationId))reuse++;used.add(obs.observationId);}
  if(o.verdict==='MATCH'){
   if(!o.fullPhysicalSupport)unsupported++;
   if(o.truthGroup!==null){if(matchedTruth.has(o.truthGroup))double++;matchedTruth.add(o.truthGroup);}
   if(o.decodedEventCapture&&['UNAVAILABLE','CAPTURING','ANALYZING','RESET'].includes(o.decodedEventCapture.state))busy++;
  }
  if(o.attempt.anchor<=o.attempt.eligibleAfter)stale++;
  if(o.decodedEventCapture&&['UNAVAILABLE','CAPTURING','ANALYZING','RESET'].includes(o.decodedEventCapture.state))queued++;
 }
 const intended=physical.intendedTime===null?null:physical.intendedTime*cell.rate;
 const physicalCapture=intended===null?null:captureWitness(cell,intended);
 return {outcomes,snapshot:runtime.snapshot(),unsupported,
  readiness:{warmCompletionWallMs:cell.warm.wallMs,semanticReadySourceSample:cell.ready.sourceSample,semanticReadyWallMs:cell.ready.wallMs,
   intendedPhysicalSourceSample:intended,eventMinusReadySamples:intended===null?null:intended-cell.ready.sourceSample,
   intendedPhysicalCapture:physicalCapture,valid:intended===null||intended>cell.ready.sourceSample,
   causalWarmBeforeArm:cell.warm.wallMs<=cell.ready.wallMs},
  secondPhysicalCapture:physical.selected.secondPhysical?captureWitness(cell,physical.selected.secondPhysical.time*cell.rate):null,
  architecture:{doubleAdvanceFromOneTruthGesture:double,busyPeriodCarryoverAdvance:busy,
   latePublicationCarryoverAdvance:cell.receipts.filter(r=>r.late&&r.opened).length,crossAttemptObservationReuse:reuse,
   staleEqualWatermarkAdvance:stale,secondAttemptWhileBusy:secondBusy,
   preReadyInputOpenedAttempt:cell.receipts.filter(r=>r.state==='UNAVAILABLE'&&r.opened).length,
   resetInputOpenedAttempt:cell.receipts.filter(r=>r.state==='RESET'&&r.opened).length,busyInputQueuedForLater:queued}};
}
