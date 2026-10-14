import { collectWebGpuAdapter } from './xc1_browser_runtime_shared.mjs';

export const XC1_ROBUST_EXECUTOR_SCHEMA_VERSION = 1;
export const ROBUST_DECODER_IDENTITY = Object.freeze({
  decoderId: 'noteverse-bytedance-contiguous-region-peak-decoder-v1',
  onsetThreshold: 0.30,
  frameThreshold: 0.05,
  inputSamples: 29120,
  ownershipFiltering: 'half-open-600ms-region',
});

export async function executeRobustBrowserExecutor(page, request = {}) {
  const webgpuAdapter = await collectWebGpuAdapter(page);
  return page.evaluate(async ({ decoder, acousticInput }) => {
    const pcm = await window.loadXc1ExternalPcm();
    if (pcm.sha256 !== acousticInput.pcmSha256 || pcm.byteLength !== acousticInput.byteSize || pcm.sampleCount !== acousticInput.sampleCount) {
      throw new Error('XC1_BROWSER_PCM_IDENTITY_MISMATCH');
    }
    ort.env.wasm.wasmPaths = '/ort/';
    const loadStarted = performance.now();
    const session = await ort.InferenceSession.create('/robust.onnx', {
      executionProviders: ['webgpu'],
      graphOptimizationLevel: 'disabled',
    });
    const modelLoadMs = performance.now() - loadStarted;
    const feeds = {
      [session.inputNames[0]]: new ort.Tensor('float32', robustWindowFromPcm(pcm.samples), [1, 29120]),
    };
    const runStarted = performance.now();
    const outputs = await session.run(feeds);
    const processingMs = performance.now() - runStarted;
    const outputNames = Object.keys(outputs);
    const reg = outputs.reg_onset_output ?? outputs[outputNames[0]];
    const frame = outputs.frame_output ?? outputs[outputNames[1]];
    const observations = decodeRobustOutputs(reg, frame, decoder);
    function robustWindowFromPcm(samples) {
      const output = new Float32Array(decoder.inputSamples);
      const copyCount = Math.min(samples.length, output.length);
      output.set(samples.subarray(0, copyCount));
      return output;
    }
    function decodeRobustOutputs(reg, frame, decoderSpec) {
      const out = [];
      const regData = reg?.data ?? [];
      const frameData = frame?.data ?? [];
      const dims = reg?.dims ?? [];
      const frameCount = dims.length >= 3 ? dims[dims.length - 2] : 0;
      const pitchCount = dims.length >= 3 ? dims[dims.length - 1] : 88;
      for (let pitchIndex = 0; pitchIndex < pitchCount; pitchIndex += 1) {
        let frameIndex = 0;
        while (frameIndex < frameCount) {
          while (frameIndex < frameCount && Number(regData[frameIndex * pitchCount + pitchIndex] ?? 0) < decoderSpec.onsetThreshold) {
            frameIndex += 1;
          }
          if (frameIndex >= frameCount) break;
          let peakFrame = frameIndex;
          let peakScore = Number(regData[frameIndex * pitchCount + pitchIndex] ?? 0);
          while (frameIndex + 1 < frameCount && Number(regData[(frameIndex + 1) * pitchCount + pitchIndex] ?? 0) >= decoderSpec.onsetThreshold) {
            frameIndex += 1;
            const score = Number(regData[frameIndex * pitchCount + pitchIndex] ?? 0);
            if (score > peakScore) {
              peakScore = score;
              peakFrame = frameIndex;
            }
          }
          const frameScore = Number(frameData[peakFrame * pitchCount + pitchIndex] ?? 0);
          if (frameScore >= decoderSpec.frameThreshold) {
            out.push({
              pitch: 21 + pitchIndex,
              performanceTimeMs: peakFrame * (600 / Math.max(1, frameCount)),
              confidence: Math.min(peakScore, frameScore),
              candidateObservationId: `robust-browser-v1:${acousticInput.takeId}:window0:${21 + pitchIndex}:${peakFrame}:${out.length}`,
            });
          }
          frameIndex += 1;
        }
      }
      return out.sort((left, right) => left.performanceTimeMs - right.performanceTimeMs || left.pitch - right.pitch);
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
      outputNames,
      decoderInvoked: true,
      decoderIdentity: decoder,
      acousticObservations: observations,
    };
  }, { decoder: ROBUST_DECODER_IDENTITY, acousticInput: request.acousticInput }).then((result) => ({
    ...result,
    webgpuAdapter,
  }));
}
