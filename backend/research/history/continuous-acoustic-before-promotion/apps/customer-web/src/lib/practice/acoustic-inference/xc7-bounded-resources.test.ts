import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { it, expect, vi } from 'vitest';
import { PerformancePcmTimeline } from '../audio-analysis/capture/performance-pcm-timeline';
import { AcousticSegmentMetadataLedger, MAX_OUTSTANDING_ACOUSTIC_WINDOWS, MAX_DIAGNOSTIC_WINDOWS } from './xc7-resource-policy';
import { Xc4RobustAcousticRuntime, type Xc4Publication } from './xc4-robust-acoustic-runtime';
import { Xc6DisabledCaptureBridge, type Xc6CaptureMessage, type Xc6Publication } from './xc6-capture-bridge';
import { Xc4StreamingResampler } from './xc4-robust-streaming-resampler';
import { Xc6Source48000 } from './xc6-source-48000';
import identities from './xc6-source-identities.json';
import type { Xc4InferencePort, Xc4WorkerInput, Xc4WorkerResult } from './xc4-robust-worker-adapter';

function result(input:Xc4WorkerInput):Xc4WorkerResult {
  const ms=input.window.ownedStartMs+100;
  const sampleIndex=Math.round(input.window.startSample+(ms-input.window.inputWindowStartMs)*16);
  return { events:[{midiPitch:60,pitch:'C4',source:'ACOUSTIC',confidence:.4,onsetScore:.6,frameScore:.4,
    onsetTime:{domainId:'xc4-acoustic-performance',ms,sampleIndex}}],inferenceMs:1,decodeMs:.1 };
}
const fast=():Xc4InferencePort=>({run:async i=>result(i),dispose:async()=>{}});
async function receipt(name:string,value:unknown){
  if(process.env.XC7_TEST_EVIDENCE)await writeFile(`${process.env.XC7_TEST_EVIDENCE}/${name}_${process.env.XC7_FREEZE_ID??'v1'}.json`,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
}
const block=(start:number,n:number,samples=new Float32Array(n))=>({sourceSampleRateHz:16000,sourceStartSampleIndex:start,sourceEndSampleIndex:start+n,samples});
async function core(worker=fast(),sink?:(p:Xc4Publication)=>void,onFailure?:(e:Error)=>void){
  const r=await Xc4RobustAcousticRuntime.create({engineeringOnly:true,sessionId:'xc7',sourceSampleRateHz:16000,
    mode:'ALREADY_16K_TEST_INJECTION',worker,performanceClock:{nowMs:()=>10000000},resourcePolicy:'XC7_BOUNDED',onAcousticPublication:sink,onFailure});
  r.append(block(0,16800));r.startPerformance({sourceStartSampleIndex:16800});return r;
}
const packet=(start:number,n:number,seq:number,rate:number,samples=new Float32Array(n)):Xc6CaptureMessage=>({type:'pcm-chunk',sequence:seq,
  sourceSampleRateHz:rate,sourceStartSampleIndex:start,sourceEndSampleIndex:start+n,audioContextStartFrame:start,
  captureTimeSeconds:start/rate,inputChannelCount:2,samples});

it('metadata-only ledger preserves running/tail identities and generic extraction remains full-retention',()=>{
  for(const rate of [44100,48000]){
    const full=new PerformancePcmTimeline(),bounded=new AcousticSegmentMetadataLedger();
    for(const t of [full,bounded]){
      t.beginRunningSegment({performanceStartMs:0,sourceSampleRateHz:rate,sourceStartSampleIndex:rate});
      t.appendRunningPcm({sourceSampleRateHz:rate,sourceStartSampleIndex:rate,sourceEndSampleIndex:rate+3,samples:Float32Array.of(.1,.2,.3)});
      t.appendContextTail({sourceSampleRateHz:rate,sourceStartSampleIndex:rate+3,sourceEndSampleIndex:rate+5,samples:Float32Array.of(.4,.5)});
      t.sealRunningSegment();
    }
    expect(bounded.snapshot()).toEqual(full.snapshot());expect(bounded.retainedPcmBytes).toBe(0);
    expect('extract' in bounded).toBe(false);expect(full.extract('segment-0',rate,rate+5)).toEqual(Float32Array.of(.1,.2,.3,.4,.5));
  }
});

it('30-minute fake-fast session retains O(1) PCM and32 diagnostics while streaming3000 windows',async()=>{
  let count=0,last=-1,firstId='',lastId='';
  const r=await core(fast(),p=>{
    expect(Object.isFrozen(p)&&Object.isFrozen(p.window)&&Object.isFrozen(p.observations)&&Object.isFrozen(p.observations[0])).toBe(true);
    expect(p.window.windowIndex).toBe(last+1);last=p.window.windowIndex;count++;
    firstId||=p.observations[0].observationId;lastId=p.observations[0].observationId;
  });
  const reusable=new Float32Array(9600);let next=16800;
  for(let i=0;i<3000;i++){
    r.append(block(next,9600,reusable));next+=9600;await r.drain();
    if(i%100===0){const s=r.snapshot();expect(s.resources.timelinePcmBytes).toBe(0);expect(s.resources.targetRingBytes).toBe(262144);
      expect(s.publications.length).toBeLessThanOrEqual(32);expect(s.timings.length).toBeLessThanOrEqual(32);expect(s.nextSourceSampleIndex).toBe(next);}
  }
  r.stopPerformance({sourceEndSampleIndex:next});r.append(block(next,2720));await r.seal();
  const s=r.snapshot();expect(count).toBe(3000);expect(s.state).toBe('SEALED');expect(s.publications).toHaveLength(32);expect(s.timings).toHaveLength(32);
  expect(s.counters).toEqual({totalWindowsQueued:3000,totalWindowsStarted:3000,totalWindowsPublished:3000,totalObservationsPublished:3000,
    totalBackpressureFailures:0,publicationDeliveryAttempts:3000});
  expect(s.outstandingDepth).toBe(0);expect(s.performanceSegments).toHaveLength(1);
  expect(s.performanceSegments[0].sourcePerformanceEndSampleIndex).toBe(16800+1800*16000);
  expect(s.performanceSegments[0].sourceContextTailEndSampleIndex).toBe(next+2720);
  expect(firstId).toBe('xc7:0:60:18400');expect(lastId).toBe('xc7:2999:60:28808800');
  // Persistent PCM stores are just the target ring. Worker/sink in this test retain no inputs.
  const internals=r as unknown as {timeline:object;ring:{values:Float32Array};observationIds?:unknown};
  expect(Object.values(internals.timeline).some(v=>ArrayBuffer.isView(v)||Array.isArray(v))).toBe(false);
  expect(internals.ring.values.byteLength).toBe(262144);expect(internals.observationIds).toBeUndefined();
  await receipt('long_session',{durationSeconds:1800,neuralInferenceCount:0,worker:'non-retaining fake fast port',streamed:count,firstId,lastId,snapshot:s});
  await r.dispose();
},120000);

it('fifth ready window fails before allocation; active and queued results never publish afterwards',async()=>{
  let resolve!:(r:Xc4WorkerResult)=>void,input!:Xc4WorkerInput,started=0,delivered=0;
  const stopped=vi.fn();
  const worker:Xc4InferencePort={run:async i=>{started++;input=i;return new Promise(r=>{resolve=r;});},dispose:vi.fn(async()=>{})};
  const r=await core(worker,()=>{delivered++;},stopped);
  r.append(block(16800,12320));await Promise.resolve(); // window1 active
  expect(started).toBe(1);
  r.append(block(29120,28800));expect(r.snapshot().outstandingDepth).toBe(4);
  expect(()=>r.append(block(57920,9600))).toThrow('ACOUSTIC_BACKPRESSURE_LIMIT_EXCEEDED');
  const failed=r.snapshot();expect(failed.state).toBe('FAILED');expect(failed.maxOutstandingDepth).toBe(4);
  expect(failed.resources.outstandingInputBytes).toBe(465920);expect(failed.counters.totalWindowsQueued).toBe(4);
  expect(failed.counters.totalBackpressureFailures).toBe(1);expect(stopped).toHaveBeenCalledTimes(1);
  expect(()=>r.append(block(67520,1))).toThrow('ACOUSTIC_BACKPRESSURE_LIMIT_EXCEEDED');
  resolve(result(input));await expect(r.drain()).rejects.toThrow('ACOUSTIC_BACKPRESSURE_LIMIT_EXCEEDED');
  expect(started).toBe(1);expect(delivered).toBe(0);expect(r.snapshot().publications).toHaveLength(0);expect(r.snapshot().outstandingDepth).toBe(0);
  await receipt('backpressure',{atFailure:failed,afterActiveResolved:r.snapshot(),actualRunsStarted:started,delivered,cleanupCalls:stopped.mock.calls.length});
  await expect(r.seal()).rejects.toThrow('ACOUSTIC_BACKPRESSURE_LIMIT_EXCEEDED');await r.dispose();expect(worker.dispose).toHaveBeenCalledTimes(1);
});

it('sink failure fails the session and suppresses later queued publications',async()=>{
  const cleanup=vi.fn(),sink=vi.fn(()=>{throw new Error('consumer exploded');}),r=await core(fast(),sink,cleanup);
  r.append(block(16800,21920));await expect(r.drain()).rejects.toThrow('ACOUSTIC_PUBLICATION_SINK_FAILED');
  expect(sink).toHaveBeenCalledTimes(1);expect(cleanup).toHaveBeenCalledTimes(1);expect(r.snapshot().counters.totalWindowsStarted).toBe(1);
  expect(r.snapshot().counters.totalWindowsPublished).toBe(0);await r.dispose();
});

it('callback cannot re-enter capture or change runtime state and promise sinks fail explicitly',async()=>{
  let r!:Xc4RobustAcousticRuntime;
  r=await core(fast(),()=>{r.append(block(0,1));});r.append(block(16800,12320));
  await expect(r.drain()).rejects.toThrow('ACOUSTIC_PUBLICATION_SINK_FAILED');await r.dispose();
  const asyncSink=(()=>Promise.reject(new Error('async failure'))) as unknown as (p:Xc4Publication)=>void;
  r=await core(fast(),asyncSink);r.append(block(16800,12320));await expect(r.drain()).rejects.toThrow('ACOUSTIC_PUBLICATION_SINK_FAILED');await r.dispose();
});

for(const rate of [44100,48000])it(`${rate} fast capture preserves exact XC6 window PCM, IDs, original coordinates and adapter identity`,async()=>{
  const bytes=await readFile(rate===44100?'public/engineering/xc4/fir-160-441.f32':'public/engineering/xc6/fir-1-3.f32');
  const start=rate*1.2,end=start+rate*1.2,raw=Float32Array.from({length:rate*2.6},(_,i)=>Math.fround(Math.sin(i*.03)*.1));
  const reference=rate===44100?await Xc4StreamingResampler.create(bytes):await Xc6Source48000.create(bytes);
  const filtered=reference.push(raw),target=filtered instanceof Float32Array?filtered:filtered.samples;
  const projected:Xc6Publication[]=[],calls:Xc4WorkerInput[]=[];
  const worker:Xc4InferencePort={run:async i=>{calls.push(i);return result(i);},dispose:async()=>{}};
  const b=await Xc6DisabledCaptureBridge.create({engineeringOnly:true,sessionId:'xc7-parity',sourceSampleRateHz:rate,coefficientBytes:bytes,worker,
    performanceClock:{nowMs:()=>4000},onAcousticPublication:p=>{projected.push(p);}});
  let seq=0;
  function feed(a:number,z:number){for(let n=a;n<z;n+=128)b.ingest(packet(n,Math.min(128,z-n),seq++,rate,raw.subarray(n,Math.min(n+128,z))));}
  feed(0,start);b.schedulePerformanceStart({sourceSampleIndex:start});b.schedulePerformanceStop({sourceSampleIndex:end});feed(start,raw.length);
  b.closeIngressAfterRealTail();await b.seal();const s=b.snapshot();expect(calls).toHaveLength(2);expect(projected).toEqual(s.publications);
  // XC6 core starts filtered48k at index10;44.1k keeps original source0.
  const base=rate===48000?10:0,origin=start*16000/rate;
  for(const [i,call]of calls.entries()){
    const endTarget=Math.round(origin+((i+1)*600+170)*16);
    expect(call.window).toEqual({windowIndex:i,ownedStartMs:i*600,ownedEndMs:(i+1)*600,
      startSample:endTarget-29120-base,endSample:endTarget-base,inputWindowStartMs:i*600-1050});
    expect(call.pcm).toEqual(target.slice(endTarget-29120,endTarget));
    const o=projected[i].observations[0],sampleIndex=Math.round(origin+(i*600+100)*16)-base;
    expect(o.observationId).toBe(`xc7-parity:${i}:60:${sampleIndex}`);
    expect(o.performanceTimeMs).toBe(i*600+100);expect(o.sourceSamplePosition).toBe(start+(i*600+100)*rate/1000);
    expect(o.sourceSampleNumerator/o.sourceSampleDenominator).toBe(o.sourceSamplePosition);expect(o.availabilityTimeMs).toBe(4000);
  }
  expect(s.sourceAdapterIdentitySha256).toBe(identities[String(rate) as '44100'|'48000'].identitySha256);
  expect(s.resources.timelinePcmBytes).toBe(0);expect(s.coreTimeline).toHaveLength(1);expect(s.captureMetadata.gapCount).toBe(0);await b.dispose();
  await receipt(`fast_parity_${rate}`,{snapshot:s,streamed:projected,inputs:calls.map(c=>({window:c.window,bytes:c.pcm.byteLength,
    sha256:createHash('sha256').update(new Uint8Array(c.pcm.buffer,c.pcm.byteOffset,c.pcm.byteLength)).digest('hex')})),
    oracle:'Existing frozen FIR single-buffer output and explicit XC6 source/window/ID mapping; every PCM value compared by assertion.'});
});

it('bridge propagates overflow once to capture cleanup and rejects all later ingress',async()=>{
  const stopTracks=vi.fn(),disconnect=vi.fn();let finish!:(v:Xc4WorkerResult)=>void,active!:Xc4WorkerInput;
  const worker:Xc4InferencePort={run:async i=>{active=i;return new Promise(r=>{finish=r;});},dispose:async()=>{}};
  const b=await Xc6DisabledCaptureBridge.create({engineeringOnly:true,sessionId:'xc7-overflow',sourceSampleRateHz:48000,
    coefficientBytes:await readFile('public/engineering/xc6/fir-1-3.f32'),worker,performanceClock:{nowMs:()=>10000},
    onFailure:()=>{disconnect();stopTracks();}});
  let next=0,seq=0;function feed(n:number){const end=next+n;while(next<end){const size=Math.min(2048,end-next);b.ingest(packet(next,size,seq++,48000));next+=size;}}
  feed(57600);b.schedulePerformanceStart({sourceSampleIndex:57600});feed(48000);await Promise.resolve();
  expect(()=>feed(120000)).toThrow('ACOUSTIC_BACKPRESSURE_LIMIT_EXCEEDED');expect(stopTracks).toHaveBeenCalledTimes(1);expect(disconnect).toHaveBeenCalledTimes(1);
  expect(b.snapshot().state).toBe('FAILED');expect(b.snapshot().ingressClosed).toBe(true);expect(b.snapshot().maxOutstandingDepth).toBe(4);
  expect(()=>feed(128)).toThrow('ACOUSTIC_BACKPRESSURE_LIMIT_EXCEEDED');finish(result(active));await b.dispose();expect(b.snapshot().publications).toHaveLength(0);
});

it('frozen safety guard sizes are resource policy, not a model/profile or UX threshold',()=>{
  expect(MAX_OUTSTANDING_ACOUSTIC_WINDOWS).toBe(4);expect(MAX_DIAGNOSTIC_WINDOWS).toBe(32);
});

it('both FIR implementations retain128source samples regardless of elapsed chunks',async()=>{
  for(const [path,create]of [
    ['public/engineering/xc4/fir-160-441.f32',Xc4StreamingResampler.create],
    ['public/engineering/xc6/fir-1-3.f32',Xc6Source48000.create],
  ] as const){
    const filter=await create(await readFile(path)),chunk=new Float32Array(128);
    for(let i=0;i<1000;i++)filter.push(chunk);
    const arrays=Object.values(filter).filter(v=>v instanceof Float32Array) as Float32Array[];
    expect(arrays.map(a=>a.length).sort((a,b)=>a-b)).toEqual(path.includes('xc4')?[128,8821]:[61,128]);
  }
});

it('XC7 worklet transfer queue is credit-bounded and ACK preserves unchanged source chronology',async()=>{
  const source=await readFile('src/lib/practice/acoustic-inference/xc7-capture.worklet.js','utf8');
  const sent:{m:Record<string,unknown>;transfer?:Transferable[]}[]=[],scope:Record<string,unknown>={sampleRate:48000,currentFrame:0,currentTime:0,Float32Array,
    AudioWorkletProcessor:class{port={onmessage:undefined,postMessage:(m:Record<string,unknown>,transfer?:Transferable[])=>sent.push({m,transfer})};},
    registerProcessor:(_name:string,ctor:unknown)=>{scope.Processor=ctor;}};
  vm.runInNewContext(source,scope);
  const Ctor=scope.Processor as new()=>{process(a:Float32Array[][],b:Float32Array[][]):boolean;port:{onmessage:(v:{data:unknown})=>void}};
  const worklet=new Ctor(),input=[[new Float32Array(128).fill(.2),new Float32Array(128).fill(.4)]];
  for(let i=0;i<100;i++){
    scope.currentFrame=i*128;scope.currentTime=i*128/48000;expect(worklet.process(input,[])).toBe(true);
    expect(sent[i].m.sourceStartSampleIndex).toBe(i*128);expect(sent[i].m.sequence).toBe(i);
    const pcm=sent[i].m.samples as Float32Array;expect(sent[i].transfer?.[0]).toBe(pcm.buffer);expect(pcm[0]).toBeCloseTo(.3);
    worklet.port.onmessage({data:{type:'ack',sequence:i}});
  }
  const slow=new Ctor();sent.length=0;
  for(let i=0;i<32;i++)expect(slow.process(input,[])).toBe(true);
  expect(slow.process(input,[])).toBe(false);expect(sent.filter(v=>v.m.type==='pcm-chunk')).toHaveLength(32);
  expect(sent.at(-1)?.m).toEqual({type:'capture-failure',error:'ACOUSTIC_CAPTURE_TRANSPORT_LIMIT_EXCEEDED'});
  expect(slow.process(input,[])).toBe(false);expect(sent).toHaveLength(33);
});
