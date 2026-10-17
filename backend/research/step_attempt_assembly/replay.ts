import {StepPracticeRuntime} from '../../../apps/customer-web/src/lib/practice/local-core/step-runtime';
import {ManualClock} from '../../../apps/customer-web/src/lib/practice/local-core/timebase';
import type {StepAttemptIdentity} from '../../../apps/customer-web/src/lib/practice/local-core/step-attempt';
import {scenarioArtifact,type Scenario} from '../step_waiting/product-replay';
import type {DecodedPublication} from '../step_decoded_sufficiency/acoustic-gestures';
import {BoundedAcousticAssembler,type SealedAcousticAttempt} from './assembler';

/** Independent continuously running capture clock, not acoustic analysis coverage. */
class PhysicalCaptureTimeline {
  private sample:number;
  constructor(private readonly rate:number,startMs:number){this.sample=Math.floor(startMs*rate/1000);}
  advanceTo(sessionMs:number){this.sample=Math.max(this.sample,Math.floor(sessionMs*this.rate/1000));}
  snapshot(){return {capturedThroughSourceSample:this.sample,capturedThroughSessionTime:this.sample/this.rate*1000,sourceSampleRateHz:this.rate};}
}
export function replay(id:string,scenario:Scenario,publications:readonly DecodedPublication[],startMs:number,rate:number,widthMs:number){
  const domainId=`${id}:${scenario.name}`,clock=new ManualClock(startMs),capture=new PhysicalCaptureTimeline(rate,startMs);
  const runtime=new StepPracticeRuntime({artifact:scenarioArtifact(scenario.targets),scope:{kind:'FULL'},clock,
    inputSource:'MICROPHONE',localSessionId:domainId,metadataClock:{nowEpochMs:()=>0}});
  const assembler=new BoundedAcousticAssembler(widthMs);
  let identity:StepAttemptIdentity|null=null,lockMs=0,frontier=startMs;
  let analysis:{evidence:SealedAcousticAttempt;dueMs:number;lateOrigin:boolean}|null=null;
  const outcomes:{attemptId:string;verdict:string;targetPitches:readonly string[];observedPitches:readonly string[];observationIds:string[];
    eventMs:number;captureEndMs:number;evidenceAvailabilityMs:number;lockMs:number;verdictMs:number;analysisFrontierMs:number;
    rearmWatermarkMs:number;captureWitness:ReturnType<PhysicalCaptureTimeline['snapshot']>;rearmed:boolean;lateReceipt:boolean;generation:number}[]=[];
  const receipts:{publicationId:string;availabilityMs:number;frontierMs:number;late:boolean;opened:number;busy:boolean}[]=[];
  const finish=(at:number)=>{
    if(!analysis||!identity)throw Error('MISSING_ACTIVE_ATTEMPT');
    capture.advanceTo(at);clock.set(at);
    const evidence=analysis.evidence,target=runtime.currentTarget()!;
    const result=runtime.completeAttempt(identity,{kind:'EVIDENCE',confidence:Math.min(...evidence.observations.map(o=>o.confidence)),
      observedAttackPitches:evidence.pitches,captureEndSessionTime:{domainId,ms:evidence.captureEndMs}});
    if(result.kind!=='FINALIZED')throw Error('STALE_REPLAY_ATTEMPT');
    const captureWitness=capture.snapshot(),watermark=captureWitness.capturedThroughSessionTime;
    if(watermark<evidence.captureEndMs)throw Error('CAPTURE_NOT_COMPLETE');
    outcomes.push({attemptId:identity.attemptId,verdict:result.record.verdict,targetPitches:target.attackPitches,observedPitches:result.record.observedAttackPitches,
      observationIds:evidence.observations.map(o=>o.observationId),eventMs:evidence.eventMs,captureEndMs:evidence.captureEndMs,
      evidenceAvailabilityMs:Math.max(...evidence.observations.map(o=>o.availabilityMs)),lockMs,verdictMs:at,analysisFrontierMs:frontier,
      rearmWatermarkMs:watermark,captureWitness,rearmed:!runtime.isCompleted,lateReceipt:analysis.lateOrigin,generation:identity.targetGeneration});
    if(!runtime.isCompleted)runtime.rearm({domainId,ms:watermark});
    identity=null;analysis=null;
  };
  const deliveries=publications.map(p=>({p,late:false}));
  if(scenario.lateReplay&&publications.length>=3)deliveries.splice(3,0,{p:{...publications[0],availabilityMs:publications[2].availabilityMs},late:true});
  for(const {p,late} of deliveries){
    if(analysis&&analysis.dueMs<=p.availabilityMs)finish(analysis.dueMs);
    capture.advanceTo(p.availabilityMs);clock.set(p.availabilityMs);frontier=Math.max(frontier,p.frontierMs);
    const state=runtime.snapshot().step,ready=state.attemptState==='READY'&&!runtime.isCompleted;
    const receipt={publicationId:p.publicationId,availabilityMs:p.availabilityMs,frontierMs:frontier,late,opened:0,busy:!ready};receipts.push(receipt);
    if(analysis)continue;
    const update=assembler.push(p,{ready,inputEligibleAfterMs:state.inputEligibleAfter.ms});
    if(update.opened){
      identity=runtime.openAttempt({domainId,ms:update.opened.eventMs});
      if(!identity)throw Error('DOMAIN_REJECTED_ELIGIBLE_ANCHOR');
      lockMs=p.availabilityMs;receipt.opened=1;
    }
    if(update.sealed){
      if(!identity||!runtime.analyzeAttempt(identity))throw Error('ANALYSIS_TRANSITION_REJECTED');
      const delay=scenario.name==='busy_period_input'||scenario.name==='late_busy_publication'?500:0;
      analysis={evidence:update.sealed,dueMs:p.availabilityMs+delay,lateOrigin:late};
      if(!delay)finish(p.availabilityMs);
    }
  }
  if(analysis)finish(analysis.dueMs);
  const unfinished=runtime.snapshot().step.activeAttempt;
  runtime.end();
  return {id,scenario,widthMs,outcomes,receipts,ignoredGestures:0,unfinishedAttemptCancelled:unfinished,snapshot:runtime.snapshot()};
}
