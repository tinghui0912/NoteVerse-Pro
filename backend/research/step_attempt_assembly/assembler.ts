import type {DecodedObservation, DecodedPublication} from '../step_decoded_sufficiency/acoustic-gestures';

export type InputReadiness = Readonly<{ready:boolean; inputEligibleAfterMs:number}>;
export type AcousticAnchor = Readonly<{eventMs:number; captureEndMs:number}>;
export type SealedAcousticAttempt = AcousticAnchor & Readonly<{
  observations:readonly DecodedObservation[]; pitches:readonly string[]; analyzedThroughMs:number;
}>;
const order=(a:DecodedObservation,b:DecodedObservation)=>a.eventMs-b.eventMs || (a.observationId<b.observationId?-1:a.observationId>b.observationId?1:0);

/** Research-only generic facts. One fixed first-anchor region, no target access. */
export class BoundedAcousticAssembler {
  private active:AcousticAnchor|null=null;
  private observations=new Map<string,DecodedObservation>();
  private frontier=-Infinity;
  constructor(private readonly widthMs:number) {
    if(![35,50,70,90,120].includes(widthMs))throw Error('UNDECLARED_ASSEMBLY_WIDTH');
  }
  push(publication:DecodedPublication,input:InputReadiness):Readonly<{opened:AcousticAnchor|null;sealed:SealedAcousticAttempt|null}> {
    if(!Number.isFinite(publication.frontierMs)||!Number.isFinite(input.inputEligibleAfterMs))throw Error('INVALID_CHRONOLOGY');
    this.frontier=Math.max(this.frontier,publication.frontierMs);
    const observations=[...publication.observations].sort(order);
    let opened:AcousticAnchor|null=null;
    if(!this.active&&input.ready) {
      const first=observations.find(o=>o.eventMs>input.inputEligibleAfterMs);
      if(first)this.active=opened=Object.freeze({eventMs:first.eventMs,captureEndMs:first.eventMs+this.widthMs});
    }
    if(!this.active)return Object.freeze({opened,sealed:null});
    for(const o of observations) {
      if(o.eventMs<this.active.eventMs||o.eventMs>=this.active.captureEndMs)continue;
      if(!Number.isFinite(o.eventMs)||o.eventMs>publication.frontierMs)throw Error('OBSERVATION_BEYOND_FRONTIER');
      const prior=this.observations.get(o.observationId);
      if(prior&&JSON.stringify(prior)!==JSON.stringify(o))throw Error('OBSERVATION_ID_MUTATED');
      this.observations.set(o.observationId,Object.freeze({...o}));
      if(this.observations.size>32768)throw Error('ATTEMPT_OBSERVATION_LIMIT');
    }
    if(this.frontier<this.active.captureEndMs)return Object.freeze({opened,sealed:null});
    const owned=Object.freeze([...this.observations.values()].sort(order));
    const sealed=Object.freeze({...this.active,observations:owned,
      pitches:Object.freeze([...new Set(owned.map(o=>o.pitch))].sort()),analyzedThroughMs:this.frontier});
    this.active=null;this.observations.clear();
    // Remaining observations from this publication never become another region.
    return Object.freeze({opened,sealed});
  }
}
