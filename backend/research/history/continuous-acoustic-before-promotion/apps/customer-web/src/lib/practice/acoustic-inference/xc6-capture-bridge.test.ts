import {readFile} from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {it,expect,vi} from 'vitest';
import {Xc6DisabledCaptureBridge,type Xc6CaptureMessage} from './xc6-capture-bridge';
import {Xc6Source48000} from './xc6-source-48000';
import identities from './xc6-source-identities.json';
import {XC4,sha256,canonicalJson} from './xc4-robust-runtime-contract';
import {evaluatePracticeInputCapabilities} from '../input-capability';
import type {Xc4InferencePort,Xc4WorkerInput} from './xc4-robust-worker-adapter';

const root=process.env.XC5_REPO_ROOT??path.resolve('../..');
const coefficients=()=>readFile('public/engineering/xc6/fir-1-3.f32');
const packet=(start:number,length:number,sequence:number,rate=48000):Xc6CaptureMessage=>({type:'pcm-chunk',sequence,
  sourceSampleRateHz:rate,sourceStartSampleIndex:start,sourceEndSampleIndex:start+length,
  audioContextStartFrame:start,captureTimeSeconds:start/rate,inputChannelCount:2,samples:new Float32Array(length)});
async function bridge(rate=48000){
  const worker:Xc4InferencePort={run:vi.fn(async(input:Xc4WorkerInput)=>{
    const time=input.window.ownedStartMs+100;
    return{events:[{midiPitch:60,pitch:'C4',source:'ACOUSTIC' as const,confidence:.4,onsetScore:.6,frameScore:.4,
      onsetTime:{domainId:'test',ms:time,sampleIndex:Math.round(input.window.startSample+(time-input.window.inputWindowStartMs)*16)}}],inferenceMs:1,decodeMs:.1};
  }),dispose:vi.fn(async()=>{})};
  const value=await Xc6DisabledCaptureBridge.create({engineeringOnly:true,sessionId:'xc6-unit',sourceSampleRateHz:rate,
    coefficientBytes:rate===48000?await coefficients():await readFile('public/engineering/xc4/fir-160-441.f32'),
    worker,performanceClock:{nowMs:()=>4000}});
  return{value,worker};
}

it('capture source identities are content addressed; XC4 core is unchanged',async()=>{
  for(const q of Object.values(identities)){
    expect(await sha256(new TextEncoder().encode(canonicalJson(q.identity)))).toBe(q.identitySha256);
    expect(q.identity.acousticCoreIdentitySha256).toBe(XC4.engineeringIdentitySha256);
  }
  expect(identities['44100'].identity.coefficientSha256).toBe(XC4.coefficientSha256);
  expect(identities['48000'].identity.coefficients.sha256).toBe(await sha256(await coefficients()));
  const source=await readFile(path.join(root,identities['48000'].identity.implementation.path));
  expect(await sha256(source)).toBe(identities['48000'].identity.implementation.sha256);
});
it('new48k FIR matches frozen Docker SciPy prefix and arbitrary chunk boundaries',async()=>{
  const work=path.join(root,'backend/data/work/xc6_capture'),r=JSON.parse(await readFile(path.join(work,'dsp48_reference.json'),'utf8'));
  const bytes=await coefficients();
  for(const fixture of r.fixtures){
    const a=await readFile(path.join(work,fixture.input)),b=await readFile(path.join(work,fixture.reference));
    const input=new Float32Array(a.buffer.slice(a.byteOffset,a.byteOffset+a.byteLength));
    const expected=new Float32Array(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));
    const single=await Xc6Source48000.create(bytes),chunked=await Xc6Source48000.create(bytes),out=single.push(input).samples,joined:number[]=[];
    for(let i=0;i<input.length;i+=137)joined.push(...chunked.push(input.subarray(i,i+137)).samples);
    expect(out.length).toBe(expected.length);expect(out).toEqual(Float32Array.from(joined));
    let max=0,sum=0;out.forEach((v,i)=>{max=Math.max(max,Math.abs(v-expected[i]));sum+=(v-expected[i])**2;});
    expect(max).toBeLessThanOrEqual(r.frozenNumericTolerance.maxAbs);
    expect(out.length?Math.sqrt(sum/out.length):0).toBeLessThanOrEqual(r.frozenNumericTolerance.rms);
  }
});
it('48k adapter requires30 real future samples, discards first10 origin-boundary outputs, has no finish padding',async()=>{
  const r=await Xc6Source48000.create(await coefficients());
  expect(r.push(new Float32Array(30)).samples.length).toBe(0);
  expect(r.push(new Float32Array(1)).samples.length).toBe(1);
  expect(r.firstFullyRealOutputIndex).toBe(10);expect('finish'in r).toBe(false);
});
it('worklet reports real sampleRate/channel count and transfers mono chunks; clock gaps are not concealed',async()=>{
  const sent:{m:Xc6CaptureMessage;transfer:Transferable[]}[]=[],scope:Record<string,unknown>={sampleRate:48000,currentFrame:0,currentTime:0,Float32Array,
    AudioWorkletProcessor:class{port={postMessage:(m:Xc6CaptureMessage,transfer:Transferable[])=>sent.push({m,transfer})};},
    registerProcessor:(_name:string,ctor:unknown)=>{scope.Processor=ctor;}};
  vm.runInNewContext(await readFile('src/lib/practice/acoustic-inference/xc6-capture.worklet.js','utf8'),scope);
  const Ctor=scope.Processor as new()=>{process(a:Float32Array[][],b:Float32Array[][]):boolean},p=new Ctor();
  p.process([[new Float32Array(128).fill(.2),new Float32Array(128).fill(.4)]],[[new Float32Array(128)]]);
  expect(sent[0].m.sourceSampleRateHz).toBe(48000);expect(sent[0].m.inputChannelCount).toBe(2);
  expect(sent[0].transfer[0]).toBe(sent[0].m.samples.buffer);expect(sent[0].m.samples[0]).toBeCloseTo(.3);
  scope.currentFrame=384;scope.currentTime=384/48000;p.process([[new Float32Array(128)]],[]);
  expect(sent[1].m.sourceStartSampleIndex).toBe(384);
});
it('bridge detects sample gaps, overlaps, sequence gaps and source-rate drift',async()=>{
  for(const [kind,error]of[['gap','XC6_CAPTURE_SAMPLE_GAP'],['overlap','XC6_CAPTURE_OVERLAP_OR_BACKWARDS'],['sequence','XC6_CAPTURE_SEQUENCE_GAP'],['rate','XC6_CAPTURE_PACKET_IDENTITY']]){
    const {value:b}=await bridge();b.ingest(packet(0,128,0));
    expect(()=>b.ingest(packet(kind==='gap'?256:kind==='overlap'?0:128,128,kind==='sequence'?3:1,kind==='rate'?44100:48000))).toThrow(error);
  }
});
it('early start fails ACOUSTIC_PREROLL_NOT_READY and unsupported rates have no fallback',async()=>{
  const {value:b}=await bridge();expect(()=>b.schedulePerformanceStart({sourceSampleIndex:0})).toThrow('ACOUSTIC_PREROLL_NOT_READY');
  await expect(bridge(32000)).rejects.toThrow('SOURCE_SAMPLE_RATE_NOT_XC4_QUALIFIED');
});
it('44100 bridge retains frozen XC4 FIR instead of silently using the48k adapter',async()=>{
  const {value:b}=await bridge(44100);
  expect(b.snapshot().sourceAdapterIdentitySha256).toBe(identities['44100'].identitySha256);
});
it('source boundary start/stop, real tail and original48k observation coordinates are preserved',async()=>{
  const {value:b,worker}=await bridge();let sequence=0;
  for(let n=0;n<57600;n+=128)b.ingest(packet(n,128,sequence++));
  expect(b.preRollReady).toBe(true);b.schedulePerformanceStart({sourceSampleIndex:57600});b.schedulePerformanceStop({sourceSampleIndex:115200});
  for(let n=57600;n<124416;n+=128)b.ingest(packet(n,128,sequence++));
  expect(b.realTailReady).toBe(true);b.closeIngressAfterRealTail();await b.seal();
  const s=b.snapshot();expect(s.state).toBe('SEALED');expect(s.captureMetadata.gapCount).toBe(0);
  expect(s.outstandingDepth).toBe(0);expect(vi.mocked(worker.run).mock.calls.length).toBe(2);
  expect(s.originalPerformanceSourceRange).toEqual({start:57600,end:115200});
  const last=s.coreTimeline[0];expect(last.sourcePerformanceEndSampleIndex-last.sourceStartSampleIndex).toBe(19200);
  expect(last.sourceContextTailEndSampleIndex).toBeGreaterThan(last.sourcePerformanceEndSampleIndex);
  const observations=s.publications.flatMap(p=>p.observations);
  expect(observations.map(o=>o.sourceSamplePosition)).toEqual([62400,91200]);
  expect(observations.every(o=>o.sourceSampleRateHz===48000&&o.sourceAdapterIdentitySha256===identities['48000'].identitySha256)).toBe(true);
});
it('suspension after scheduling requires restart; inference never repairs or moves an external cursor',async()=>{
  const {value:b}=await bridge();let sequence=0;
  b.contextStateChanged('suspended');b.contextStateChanged('running');
  for(let n=0;n<57600;n+=128)b.ingest(packet(n,128,sequence++));
  b.schedulePerformanceStart({sourceSampleIndex:57600});
  expect(()=>b.contextStateChanged('suspended')).toThrow('XC6_CONTEXT_SUSPENSION_RESTART_REQUIRED');
  expect(()=>b.contextStateChanged('running')).toThrow('XC6_CONTEXT_SUSPENSION_RESTART_REQUIRED');
});
it('score-shaped fields are rejected at the capture boundary',async()=>{
  const {value:b}=await bridge();
  expect(()=>b.ingest({...packet(0,128,0),expectedPitch:60}as Xc6CaptureMessage)).toThrow('XC4_ACOUSTIC_FIELD_VIOLATION');
  expect(()=>b.schedulePerformanceStart({sourceSampleIndex:0,beatTarget:1}as{sourceSampleIndex:number})).toThrow('XC4_ACOUSTIC_FIELD_VIOLATION');
});
it('capability remains unavailable and acoustic source imports no backend/scorer/score-following runtime',async()=>{
  expect(evaluatePracticeInputCapabilities().acousticAnalysis.continuous.status).toBe('MODEL_NOT_VALIDATED');
  const source=await readFile('src/lib/practice/acoustic-inference/xc6-capture-bridge.ts','utf8');
  expect(source).not.toMatch(/fetch\(|WebSocket|ContinuousEvaluationSession|xc2_r2_direct_conflict_finalizer/);
  expect(XC4.automaticFallback).toBe(false);expect(XC4.provider).toBe('webgpu');
});
