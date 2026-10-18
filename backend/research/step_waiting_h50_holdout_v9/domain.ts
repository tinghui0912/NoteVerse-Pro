import {StepPracticeRuntime} from '../../../apps/customer-web/src/lib/practice/local-core/step-runtime';
import {ManualClock} from '../../../apps/customer-web/src/lib/practice/local-core/timebase';
import type {PracticeScoreArtifact} from '../../../apps/customer-web/src/lib/practice/local-core/artifact';
import {WaitingTopologyGate,GESTURE_WIDTH_MS,type Action,type Receipt} from '../step_waiting_topology_v3/assembly';
export {WaitingTopologyGate,GESTURE_WIDTH_MS};

export const pitch=(n:number)=>['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][n%12]+(Math.floor(n/12)-1);
export function artifact(targets:number[][]):PracticeScoreArtifact{
  const groups=targets.map((set,i)=>({groupId:`g${i}`,onsetBeat:i,canonicalEndBeat:i+1,pitches:set.map(pitch),
    strikeTargets:set.map(n=>({pitch:pitch(n)})),renderNoteIds:[]}));
  return {schemaVersion:1,scoreId:'frozen',revisionId:'v6',artifactId:'v9-domain-replay',scoreEndBeat:targets.length,
    scoreTempoSegments:[],meterSegments:[],expectedPracticeGroups:groups,
    practiceAttackSteps:targets.map((set,i)=>({stepId:`s${i}`,onsetBeat:i,attackTargets:set.map(n=>({pitch:pitch(n)})),continuation:[]}))} as unknown as PracticeScoreArtifact;
}
export function nearest(gestures:any[],sourceMs:number){
  const rows=gestures.map(g=>({g,d:Math.abs(g.onsetMs-sourceMs)})).filter(r=>r.d<=100).sort((a,b)=>a.d-b.d);
  if(!rows.length)return {status:'NO_FROZEN_TRUTH_GESTURE_WITHIN_100MS',gesture:null};
  if(rows.length>1&&rows[0].d===rows[1].d)return {status:'NOT_EVALUABLE_AMBIGUOUS_TRUTH',gesture:null};
  return {status:'ATTRIBUTED',gesture:rows[0].g,distanceMs:rows[0].d};
}
export const same=(a:number[],b:number[])=>JSON.stringify([...new Set(a)].sort((x,y)=>x-y))===JSON.stringify([...new Set(b)].sort((x,y)=>x-y));
export const supported=(gesture:any,target:number[])=>!!gesture&&same(gesture.normalizedPitchSet,target);
export const denominator=(valid:boolean,architecture=false)=>architecture?null:valid?1:0;
export function claimTruth(owners:Set<string>,id:string){if(owners.has(id))return false;owners.add(id);return true;}

/** Dispatches frozen score-blind gate actions to the actual product verdict owner. */
export class ProductAdapter{
  readonly gate:WaitingTopologyGate;readonly runtime:StepPracticeRuntime;readonly clock=new ManualClock();
  readonly outcomes:any[]=[];readonly ownershipViolations:any[]=[];readonly transitions:any[]=[];
  private cursor=0;private identity:any=null;private currentAttempt:any=null;
  private ids=new Map<string,string>();
  constructor(readonly rate:number,readonly id:string,origin:number,end:number,targets:number[][],hold:number){
    this.gate=new WaitingTopologyGate(rate,id,origin,end,hold,0);
    this.runtime=new StepPracticeRuntime({artifact:artifact(targets),scope:{kind:'FULL'},inputSource:'MICROPHONE',clock:this.clock,
      metadataClock:{nowEpochMs:()=>0},localSessionId:id});
    this.runtime.setInputUnavailable();
  }
  time(sample:number){return {domainId:this.id,ms:sample*1000/this.rate,sampleIndex:sample};}
  private sync(){while(this.cursor<this.gate.actions.length){const a:Action=this.gate.actions[this.cursor++];
    this.clock.set(a.sourceSample*1000/this.rate);
    if(a.type==='ARM')this.runtime.acceptInputAfter(this.time(a.eligibleAfter!));
    if(a.type==='OPEN'){
      this.identity=this.runtime.openAttempt(this.time(a.anchor!));
      if(!this.identity)throw Error('SCORER_PRODUCT_OPEN_DIVERGENCE');
      this.currentAttempt={identity:this.identity,target:this.runtime.currentTarget(),openCaptureSource:a.sourceSample,anchor:a.anchor,eligibleAfter:a.eligibleAfter};
    }
    if(a.type==='SEAL'){
      if(!this.identity||!this.runtime.analyzeAttempt(this.identity))throw Error('SCORER_PRODUCT_ANALYZE_DIVERGENCE');
      const attempt=a.attempt!;
      for(const o of attempt.observations){const old=this.ids.get(o.observationId);
        if(old&&old!==this.identity.attemptId)this.ownershipViolations.push({observationId:o.observationId,old,next:this.identity.attemptId});
        this.ids.set(o.observationId,this.identity.attemptId);}
      this.currentAttempt={...this.currentAttempt,attempt,analysisCaptureSource:a.sourceSample};
    }
    if(a.type==='VERDICT_READY'){
      const attempt=a.attempt!;
      const result=this.runtime.completeAttempt(this.identity,{kind:'EVIDENCE',observedAttackPitches:[...attempt.pitches],
        confidence:attempt.confidence,captureEndSessionTime:this.time(attempt.end)});
      if(result.kind!=='FINALIZED')throw Error('SCORER_PRODUCT_COMPLETION_DIVERGENCE');
      this.outcomes.push({...this.currentAttempt,record:result.record,verdictCaptureSource:a.sourceSample,
        nextTargetGeneration:this.runtime.snapshot().step.targetGeneration});this.identity=null;
    }
    if(a.type==='READY'){
      if(!this.runtime.isCompleted)this.runtime.rearm(this.time(a.eligibleAfter!));
      const o=this.outcomes.at(-1);if(o){o.rearmPhysicalWatermark=a.eligibleAfter;o.nextReadySource=a.sourceSample;}
    }
    this.transitions.push({action:a.type,sourceSample:a.sourceSample,targetGeneration:this.runtime.snapshot().step.targetGeneration,
      attemptState:this.runtime.snapshot().step.attemptState,lifecycle:this.runtime.state,inputEligibleAfter:this.runtime.snapshot().step.inputEligibleAfter});
  }}
  arm(source:number){this.gate.arm(source,source*1000/this.rate);this.sync();}
  capture(source:number){this.gate.captureThrough(source,source*1000/this.rate);this.sync();}
  accept(receipt:Receipt){
    if(this.runtime.isCompleted)return;
    this.gate.accept(receipt);this.sync();
  }
  state(){return this.runtime.isCompleted?'ENDED':this.gate.state;}
}
