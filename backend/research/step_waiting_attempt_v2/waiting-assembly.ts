import type {DecodedObservation,DecodedPublication} from '../step_decoded_sufficiency/acoustic-gestures';
export const STEP_ACOUSTIC_GESTURE_WIDTH_MS=50;
export type GenericAttempt=Readonly<{candidateId:string;eventMs:number;captureEndMs:number;observationIds:readonly string[];
  observations:readonly DecodedObservation[];pitches:readonly string[];confidence:number;lockMs:number;sealedAtMs:number;
  analyzedThroughMs:number;capturedThroughSourceSample:number;capturedThroughSessionTime:number;inputEligibleAfter:number}>;
type Active={eventMs:number;captureEndMs:number;lockMs:number;candidateId:string;observations:Map<string,DecodedObservation>};
export class WaitingAcousticAssembly {
  private warm=false;
  private inputEligibleAfter:number;
  private active:Active|null=null;
  private awaitingCommit=false;
  private sealedAt=-Infinity;
  private physicalSample:number;
  private frontier:number;
  private ended=false;
  private warmWitness:{warmOwnedEndMs:number;availableMs:number;inputEligibleAfter:number}|null=null;
  constructor(private readonly rate:number,private readonly domainId:string,private readonly regionStartMs:number,
    private readonly semanticEndMs:number){
    if(![44100,48000].includes(rate))throw Error('UNQUALIFIED_SOURCE_RATE');
    this.inputEligibleAfter=regionStartMs;this.frontier=regionStartMs;this.physicalSample=Math.floor(regionStartMs*rate/1000);
  }
  push(p:DecodedPublication):Readonly<{opened:string|null;sealed:GenericAttempt|null}> {
    this.physicalSample=Math.max(this.physicalSample,Math.floor(p.availabilityMs*this.rate/1000));
    this.frontier=Math.max(this.frontier,p.frontierMs);
    if(!this.warm){
      // One complete source-owned interval, independently of its decoded contents.
      const warmEnd=this.regionStartMs+600;
      if(p.frontierMs>=warmEnd){
        this.warm=true;this.inputEligibleAfter=warmEnd;
        this.warmWitness=Object.freeze({warmOwnedEndMs:warmEnd,availableMs:p.availabilityMs,inputEligibleAfter:warmEnd});
      }
      return Object.freeze({opened:null,sealed:null});
    }
    if(this.ended||this.awaitingCommit)return Object.freeze({opened:null,sealed:null});
    const input=[...p.observations].sort((a,b)=>a.eventMs-b.eventMs||(a.observationId<b.observationId?-1:a.observationId>b.observationId?1:0));
    let opened:string|null=null;
    if(!this.active){
      const first=input.find(o=>o.eventMs>this.inputEligibleAfter&&o.eventMs<this.semanticEndMs);
      if(first){
        opened=`${this.domainId}:a:${first.sourceEventSample}`;
        this.active={eventMs:first.eventMs,captureEndMs:first.eventMs+STEP_ACOUSTIC_GESTURE_WIDTH_MS,
          lockMs:p.availabilityMs,candidateId:opened,observations:new Map()};
      }
    }
    if(this.active){
      const a=this.active;
      for(const o of input)if(o.eventMs>=a.eventMs&&o.eventMs<a.captureEndMs){
        const old=a.observations.get(o.observationId);
        if(old&&JSON.stringify(old)!==JSON.stringify(o))throw Error('MUTATED_ACOUSTIC_IDENTITY');
        a.observations.set(o.observationId,Object.freeze({...o}));
        if(a.observations.size>32768)throw Error('ATTEMPT_OBSERVATION_LIMIT');
      }
      if(this.frontier>=a.captureEndMs){
        const observations=Object.freeze([...a.observations.values()]);
        // This is a sampled, independently advancing physical source clock, not the analyzed frontier.
        const capturedThroughSessionTime=this.physicalSample/this.rate*1000;
        const sealed:GenericAttempt=Object.freeze({candidateId:a.candidateId,eventMs:a.eventMs,captureEndMs:a.captureEndMs,
          observationIds:Object.freeze(observations.map(o=>o.observationId)),observations,
          pitches:Object.freeze([...new Set(observations.map(o=>o.pitch))].sort()),confidence:Math.min(...observations.map(o=>o.confidence)),
          lockMs:a.lockMs,sealedAtMs:p.availabilityMs,analyzedThroughMs:this.frontier,
          capturedThroughSourceSample:this.physicalSample,capturedThroughSessionTime,inputEligibleAfter:this.inputEligibleAfter});
        this.active=null;this.awaitingCommit=true;this.sealedAt=p.availabilityMs;
        return Object.freeze({opened,sealed});
      }
    }
    if(this.frontier>=this.semanticEndMs&&!this.active)this.ended=true;
    return Object.freeze({opened,sealed:null});
  }
  commit(atSessionMs:number){
    if(!this.awaitingCommit||atSessionMs<this.sealedAt)throw Error('INVALID_ASSEMBLY_COMMIT');
    this.physicalSample=Math.max(this.physicalSample,Math.floor(atSessionMs*this.rate/1000));
    const capturedThroughSessionTime=this.physicalSample/this.rate*1000;
    this.inputEligibleAfter=capturedThroughSessionTime;this.awaitingCommit=false;
    return Object.freeze({capturedThroughSourceSample:this.physicalSample,capturedThroughSessionTime,inputEligibleAfter:this.inputEligibleAfter});
  }
  snapshot(){return Object.freeze({warmReady:this.warm,warmWitness:this.warmWitness,inputEligibleAfter:this.inputEligibleAfter,
    active:this.active?Object.freeze({candidateId:this.active.candidateId,eventMs:this.active.eventMs,captureEndMs:this.active.captureEndMs}):null,
    physicalCapturedThroughSample:this.physicalSample,frontier:this.frontier,ended:this.ended,awaitingCommit:this.awaitingCommit});}
}
