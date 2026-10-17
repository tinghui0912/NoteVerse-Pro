import { AcousticModelWorker } from '../../../apps/customer-web/src/lib/practice/acoustic/model/worker-client';
import { QualifiedSourceAdapter } from '../../../apps/customer-web/src/lib/practice/acoustic/source/source-adapter';
import { ACOUSTIC_MODEL as M, sha256, previousFloat } from '../../../apps/customer-web/src/lib/practice/acoustic/model/model-contract';
import type { DecodedPublication } from './acoustic-gestures';

type Job = { id: string; rate: number; sha256: string; bytes: number; sourceOriginSample: number; ownedStartTarget: number; ownedSamples: number };
declare global { interface Window { runDecodedAudioOnly(jobs: readonly Job[]): Promise<unknown> } }
window.runDecodedAudioOnly = async jobs => {
  const worker = new AcousticModelWorker(new Worker('/worker.js', { type: 'module' }));
  let actualRuns = 0;
  const model = await worker.load('/model.onnx');
  const results = [];
  try {
    for (const [regionIndex, job] of jobs.entries()) {
      const source = new Uint8Array(await (await fetch(`/pcm/${job.id}/${job.rate}`)).arrayBuffer());
      if (source.length !== job.bytes || await sha256(source) !== job.sha256) throw new Error('REPLAY_PCM_IDENTITY');
      const coefficients = new Uint8Array(await (await fetch(`/fir/${job.rate}`)).arrayBuffer());
      const adapter = await QualifiedSourceAdapter.create(job.rate, coefficients);
      const pcm = new Float32Array(source.buffer), chunks: Float32Array[] = [];
      for (let index = 0; index < pcm.length; index += 683) chunks.push(adapter.push(pcm.subarray(index,index+683)));
      const target = new Float32Array(chunks.reduce((n,c)=>n+c.length,0));let offset = 0;
      for (const chunk of chunks) { target.set(chunk,offset);offset+=chunk.length; }
      const originMs = job.sourceOriginSample / job.rate * 1000;
      const publications: DecodedPublication[] = [], windows = [];
      let availableMs = originMs, windowIndex = 0;
      for (let ownedStart = job.ownedStartTarget; ownedStart < job.ownedStartTarget+job.ownedSamples; ownedStart += 9600) {
        const ownedEnd = ownedStart+9600, endSample=ownedEnd+2720, startSample=endSample-29120;
        if (startSample < 10 || endSample > target.length) throw new Error('REPLAY_REAL_CONTEXT');
        const inputPcm = target.slice(startSample,endSample);
        const window = {jobIndex:actualRuns,regionIndex,windowIndex:windowIndex++,ownedStartTarget:ownedStart,ownedEndTarget:ownedEnd,startSample,endSample};
        const started = performance.now(); const result = await worker.run({window,pcm:inputPcm});
        const transactionMs = performance.now()-started;
        actualRuns = result.actualSessionRunCount;
        const realInputReadyMs = originMs+endSample/16+(job.rate===44100?28:30)/job.rate*1000;
        availableMs = Math.max(availableMs,realInputReadyMs)+transactionMs;
        const observations = result.events.filter(e=>e.targetSample>=ownedStart&&e.targetSample<ownedEnd).map((e,index)=>({
          observationId:`${job.id}:${job.rate}:${window.windowIndex}:${index}:${e.targetSample}:${e.midiPitch}`,
          pitch:e.pitch,eventMs:originMs+e.targetSample/16,availabilityMs:availableMs,confidence:e.confidence,sourceDomainId:`${job.id}:${job.rate}`,
          sourceSampleRateHz:job.rate,sourceEventSample:job.sourceOriginSample+e.targetSample*job.rate/16000 }));
        publications.push({publicationId:`${job.id}:${job.rate}:${window.windowIndex}`,frontierMs:previousFloat(originMs+ownedEnd/16),availabilityMs:availableMs,observations});
        windows.push({...window,inputSha256:await sha256(new Uint8Array(inputPcm.buffer)),transactionMs,realInputReadyMs,availableMs});
      }
      publications.push({publicationId:`${job.id}:${job.rate}:terminal`,frontierMs:originMs+(job.ownedStartTarget+job.ownedSamples)/16,availabilityMs:availableMs,observations:[]});
      results.push({id:job.id,rate:job.rate,sourceAdapterIdentity:adapter.identitySha256,
        targetSha256:await sha256(new Uint8Array(target.buffer)),publications,windows});
    }
    return {model,results,actualModelRuns:actualRuns,coreIdentity:M.identitySha256,provider:'webgpu',automaticFallback:false};
  } catch(error) { throw new Error(`AUDIO_ONLY_FAILED actualModelRuns=${actualRuns} ${String(error)}`); }
  finally {await worker.dispose();}
};
