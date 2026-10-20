import * as ort from 'onnxruntime-web/webgpu';
import { INPUT_SAMPLES, encodeLE, decodeLE, sha, pair } from './wire.mjs';

let session = null, loads = 0, runs = 0, attempted = 0, failed = false, busy = false;
self.onmessage = async e => {
  const { id, type, payload } = e.data;
  if (busy || failed) { self.postMessage({ id, error: 'CAPTURE_WORKER_CLOSED_OR_BUSY', loads, runs, attempted }); return; }
  busy = true;
  try {
    if (type === 'LOAD') {
      if (session || loads || ort.env.versions.web !== '1.20.1' || !navigator.gpu) throw Error('PINNED_SINGLE_SESSION_WEBGPU_REQUIRED');
      const data = new Uint8Array(await (await fetch('/model.onnx')).arrayBuffer());
      if (data.length !== 98689283 || await sha(data) !== '4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3') throw Error('MODEL_IDENTITY');
      session = await ort.InferenceSession.create(data, { executionProviders: ['webgpu'], graphOptimizationLevel: 'disabled' }); loads++;
      if (JSON.stringify(session.inputNames) !== '["audio"]' || JSON.stringify([...session.outputNames].sort()) !== '["frame_output","reg_onset_output"]') throw Error('MODEL_NAMES');
      self.postMessage({ id, loads, runs, attempted, provider: 'webgpu', ORT: ort.env.versions.web, automaticFallback: false, graphOptimizationLevel: 'disabled' });
    } else if (type === 'RUN') {
      if (!session || loads !== 1 || payload.runOrdinal !== runs || attempted !== runs || runs >= 228) throw Error('RUN_SEQUENCE');
      const pcm = decodeLE(new Uint8Array(payload.input));
      if (pcm.length !== INPUT_SAMPLES || await sha(encodeLE(pcm)) !== payload.inputSha256) throw Error('MODEL_INPUT_SHA');
      const audio = new ort.Tensor('float32', pcm, [1, INPUT_SAMPLES]); let outputs;
      try {
        attempted++; self.postMessage({ type: 'RUN_STARTED', runOrdinal: payload.runOrdinal, attempted, runs, loads });
        const began = performance.now();
        outputs = await session.run({ audio }, ['reg_onset_output', 'frame_output']);
        const elapsedMs = performance.now() - began;
        if (JSON.stringify(Object.keys(outputs).sort()) !== '["frame_output","reg_onset_output"]') throw Error('OUTPUT_NAMES');
        const raw = pair(outputs.reg_onset_output, outputs.frame_output); runs++;
        self.postMessage({ id, loads, runs, attempted, elapsedMs, raw: raw.buffer }, [raw.buffer]);
      } finally { audio.dispose(); for (const t of Object.values(outputs ?? {})) t.dispose(); }
    } else if (type === 'DISPOSE') {
      if (!session || runs !== 228 || attempted !== runs) throw Error('INCOMPLETE_SESSION');
      await session.release(); session = null; self.postMessage({ id, loads, runs, attempted, disposed: true });
    } else throw Error('CAPTURE_COMMAND_NOT_ALLOWED');
  } catch (error) { failed = true; self.postMessage({ id, error: String(error.stack ?? error), loads, runs, attempted }); }
  finally { busy = false; }
};
