import { collectWebGpuAdapter } from './xc1_browser_runtime_shared.mjs';
import { ROBUST_DECODER_IDENTITY } from './xc1_robust_decoder.mjs';

export const XC1_ROBUST_EXECUTOR_SCHEMA_VERSION = 1;
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
    const durationMs = pcm.sampleCount / acousticInput.sampleRateHz * 1000;
    const windows = planOwnedWindows({
      durationMs,
      scoreableStartMs: acousticInput.scoreableInterval.startMs,
      scoreableEndMs: acousticInput.scoreableInterval.endMs,
      ownedMs: 600,
      pastMs: 1000,
      futureMs: 220,
      sampleRateHz: acousticInput.sampleRateHz,
      inputSamples: decoder.inputSamples,
    });
    const outputNames = [];
    const timings = [];
    const observations = [];
    for (const window of windows) {
      const feeds = {
        [session.inputNames[0]]: new ort.Tensor('float32', robustWindowFromPcm(pcm.samples, window), [1, decoder.inputSamples]),
      };
      const runStarted = performance.now();
      const outputs = await session.run(feeds);
      const runFinished = performance.now();
      if (outputNames.length === 0) outputNames.push(...Object.keys(outputs));
      const reg = outputs.reg_onset_output ?? outputs[Object.keys(outputs)[0]];
      const frame = outputs.frame_output ?? outputs[Object.keys(outputs)[1]];
      const decoded = decodeRobustOutputs(reg, frame, decoder, window);
      const owned = decoded.filter((event) => event.performanceTimeMs >= window.ownedStartMs && event.performanceTimeMs < window.ownedEndMs);
      observations.push(...owned);
      timings.push({
        windowId: window.windowId,
        inputWindowStartMs: window.inputWindowStartMs,
        ownedStartMs: window.ownedStartMs,
        ownedEndMs: window.ownedEndMs,
        processingMs: runFinished - runStarted,
        decodedCount: decoded.length,
        publishedCount: owned.length,
      });
    }
    const processingMs = timings.reduce((sum, timing) => sum + timing.processingMs, 0);
    function robustWindowFromPcm(samples, window) {
      if (window.endSample > samples.length) throw new Error('XC1_ROBUST_WINDOW_REQUIRES_REAL_CONTEXT');
      const output = new Float32Array(decoder.inputSamples);
      output.set(samples.subarray(window.startSample, window.endSample));
      return output;
    }
    function planOwnedWindows({ durationMs, scoreableStartMs, scoreableEndMs, ownedMs, pastMs, futureMs, sampleRateHz, inputSamples }) {
      const windows = [];
      for (let ownedStartMs = scoreableStartMs; ownedStartMs < scoreableEndMs; ownedStartMs += ownedMs) {
        const ownedEndMs = Math.min(ownedStartMs + ownedMs, scoreableEndMs);
        const inputWindowStartMs = ownedStartMs - pastMs;
        const inputWindowEndMs = ownedStartMs + ownedMs + futureMs;
        if (inputWindowStartMs < 0 || inputWindowEndMs > durationMs + 1e-6) continue;
        const startSample = Math.round(inputWindowStartMs * sampleRateHz / 1000);
        windows.push({
          windowId: 'owned_' + Math.round(ownedStartMs),
          ownedStartMs,
          ownedEndMs,
          inputWindowStartMs,
          inputWindowEndMs,
          startSample,
          endSample: startSample + inputSamples,
        });
      }
      return windows;
    }
    function decodeRobustOutputs(reg, frame, decoderSpec, window) {
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
            const sampleOffset = Math.round(peakFrame / decoderSpec.outputFrameRateHz * acousticInput.sampleRateHz);
            out.push({
              pitch: 21 + pitchIndex,
              performanceTimeMs: window.inputWindowStartMs + sampleOffset / acousticInput.sampleRateHz * 1000,
              confidence: Math.min(peakScore, frameScore),
              candidateObservationId: `robust-browser-v1:${acousticInput.takeId}:${window.windowId}:${21 + pitchIndex}:${sampleOffset}:${out.length}`,
              peakFrame,
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
      windowCount: windows.length,
      sessionLoadCount: 1,
      actualInferenceSessionRunCount: windows.length,
      perWindowTimings: timings,
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
