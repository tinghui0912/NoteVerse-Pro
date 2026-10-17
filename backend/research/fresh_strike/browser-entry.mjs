// Isolated research executor. This is never imported by application code.
import * as ort from 'onnxruntime-web/webgpu';
import { QualifiedSourceAdapter } from '../../../apps/customer-web/src/lib/practice/acoustic/source/source-adapter.ts';
import { decodeRobustPiano } from '../../../apps/customer-web/src/lib/practice/acoustic/model/robust-piano-decoder.ts';
import { ACOUSTIC_MODEL as M, sha256, assertAcousticIdentity } from '../../../apps/customer-web/src/lib/practice/acoustic/model/model-contract.ts';
import { rawEvidence, groupEvidence, DEFINITIONS } from './detectors.mjs';

window.executeAudioOnly = async function(jobs) {
  await assertAcousticIdentity();
  if (!navigator.gpu || ort.env.versions.web !== '1.20.1') throw Error('WEBGPU_ORT_REQUIRED');
  const model = new Uint8Array(await (await fetch('/model.onnx')).arrayBuffer());
  if (model.length !== M.modelBytes || await sha256(model) !== M.modelSha256) throw Error('WRONG_MODEL');
  const session = await ort.InferenceSession.create(model,{executionProviders:['webgpu'],graphOptimizationLevel:'disabled'});
  const info = await (await navigator.gpu.requestAdapter())?.info;
  const results=[]; let runs=0;
  try {
    if (JSON.stringify(session.inputNames)!=='["audio"]' || !['reg_onset_output','frame_output'].every(x=>session.outputNames.includes(x))) throw Error('DESCRIPTOR');
    for (const job of jobs) {
      const source = new Uint8Array(await (await fetch(`/pcm/${job.id}/${job.rate}`)).arrayBuffer());
      if (await sha256(source)!==job.sha256 || source.length!==job.bytes) throw Error('PCM_IDENTITY');
      const fir = new Uint8Array(await (await fetch(`/fir/${job.rate}`)).arrayBuffer());
      const adapter=await QualifiedSourceAdapter.create(job.rate,fir);
      const pcm=new Float32Array(source.buffer), chunks=[];
      for(let offset=0;offset<pcm.length;offset+=683) chunks.push(adapter.push(pcm.subarray(offset,offset+683)));
      const target=new Float32Array(chunks.reduce((n,c)=>n+c.length,0));let position=0;
      for(const chunk of chunks){target.set(chunk,position);position+=chunk.length;}
      const evidence={decoded:[],rise:[],support:[]}, windows=[];
      for(let ownedStart=job.ownedStartTarget;ownedStart<job.ownedStartTarget+job.ownedSamples;ownedStart+=9600){
        const w={start:ownedStart-16800,end:ownedStart+9600+2720,ownedStart,ownedEnd:ownedStart+9600};
        if(w.start<10 || w.end>target.length || w.end-w.start!==29120) throw Error('REAL_CONTEXT_REQUIRED');
        const audio=new ort.Tensor('float32',target.slice(w.start,w.end),[1,29120]);let tensors;
        try {
          runs++;tensors=await session.run({audio},['reg_onset_output','frame_output']);
          for(const t of Object.values(tensors)) if(t.type!=='float32' || JSON.stringify(t.dims)!=='[1,183,88]' || !(t.data instanceof Float32Array)) throw Error('RAW_DESCRIPTOR');
          const onset=tensors.reg_onset_output.data,frame=tensors.frame_output.data;
          const raw={reg_onset_output:onset,frame_output:frame,reg_onset_shape:[1,183,88],frame_shape:[1,183,88]};
          evidence.decoded.push(...decodeRobustPiano(raw,w.start,{onsetThreshold:.30,frameThreshold:.05})
            .filter(e=>e.targetSample>=w.ownedStart && e.targetSample<w.ownedEnd).map(e=>({anchor:e.targetSample,available:w.end})));
          for(const name of ['rise','support']) evidence[name].push(...rawEvidence(onset,frame,w,DEFINITIONS[name]));
          windows.push({...w,inputSha256:await sha256(new Uint8Array(target.slice(w.start,w.end).buffer)),
            onsetSha256:await sha256(new Uint8Array(onset.buffer,onset.byteOffset,onset.byteLength)),
            frameSha256:await sha256(new Uint8Array(frame.buffer,frame.byteOffset,frame.byteLength))});
        } finally {audio.dispose();for(const t of Object.values(tensors??{}))t.dispose();}
      }
      const outputs={};
      for(const [name,items] of Object.entries(evidence)) {
        outputs[name]=groupEvidence(items,16000,job.sourceDomainId,name).map(token=>({...token,
          sourceAnchorSample:job.sourceOriginSample+token.sourceAnchorSample*job.rate/16000,
          evidenceAvailableThroughSourceSample:job.sourceOriginSample+Math.ceil(token.evidenceAvailableThroughSourceSample*job.rate/16000)+(job.rate===44100?28:30)}));
      }
      results.push({id:job.id,rate:job.rate,outputs,windows,sourceAdapterIdentity:adapter.identitySha256,
        targetSha256:await sha256(new Uint8Array(target.buffer)),targetSamples:target.length,
        baselinePcm:Array.from(target)});
    }
    return {results,actualSessionRunCount:runs,ort:ort.env.versions.web,provider:'webgpu',automaticFallback:false,
      modelBytes:model.length,modelSha256:M.modelSha256,gpu:info?{vendor:info.vendor,architecture:info.architecture,device:info.device,description:info.description}:null};
  } catch(error) {throw Error(`RESEARCH_EXECUTION_FAILED actualSessionRunCount=${runs} ${error.stack??error}`);}
  finally {await session.release();}
};
