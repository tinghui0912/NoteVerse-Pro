import { collectWebGpuAdapter } from './xc1_browser_runtime_shared.mjs';

export const XC1_ONLINE_AMT_K8_EXECUTOR_SCHEMA_VERSION = 1;
export const ONLINE_AMT_PUBLICATION_IDENTITY = Object.freeze({
  publicationProjectionId: 'online-amt-calibrated-k8-hop-event-projection-v1',
  hopSamples: 512,
  groupHops: 8,
  timingCorrectionMs: -162.93750000004252,
  publishedOnsetBoost: 1,
  pseudoIntensity: 'NATIVE',
});

export async function executeOnlineAmtK8BrowserExecutor(page, request = {}) {
  const webgpuAdapter = await collectWebGpuAdapter(page);
  return page.evaluate(async ({ projection, acousticInput }) => {
    const pcm = await window.loadXc1ExternalPcm();
    if (pcm.sha256 !== acousticInput.pcmSha256 || pcm.byteLength !== acousticInput.byteSize || pcm.sampleCount !== acousticInput.sampleCount) {
      throw new Error('XC1_BROWSER_PCM_IDENTITY_MISMATCH');
    }
    ort.env.wasm.wasmPaths = '/ort/';
    const loadStarted = performance.now();
    const k8Session = await ort.InferenceSession.create('/online-k8.onnx', {
      executionProviders: ['webgpu'],
      graphOptimizationLevel: 'disabled',
    });
    const k1Session = await ort.InferenceSession.create('/online-k1.onnx', {
      executionProviders: ['webgpu'],
      graphOptimizationLevel: 'disabled',
    });
    const modelLoadMs = performance.now() - loadStarted;
    const state = {
      audio: new Float32Array(2048),
      mel: new Float32Array(1 * 229 * 7),
      cache0: new Float32Array(1 * 64 * 5 * 229),
      cache1: new Float32Array(1 * 64 * 3 * 114),
      h: new Float32Array(2 * 1 * 512),
      c: new Float32Array(2 * 1 * 512),
      prev: new Int32Array(88),
      numUnderThr: 0,
    };
    const totalHops = Math.floor(pcm.sampleCount / projection.hopSamples);
    const hopRows = [];
    const groupRows = [];
    let processingMs = 0;
    let sessionRunCount = 0;
    for (let startHop = 0; startHop < totalHops;) {
      const remaining = totalHops - startHop;
      const requested = remaining >= projection.groupHops ? projection.groupHops : remaining;
      const groupPcm = pcm.samples.subarray(startHop * projection.hopSamples, (startHop + requested) * projection.hopSamples);
      const started = performance.now();
      const result = await runModelGroup(requested, groupPcm, startHop);
      const finished = performance.now();
      processingMs += finished - started;
      sessionRunCount += result.ortRunCount;
      groupRows.push({
        startHopIndex: startHop,
        hopCountInMessage: requested,
        k: result.k,
        processingMs: finished - started,
        usedK1Fallback: result.usedK1Fallback,
      });
      hopRows.push(...result.hops);
      startHop += requested;
    }
    const observations = [];
    for (const row of hopRows) {
      const eventTimeMs = (row.hopIndex + 1) * projection.hopSamples / acousticInput.sampleRateHz * 1000 + projection.timingCorrectionMs;
      if (eventTimeMs < acousticInput.scoreableInterval.startMs || eventTimeMs >= acousticInput.scoreableInterval.endMs) continue;
      for (let pitchIndex = 0; pitchIndex < 88; pitchIndex += 1) {
        const chosenState = row.chosenStates[pitchIndex];
        if (chosenState === 3 || chosenState === 4) {
          const probBase = pitchIndex * 5;
          observations.push({
            pitch: 21 + pitchIndex,
            performanceTimeMs: eventTimeMs,
            confidence: row.probabilities[probBase + 3] + row.probabilities[probBase + 4],
            candidateObservationId: `online-amt-k8-browser-v1:${acousticInput.takeId}:hop${row.hopIndex}:${21 + pitchIndex}:${pitchIndex}`,
          });
        }
      }
    }
    async function runModelGroup(hopCountInMessage, groupPcm, startHopIndex) {
      const probe = cloneState(state);
      const windows = [];
      let active = hopCountInMessage === projection.groupHops;
      for (let offset = 0; offset < hopCountInMessage; offset += 1) {
        const hop = groupPcm.subarray(offset * 512, (offset + 1) * 512);
        updateAudioBuffer(probe.audio, hop);
        if (pseudoIntensity(probe.audio) < 0.05) probe.numUnderThr += 1;
        else probe.numUnderThr = 0;
        windows.push(probe.audio.slice(probe.audio.length - 2048));
        if (probe.numUnderThr > 100) active = false;
      }
      if (!active) {
        return runSequentialFallback(hopCountInMessage, groupPcm, startHopIndex);
      }
      const output = await k8Session.run({
        audio_last_2048_sequence: new ort.Tensor('float32', concatFloat(windows), [projection.groupHops, 1, 2048]),
        mel_buffer_in: new ort.Tensor('float32', state.mel, [1, 229, 7]),
        cache0_in: new ort.Tensor('float32', state.cache0, [1, 64, 5, 229]),
        cache1_in: new ort.Tensor('float32', state.cache1, [1, 64, 3, 114]),
        h_in: new ort.Tensor('float32', state.h, [2, 1, 512]),
        c_in: new ort.Tensor('float32', state.c, [2, 1, 512]),
        prev_output_in: new ort.Tensor('int64', toBigInt64(state.prev), [1, 1, 88]),
      });
      state.audio = probe.audio;
      state.numUnderThr = probe.numUnderThr;
      commitNeuralState(output);
      const probabilities = Array.from(output.probabilities_sequence.data, Number);
      const chosenStates = Array.from(output.chosen_state_sequence.data, Number);
      state.prev = Int32Array.from(chosenStates.slice((projection.groupHops - 1) * 88, projection.groupHops * 88));
      return {
        k: projection.groupHops,
        usedK1Fallback: false,
        ortRunCount: 1,
        hops: rowsFromFlat(startHopIndex, projection.groupHops, probabilities, chosenStates),
      };
    }
    async function runSequentialFallback(hopCountInMessage, groupPcm, startHopIndex) {
      const hops = [];
      let ortRunCount = 0;
      for (let offset = 0; offset < hopCountInMessage; offset += 1) {
        const hop = groupPcm.subarray(offset * 512, (offset + 1) * 512);
        updateAudioBuffer(state.audio, hop);
        if (pseudoIntensity(state.audio) < 0.05) state.numUnderThr += 1;
        else state.numUnderThr = 0;
        if (state.numUnderThr > 100) {
          hops.push({ hopIndex: startHopIndex + offset, probabilities: silentProbabilities(), chosenStates: new Array(88).fill(0) });
          continue;
        }
        const output = await k1Session.run({
          audio_last_2048_sequence: new ort.Tensor('float32', state.audio.slice(state.audio.length - 2048), [1, 1, 2048]),
          mel_buffer_in: new ort.Tensor('float32', state.mel, [1, 229, 7]),
          cache0_in: new ort.Tensor('float32', state.cache0, [1, 64, 5, 229]),
          cache1_in: new ort.Tensor('float32', state.cache1, [1, 64, 3, 114]),
          h_in: new ort.Tensor('float32', state.h, [2, 1, 512]),
          c_in: new ort.Tensor('float32', state.c, [2, 1, 512]),
          prev_output_in: new ort.Tensor('int64', toBigInt64(state.prev), [1, 1, 88]),
        });
        ortRunCount += 1;
        commitNeuralState(output);
        const probabilities = Array.from(output.probabilities_sequence.data, Number);
        const chosenStates = Array.from(output.chosen_state_sequence.data, Number);
        state.prev = Int32Array.from(chosenStates);
        hops.push({ hopIndex: startHopIndex + offset, probabilities, chosenStates });
      }
      return { k: 1, usedK1Fallback: true, ortRunCount, hops };
    }
    function commitNeuralState(output) {
      state.mel = new Float32Array(output.mel_buffer_out.data);
      state.cache0 = new Float32Array(output.cache0_out.data);
      state.cache1 = new Float32Array(output.cache1_out.data);
      state.h = new Float32Array(output.h_out.data);
      state.c = new Float32Array(output.c_out.data);
    }
    function rowsFromFlat(startHopIndex, hopCount, probabilities, chosenStates) {
      const rows = [];
      for (let hop = 0; hop < hopCount; hop += 1) {
        rows.push({
          hopIndex: startHopIndex + hop,
          probabilities: probabilities.slice(hop * 88 * 5, (hop + 1) * 88 * 5),
          chosenStates: chosenStates.slice(hop * 88, (hop + 1) * 88),
        });
      }
      return rows;
    }
    function silentProbabilities() {
      const probs = [];
      for (let pitch = 0; pitch < 88; pitch += 1) probs.push(1, 0, 0, 0, 0);
      return probs;
    }
    function cloneState(source) {
      return {
        audio: new Float32Array(source.audio),
        numUnderThr: source.numUnderThr,
      };
    }
    function concatFloat(chunks) {
      const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const out = new Float32Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.length;
      }
      return out;
    }
    function toBigInt64(values) {
      const out = new BigInt64Array(values.length);
      for (let index = 0; index < values.length; index += 1) out[index] = BigInt(values[index] ?? 0);
      return out;
    }
    function updateAudioBuffer(audio, hop) {
      audio.copyWithin(0, hop.length);
      audio.set(hop, audio.length - hop.length);
    }
    function pseudoIntensity(audio) {
      let sum = 0;
      for (let index = 0; index < audio.length; index += 1) sum += Math.abs(audio[index]);
      return sum / audio.length;
    }
    return {
      backend: 'webgpu',
      browserReceivedPcm: {
        sha256: pcm.sha256,
        byteLength: pcm.byteLength,
        sampleCount: pcm.sampleCount,
      },
      modelLoadMs,
      processingMs,
      sessionLoadCount: 2,
      actualInferenceSessionRunCount: sessionRunCount,
      totalHopCount: totalHops,
      groupRows,
      inputNames: k8Session.inputNames,
      outputNames: k8Session.outputNames,
      publicationProjectionInvoked: true,
      publicationProjectionIdentity: projection,
      chosenStateHopCount: hopRows.length,
      acousticObservations: observations,
    };
  }, { projection: ONLINE_AMT_PUBLICATION_IDENTITY, acousticInput: request.acousticInput }).then((result) => ({
    ...result,
    webgpuAdapter,
  }));
}
