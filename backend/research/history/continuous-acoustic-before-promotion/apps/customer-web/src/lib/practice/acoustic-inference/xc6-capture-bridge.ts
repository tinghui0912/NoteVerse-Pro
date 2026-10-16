import identities from './xc6-source-identities.json';
import { Xc4RobustAcousticRuntime, type Xc4Publication } from './xc4-robust-acoustic-runtime';
import { retainDiagnostic, MAX_DIAGNOSTIC_WINDOWS } from './xc7-resource-policy';
import { XC4,canonicalJson,sha256,onlyFields } from './xc4-robust-runtime-contract';
import { Xc6Source48000 } from './xc6-source-48000';
import type { Xc4InferencePort } from './xc4-robust-worker-adapter';

export type Xc6CaptureMessage={type:'pcm-chunk';sequence:number;sourceSampleRateHz:number;
  sourceStartSampleIndex:number;sourceEndSampleIndex:number;audioContextStartFrame:number;
  inputChannelCount:number;captureTimeSeconds:number;samples:Float32Array};
type Options={engineeringOnly:true;sessionId:string;sourceSampleRateHz:number;coefficientBytes:Uint8Array;
  worker:Xc4InferencePort;performanceClock:{nowMs():number};
  onAcousticPublication?:(publication:Xc6Publication)=>void;onFailure?:(error:Error)=>void};
export type Xc6Publication=ReturnType<Xc6DisabledCaptureBridge['projectPublication']>;

/** Source-adapter wrapper only. No getUserMedia, score, verdict or cursor authority. */
export class Xc6DisabledCaptureBridge {
  private rawNext=0;
  private sequence=0;
  private contextOriginFrame:number|null=null;
  private failed:unknown;
  private ingressClosed=false;
  private startRaw:number|undefined;
  private stopRaw:number|undefined;
  private started=false;
  private stopped=false;
  private blocks=0;
  private ignoredAfterTail=0;
  private delivering=false;
  private readonly sizes:Record<string,number>={};
  private readonly channels:Record<string,number>={};
  private readonly stateTransitions:string[]=[];
  private constructor(private readonly core:Xc4RobustAcousticRuntime,
    readonly sourceSampleRateHz:44100|48000,readonly sourceAdapterIdentitySha256:string,
    private readonly filter:Xc6Source48000|null,private readonly onFailure?:Options['onFailure']){}

  static async create(options:Options):Promise<Xc6DisabledCaptureBridge>{
    onlyFields(options,['engineeringOnly','sessionId','sourceSampleRateHz','coefficientBytes','worker','performanceClock','onAcousticPublication','onFailure']);
    options=Object.freeze({...options});
    if(options.engineeringOnly!==true)throw new Error('XC6_INTERNAL_DISABLED_ENGINEERING_ONLY');
    const rate=options.sourceSampleRateHz;
    if(rate!==44100&&rate!==48000)throw new Error('SOURCE_SAMPLE_RATE_NOT_XC4_QUALIFIED');
    const q=rate===44100?identities['44100']:identities['48000'];
    if(q.identity.acousticCoreIdentitySha256!==XC4.engineeringIdentitySha256
      ||await sha256(new TextEncoder().encode(canonicalJson(q.identity)))!==q.identitySha256)throw new Error('XC6_SOURCE_ADAPTER_IDENTITY_DRIFT');
    const filter=rate===48000?await Xc6Source48000.create(options.coefficientBytes):null;
    let bridge:Xc6DisabledCaptureBridge;
    const core=await Xc4RobustAcousticRuntime.create({engineeringOnly:true,sessionId:options.sessionId,
      // Explicit qualified source-adapter output, never a claim of hardware16k.
      sourceSampleRateHz:filter?16000:44100,mode:filter?'ALREADY_16K_TEST_INJECTION':'CAPTURE',
      coefficientBytes:filter?undefined:options.coefficientBytes,worker:options.worker,performanceClock:options.performanceClock,
      resourcePolicy:'XC7_BOUNDED',onFailure:error=>bridge?.recordFailure(error),
      onAcousticPublication:options.onAcousticPublication?publication=>{
        bridge.delivering=true;
        try{return options.onAcousticPublication!(bridge.projectPublication(publication));}
        finally{bridge.delivering=false;}
      }:undefined});
    bridge=new Xc6DisabledCaptureBridge(core,rate,q.identitySha256,filter,options.onFailure);
    return bridge;
  }

  ingest(message:Xc6CaptureMessage):void{
    onlyFields(message,['type','sequence','sourceSampleRateHz','sourceStartSampleIndex','sourceEndSampleIndex',
      'audioContextStartFrame','inputChannelCount','captureTimeSeconds','samples']);
    this.healthy();
    try{
      const m=message;
      if(m.type!=='pcm-chunk'||m.sourceSampleRateHz!==this.sourceSampleRateHz||!(m.samples instanceof Float32Array)
        ||!Number.isSafeInteger(m.sourceStartSampleIndex)||!Number.isSafeInteger(m.sourceEndSampleIndex)
        ||m.sourceEndSampleIndex-m.sourceStartSampleIndex!==m.samples.length||m.samples.length===0||m.samples.length>2048
        ||m.samples.some(v=>!Number.isFinite(v))||!Number.isInteger(m.inputChannelCount)||m.inputChannelCount<1)throw new Error('XC6_CAPTURE_PACKET_IDENTITY');
      if(m.sequence!==this.sequence)throw new Error('XC6_CAPTURE_SEQUENCE_GAP');
      if(m.sourceStartSampleIndex>this.rawNext)throw new Error('XC6_CAPTURE_SAMPLE_GAP');
      if(m.sourceStartSampleIndex<this.rawNext)throw new Error('XC6_CAPTURE_OVERLAP_OR_BACKWARDS');
      this.contextOriginFrame??=m.audioContextStartFrame-m.sourceStartSampleIndex;
      if(!Number.isSafeInteger(m.audioContextStartFrame)||m.audioContextStartFrame-this.contextOriginFrame!==m.sourceStartSampleIndex
        ||Math.abs(m.captureTimeSeconds*this.sourceSampleRateHz-m.audioContextStartFrame)>1e-5)throw new Error('XC6_CAPTURE_FRAME_IDENTITY_DRIFT');
      this.rawNext=m.sourceEndSampleIndex;this.sequence++;this.blocks++;
      incrementBoundedHistogram(this.sizes,m.samples.length);
      incrementBoundedHistogram(this.channels,m.inputChannelCount);
      if(this.ingressClosed){this.ignoredAfterTail++;return;}
      if(this.filter){
        const out=this.filter.push(m.samples),begin=Math.max(out.startSample,10),end=out.startSample+out.samples.length;
        if(end>begin)this.route(begin,out.samples.subarray(begin-out.startSample));
      }else this.route(m.sourceStartSampleIndex,m.samples);
    }catch(error){this.fail(error);throw error;}
  }

  get preRollReady():boolean{return this.core.state==='READY_FOR_PERFORMANCE';}
  schedulePerformanceStart(input:{sourceSampleIndex:number}):void{
    onlyFields(input,['sourceSampleIndex']);this.healthy();
    if(!this.preRollReady)throw new Error('ACOUSTIC_PREROLL_NOT_READY');
    this.validateBoundary(input.sourceSampleIndex);
    if(this.startRaw!==undefined)throw new Error('XC6_START_ALREADY_SCHEDULED');
    this.startRaw=input.sourceSampleIndex;
  }
  schedulePerformanceStop(input:{sourceSampleIndex:number}):void{
    onlyFields(input,['sourceSampleIndex']);this.healthy();this.validateBoundary(input.sourceSampleIndex);
    if(this.startRaw===undefined||input.sourceSampleIndex<=this.startRaw||this.stopRaw!==undefined)throw new Error('XC6_STOP_IDENTITY');
    this.stopRaw=input.sourceSampleIndex;
  }

  contextStateChanged(state:string):void{
    this.healthy();
    retainDiagnostic(this.stateTransitions,state.slice(0,32));
    if(!this.ingressClosed&&this.startRaw!==undefined&&state!=='running'){
      const error=new Error('XC6_CONTEXT_SUSPENSION_RESTART_REQUIRED');this.fail(error);throw error;
    }
    this.healthy();
  }

  get realTailReady():boolean{
    if(!this.stopped||this.startRaw===undefined||this.stopRaw===undefined)return false;
    return this.core.snapshot().queuedOwnedEndMs===(this.stopRaw-this.startRaw)/this.sourceSampleRateHz*1000;
  }
  closeIngressAfterRealTail():void{
    this.healthy();if(!this.realTailReady)throw new Error('XC6_REAL_TAIL_NOT_READY');this.ingressClosed=true;
  }
  async seal():Promise<void>{this.healthy();if(!this.ingressClosed)throw new Error('XC6_CAPTURE_INGRESS_NOT_CLOSED');await this.core.seal();}
  async dispose():Promise<void>{if(this.delivering)throw new Error('XC7_PUBLICATION_CALLBACK_REENTRANCY');await this.core.dispose();}
  failSession(error:Error):void{this.healthy();this.fail(error);}

  snapshot(){
    const core=this.core.snapshot();
    const publications=core.publications.map(p=>this.projectPublication(p));
    const timings=core.timings.map((t):Readonly<Record<string,number>>=>{
      const ready=this.filter?(t.captureReadySourceEndSampleIndex-1)*3+31:t.captureReadySourceEndSampleIndex;
      const sourceReadyTime=this.startRaw===undefined?0:(ready-this.startRaw)/this.sourceSampleRateHz*1000;
      return{...t,captureReadyOriginalSourceEndSampleIndex:ready,captureReadyOriginalSourceTimeMs:sourceReadyTime,
        captureReadyOriginalSourceToPublicationMs:t.acousticPublicationTimeMs-sourceReadyTime};
    });
    return{state:core.state,sourceSampleRateHz:this.sourceSampleRateHz,sourceAdapterIdentitySha256:this.sourceAdapterIdentitySha256,
      acousticCoreIdentitySha256:XC4.engineeringIdentitySha256,publications,timings,counters:core.counters,resources:core.resources,
      captureMetadata:{blocks:this.blocks,chunkSizeDistribution:{...this.sizes},inputChannelCountDistribution:{...this.channels},
        nextSourceSampleIndex:this.rawNext,firstAudioContextFrame:this.contextOriginFrame,gapCount:this.failed?null:0,
        ignoredAfterRequiredTailBlocks:this.ignoredAfterTail,stateTransitions:[...this.stateTransitions]},
      originalPerformanceSourceRange:this.startRaw===undefined?null:{start:this.startRaw,end:this.stopRaw},
      rawSampleIndicesAuthoritative:true,coreTimeline:core.performanceSegments,
      outstandingDepth:core.outstandingDepth,maxOutstandingDepth:core.maxOutstandingDepth,
      error:this.failed?String(this.failed):core.error,ingressClosed:this.ingressClosed};
  }

  projectPublication(p:Xc4Publication){
    const map=this.filter?3:1;
    return Object.freeze({...p,
      acousticCoreIdentitySha256:XC4.engineeringIdentitySha256,sourceAdapterIdentitySha256:this.sourceAdapterIdentitySha256,
      observations:Object.freeze(p.observations.map(o=>Object.freeze({...o,sourceSampleRateHz:this.sourceSampleRateHz,
        sourceSamplePosition:o.sourceSamplePosition*map,sourceSampleNumerator:o.sourceSampleNumerator*map,
        acousticCoreIdentitySha256:XC4.engineeringIdentitySha256,sourceAdapterIdentitySha256:this.sourceAdapterIdentitySha256})))});
  }

  private recordFailure(error:Error):void{
    if(this.failed)return;this.failed=error;this.ingressClosed=true;
    this.onFailure?.(error);
  }
  private fail(error:unknown):void{this.core.failSession(error instanceof Error?error:new Error(String(error)));}

  private validateBoundary(value:number):void{
    if(!Number.isSafeInteger(value)||value<this.rawNext||value<0||(this.filter&&value%3!==0))throw new Error('XC6_EXTERNAL_SOURCE_BOUNDARY_NOT_ON_QUALIFIED_GRID');
  }
  private healthy():void{if(this.delivering)throw new Error('XC7_PUBLICATION_CALLBACK_REENTRANCY');if(this.failed)throw this.failed;}
  private route(start:number,samples:Float32Array):void{
    const end=start+samples.length;let cursor=start;
    const startAt=this.startRaw===undefined?undefined:this.startRaw/(this.filter?3:1);
    const stopAt=this.stopRaw===undefined?undefined:this.stopRaw/(this.filter?3:1);
    while(cursor<end){
      if(!this.started&&startAt!==undefined&&cursor===startAt){this.core.startPerformance({sourceStartSampleIndex:cursor});this.started=true;}
      if(!this.stopped&&stopAt!==undefined&&cursor===stopAt){this.core.stopPerformance({sourceEndSampleIndex:cursor});this.stopped=true;}
      const boundary=Math.min(end,!this.started&&startAt!==undefined?startAt:Infinity,!this.stopped&&stopAt!==undefined?stopAt:Infinity);
      if(boundary<=cursor)throw new Error('XC6_BOUNDARY_ORDER');
      this.core.append({sourceSampleRateHz:this.filter?16000:44100,sourceStartSampleIndex:cursor,
        sourceEndSampleIndex:boundary,samples:samples.subarray(cursor-start,boundary-start)});cursor=boundary;
    }
    if(!this.started&&startAt===end){this.core.startPerformance({sourceStartSampleIndex:end});this.started=true;}
    if(!this.stopped&&stopAt===end){this.core.stopPerformance({sourceEndSampleIndex:end});this.stopped=true;}
  }
}

function incrementBoundedHistogram(histogram:Record<string,number>,value:number):void{
  const key=String(value);
  const bucket=Object.hasOwn(histogram,key)||Object.keys(histogram).length<MAX_DIAGNOSTIC_WINDOWS?key:'OTHER';
  histogram[bucket]=(histogram[bucket]??0)+1;
}
