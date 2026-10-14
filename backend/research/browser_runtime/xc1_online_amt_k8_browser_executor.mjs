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
    const session = await ort.InferenceSession.create('/online-k8.onnx', {
      executionProviders: ['webgpu'],
      graphOptimizationLevel: 'disabled',
    });
    const modelLoadMs = performance.now() - loadStarted;
    const feedSpecs = {
      audio_last_2048_sequence: { type: 'float32', length: 8 * 1 * 2048, dims: [8, 1, 2048] },
      mel_buffer_in: { type: 'float32', length: 1 * 229 * 7, dims: [1, 229, 7] },
      cache0_in: { type: 'float32', length: 1 * 64 * 5 * 229, dims: [1, 64, 5, 229] },
      cache1_in: { type: 'float32', length: 1 * 64 * 3 * 114, dims: [1, 64, 3, 114] },
      h_in: { type: 'float32', length: 2 * 1 * 512, dims: [2, 1, 512] },
      c_in: { type: 'float32', length: 2 * 1 * 512, dims: [2, 1, 512] },
      prev_output_in: { type: 'int64', length: 1 * 1 * 88, dims: [1, 1, 88] },
    };
    const audioSequence = new Float32Array(feedSpecs.audio_last_2048_sequence.length);
    for (let hop = 0; hop < 8; hop += 1) {
      const end = (hop + 1) * 512;
      const start = end - 2048;
      for (let i = 0; i < 2048; i += 1) {
        const sourceIndex = start + i;
        audioSequence[hop * 2048 + i] = sourceIndex >= 0 ? (pcm.samples[sourceIndex] ?? 0) : 0;
      }
    }
    const feeds = {
      audio_last_2048_sequence: new ort.Tensor('float32', audioSequence, feedSpecs.audio_last_2048_sequence.dims),
      mel_buffer_in: new ort.Tensor('float32', new Float32Array(feedSpecs.mel_buffer_in.length), feedSpecs.mel_buffer_in.dims),
      cache0_in: new ort.Tensor('float32', new Float32Array(feedSpecs.cache0_in.length), feedSpecs.cache0_in.dims),
      cache1_in: new ort.Tensor('float32', new Float32Array(feedSpecs.cache1_in.length), feedSpecs.cache1_in.dims),
      h_in: new ort.Tensor('float32', new Float32Array(feedSpecs.h_in.length), feedSpecs.h_in.dims),
      c_in: new ort.Tensor('float32', new Float32Array(feedSpecs.c_in.length), feedSpecs.c_in.dims),
      prev_output_in: new ort.Tensor('int64', new BigInt64Array(feedSpecs.prev_output_in.length), feedSpecs.prev_output_in.dims),
    };
    const runStarted = performance.now();
    const outputs = await session.run(feeds);
    const processingMs = performance.now() - runStarted;
    const chosen = outputs.chosen_state_sequence;
    const chosenRows = [];
    if (chosen?.data) {
      const data = Array.from(chosen.data, (value) => Number(value));
      const pitchCount = chosen.dims?.[chosen.dims.length - 1] ?? 88;
      const hopCount = Math.floor(data.length / pitchCount);
      for (let hop = 0; hop < hopCount; hop += 1) {
        chosenRows.push(data.slice(hop * pitchCount, (hop + 1) * pitchCount));
      }
    }
    const observations = [];
    for (let hop = 0; hop < chosenRows.length; hop += 1) {
      for (let pitchIndex = 0; pitchIndex < chosenRows[hop].length; pitchIndex += 1) {
        if (chosenRows[hop][pitchIndex] > 0) {
          observations.push({
            pitch: 21 + pitchIndex,
            performanceTimeMs: hop * projection.hopSamples / 16 + projection.timingCorrectionMs,
            confidence: 1,
            candidateObservationId: `online-amt-k8-browser-v1:${acousticInput.takeId}:group0:${hop}:${21 + pitchIndex}:${pitchIndex}`,
          });
        }
      }
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
      actualInferenceSessionRunCount: 1,
      inputNames: session.inputNames,
      outputNames: Object.keys(outputs),
      publicationProjectionInvoked: true,
      publicationProjectionIdentity: projection,
      chosenStateHopCount: chosenRows.length,
      acousticObservations: observations,
    };
  }, { projection: ONLINE_AMT_PUBLICATION_IDENTITY, acousticInput: request.acousticInput }).then((result) => ({
    ...result,
    webgpuAdapter,
  }));
}
