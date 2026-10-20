import type {SourceAcousticObservation,SourceAcousticPublication} from '../../../apps/customer-web/src/lib/practice/acoustic/runtime/source-publication';
export const GESTURE_WIDTH_MS=50;
export type State='UNAVAILABLE'|'READY'|'CAPTURING'|'ANALYZING'|'RESET';
export type Receipt=Readonly<{publicationId:string;frontier:number;wallMs:number;capturedThrough:number;observations:readonly SourceAcousticObservation[];late?:boolean}>;
export type Attempt=Readonly<{id:string;anchor:number;end:number;observations:readonly SourceAcousticObservation[];pitches:readonly string[];
  confidence:number;lockWallMs:number;sealWallMs:number;eligibleAfter:number;frontier:number;capturedThrough:number}>;
export type Action=Readonly<{type:'ARM'|'OPEN'|'SEAL'|'VERDICT_READY'|'RESET'|'READY';wallMs:number;sourceSample:number;attempt?:Attempt;
  id?:string;anchor?:number;eligibleAfter?:number}>;
type Active={id:string;anchor:number;end:number;lockWallMs:number;eligibleAfter:number;observations:Map<string,SourceAcousticObservation>};

/** Research-only, score-blind slot ownership. Target/verdict interpretation is exclusively Stage B. */
export class WaitingTopologyGate {
  state:State='UNAVAILABLE';
  private physical:number;
  private eligible:number;
  private active:Active|null=null;
  private pending:Attempt|null=null;
  private until=Infinity;
  readonly actions:Action[]=[];
  readonly receipts:Readonly<{publicationId:string;state:State;opened:boolean;late:boolean;eligibleAfter:number;capturedThrough:number;observationIds:readonly string[]}>[]=[];
  constructor(readonly rate:number,readonly domain:string,start:number,private readonly semanticEnd:number,
    private readonly analysisHold:number,private readonly resetHold:number){
    if(![44100,48000].includes(rate)||![start,semanticEnd,analysisHold,resetHold].every(Number.isSafeInteger))throw Error('SOURCE_SCRIPT_INVALID');
    this.physical=start;this.eligible=start;
  }
  arm(source:number,wallMs:number){
    if(this.state!=='UNAVAILABLE'||source!==this.physical)throw Error('INVALID_ARM');
    this.eligible=source;this.state='READY';this.actions.push({type:'ARM',sourceSample:source,wallMs,eligibleAfter:source});
  }
  get nextBoundary(){return this.until;}
  captureThrough(source:number,wallMs:number){
    if(source<this.physical)throw Error('CAPTURE_BACKWARDS');this.physical=source;
    if(source>=this.until&&this.state==='ANALYZING')this.finishAnalysis(wallMs);
    if(source>=this.until&&this.state==='RESET')this.reopen(wallMs);
  }
  private finishAnalysis(wallMs:number){
    this.actions.push({type:'VERDICT_READY',sourceSample:this.physical,wallMs,attempt:this.pending!});
    this.state='RESET';this.until=this.physical+this.resetHold;
    this.actions.push({type:'RESET',sourceSample:this.physical,wallMs,id:this.pending!.id});
    if(!this.resetHold)this.reopen(wallMs);
  }
  private reopen(wallMs:number){
    this.eligible=this.physical;this.state='READY';this.until=Infinity;
    this.actions.push({type:'READY',sourceSample:this.physical,wallMs,eligibleAfter:this.eligible,id:this.pending!.id});this.pending=null;
  }
  accept(p:Receipt){
    if(p.capturedThrough!==this.physical)throw Error('CAPTURE_RECEIPT_MISMATCH');
    const before=this.state;let opened=false;
    if(this.state==='READY'){
      const first=[...p.observations].sort((a,b)=>a.sourceEventSample-b.sourceEventSample||a.observationId.localeCompare(b.observationId))
        .find(o=>o.sourceEventSample>this.eligible&&o.sourceEventSample<this.semanticEnd);
      if(first){
        this.active={id:`${this.domain}:a:${first.sourceEventSample}`,anchor:first.sourceEventSample,
          end:first.sourceEventSample+this.rate*GESTURE_WIDTH_MS/1000,lockWallMs:p.wallMs,eligibleAfter:this.eligible,observations:new Map()};
        this.state='CAPTURING';opened=true;
        this.actions.push({type:'OPEN',wallMs:p.wallMs,sourceSample:this.physical,id:this.active.id,anchor:this.active.anchor,eligibleAfter:this.eligible});
      }
    }
    if(this.state==='CAPTURING'){
      const a=this.active!;
      for(const o of p.observations)if(o.sourceEventSample>=a.anchor&&o.sourceEventSample<a.end){
        const old=a.observations.get(o.observationId);if(old&&JSON.stringify(old)!==JSON.stringify(o))throw Error('MUTATED_OBSERVATION');
        a.observations.set(o.observationId,Object.freeze({...o}));
        if(a.observations.size>32768)throw Error('BOUNDED_ATTEMPT_LIMIT');
      }
      if(p.frontier>=a.end){
        const observations=Object.freeze([...a.observations.values()]);
        this.pending=Object.freeze({id:a.id,anchor:a.anchor,end:a.end,observations,pitches:Object.freeze([...new Set(observations.map(o=>o.pitch))].sort()),
          confidence:Math.min(...observations.map(o=>o.confidence)),lockWallMs:a.lockWallMs,sealWallMs:p.wallMs,
          eligibleAfter:a.eligibleAfter,frontier:p.frontier,capturedThrough:this.physical});
        this.active=null;this.state='ANALYZING';this.until=this.physical+this.analysisHold;
        this.actions.push({type:'SEAL',wallMs:p.wallMs,sourceSample:this.physical,attempt:this.pending});
        if(!this.analysisHold)this.finishAnalysis(p.wallMs);
      }
    }
    this.receipts.push(Object.freeze({publicationId:p.publicationId,state:before,opened,late:p.late===true,eligibleAfter:this.eligible,
      capturedThrough:this.physical,observationIds:Object.freeze(p.observations.map(o=>o.observationId))}));
  }
  snapshot(){return {state:this.state,eligibleAfter:this.eligible,capturedThrough:this.physical,activeId:this.active?.id??null,pendingId:this.pending?.id??null};}
}
export function sourceReceipt(p:SourceAcousticPublication,base:number,rate:number,physical:number,wallMs:number):Receipt{
  return Object.freeze({publicationId:`${p.sourceDomainId}:w${p.window.windowIndex}`,frontier:base+p.window.ownedEndTarget*rate/16000,
    capturedThrough:physical,wallMs,observations:p.observations});
}
