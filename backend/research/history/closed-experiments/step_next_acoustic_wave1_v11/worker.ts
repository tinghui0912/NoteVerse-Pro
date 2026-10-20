import * as ort from 'onnxruntime-web/webgpu';
import {decodeRobustPiano} from '../../../apps/customer-web/src/lib/practice/acoustic/model/robust-piano-decoder';
import {upstreamOnsetProjection} from '../browser_runtime/xc2_decoders.mjs';
const profiles={ROBUST_RAW:{sha:'4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3',bytes:98689283,onset:.30,frame:.05},
 BYTEDANCE_ORIGINAL_FIXED1820:{sha:'6ba3bc4e73607f9cd021e69858fd3ff969a3941c7a93876d5be5cedb53038cf5',bytes:98691493,onset:.20,frame:.10}};
let session:ort.InferenceSession|null=null,profile:any=null,runs=0,loads=0,busy=false,failed=false;
const sha=async(b:Uint8Array)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(b)))].map(v=>v.toString(16).padStart(2,'0')).join('');
const data=(t:any)=>{if(t.type!=='float32'||t.dims.join()!=='1,183,88'||!(t.data instanceof Float32Array)||t.data.some((v:number)=>!Number.isFinite(v)))throw Error('RAW_OUTPUT_SHAPE_OR_VALUES');return t.data as Float32Array;};
self.onmessage=async(e:MessageEvent)=>{
 const m=e.data;let tensors:any,input:ort.Tensor|undefined;
 try{
  if(busy||failed)throw Error('MODEL_OWNER_FAILED_OR_BUSY');busy=true;
  if(m.type==='LOAD'){
   if(session||loads||!(m.model in profiles)||ort.env.versions.web!=='1.20.1'||!navigator.gpu)throw Error('MODEL_SESSION_OWNERSHIP_OR_RUNTIME');
   profile=profiles[m.model as keyof typeof profiles];const bytes=new Uint8Array(await(await fetch('/model.onnx')).arrayBuffer());
   if(bytes.length!==profile.bytes||await sha(bytes)!==profile.sha)throw Error('MODEL_BYTES_MISMATCH');
   session=await ort.InferenceSession.create(bytes,{executionProviders:['webgpu'],graphOptimizationLevel:'disabled'});loads++;
   if(!session.inputNames.includes('audio')||!['reg_onset_output','frame_output'].every(n=>session!.outputNames.includes(n)))throw Error('MODEL_IO_NAMES');
   self.postMessage({id:m.id,result:{model:m.model,sha256:profile.sha,bytes:bytes.length,loads,ORT:ort.env.versions.web,provider:'webgpu',automaticFallback:false,graphOptimization:'disabled'}});
  }else if(m.type==='INFER'){
   if(!session||m.index!==runs||!(m.pcm instanceof Float32Array)||m.pcm.length!==29120)throw Error('INFERENCE_OWNERSHIP_OR_INPUT');
   const start=performance.now();input=new ort.Tensor('float32',m.pcm,[1,29120]);runs++;
   tensors=await session.run({audio:input},['reg_onset_output','frame_output']);const end=performance.now();
   const onset=data(tensors.reg_onset_output),frame=data(tensors.frame_output);
   const raw=new Float32Array(onset.length+frame.length);raw.set(onset);raw.set(frame,onset.length);
   const rawSha256=await sha(new Uint8Array(raw.buffer));
   const a=decodeRobustPiano({reg_onset_output:onset,reg_onset_shape:[1,183,88],frame_output:frame,frame_shape:[1,183,88]},m.window.startSample,
     {onsetThreshold:profile.onset,frameThreshold:profile.frame});
   const b=m.model==='ROBUST_RAW'?upstreamOnsetProjection({regData:onset,frameData:frame,dims:[1,183,88],inputWindowStartMs:m.window.startSample/16,takeId:m.domain,windowId:String(m.window.windowIndex)}):null;
   self.postMessage({id:m.id,result:{index:m.index,actualSessionRunCount:runs,events:a,decoderB:b,rawSha256,raw,
     inferenceMs:end-start,decodeAndHashMs:performance.now()-end,sharedRawForAB:m.model==='ROBUST_RAW'}},[raw.buffer]);
  }else if(m.type==='DISPOSE'){
   await session?.release();session=null;self.postMessage({id:m.id,result:{runs,loads}});
  }else throw Error('UNKNOWN_WORKER_MESSAGE');
 }catch(error){failed=true;self.postMessage({id:m.id,error:String(error)});}
 finally{input?.dispose();for(const t of Object.values(tensors??{}) as any[])t.dispose();busy=false;}
};
