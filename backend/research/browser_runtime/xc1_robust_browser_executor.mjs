import { collectWebGpuAdapter } from './xc1_browser_runtime_shared.mjs';

export const XC1_ROBUST_EXECUTOR_SCHEMA_VERSION = 1;
export const ROBUST_DECODER_IDENTITY = Object.freeze({
  decoderId: 'noteverse-bytedance-contiguous-region-peak-decoder-v1',
  onsetThreshold: 0.30,
  frameThreshold: 0.05,
  ownershipFiltering: 'half-open-600ms-region',
});

export async function executeRobustBrowserExecutor(page) {
  const webgpuAdapter = await collectWebGpuAdapter(page);
  return page.evaluate(async ({ decoder }) => {
    ort.env.wasm.wasmPaths = '/ort/';
    const loadStarted = performance.now();
    const session = await ort.InferenceSession.create('/robust.onnx', {
      executionProviders: ['webgpu'],
      graphOptimizationLevel: 'disabled',
    });
    const modelLoadMs = performance.now() - loadStarted;
    const feeds = {
      [session.inputNames[0]]: new ort.Tensor('float32', new Float32Array(29120), [1, 29120]),
    };
    const runStarted = performance.now();
    const outputs = await session.run(feeds);
    const processingMs = performance.now() - runStarted;
    const outputNames = Object.keys(outputs);
    const observations = [];
    const reg = outputs.reg_onset_output ?? outputs[outputNames[0]];
    const frame = outputs.frame_output ?? outputs[outputNames[1]];
    const regData = reg?.data ?? [];
    const frameData = frame?.data ?? [];
    const dims = reg?.dims ?? [];
    const frameCount = dims.length >= 3 ? dims[dims.length - 2] : 0;
    const pitchCount = dims.length >= 3 ? dims[dims.length - 1] : 88;
    // Score-blind smoke projection: invoke the frozen threshold decoder over the
    // model tensors. Synthetic silence will usually produce zero observations.
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      for (let pitchIndex = 0; pitchIndex < pitchCount; pitchIndex += 1) {
        const offset = frameIndex * pitchCount + pitchIndex;
        const onset = Number(regData[offset] ?? 0);
        const support = Number(frameData[offset] ?? 0);
        if (onset >= decoder.onsetThreshold && support >= decoder.frameThreshold) {
          observations.push({
            pitch: 21 + pitchIndex,
            performanceTimeMs: frameIndex * (600 / Math.max(1, frameCount)),
            confidence: onset,
            candidateObservationId: `robust-browser-v1:acceptance:${frameIndex}:${pitchIndex}`,
          });
        }
      }
    }
    return {
      backend: 'webgpu',
      modelLoadMs,
      processingMs,
      actualInferenceSessionRunCount: 1,
      inputNames: session.inputNames,
      outputNames,
      decoderInvoked: true,
      decoderIdentity: decoder,
      acousticObservations: observations,
    };
  }, { decoder: ROBUST_DECODER_IDENTITY }).then((result) => ({
    ...result,
    webgpuAdapter,
  }));
}
