import { collectWebGpuAdapter } from './xc1_browser_runtime_shared.mjs';
import { ROBUST_DECODER_IDENTITY } from './xc1_robust_decoder.mjs';

export async function executeRobustBrowserExecutor(page, request = {}) {
  const webgpuAdapter = await collectWebGpuAdapter(page);
  await page.waitForFunction(() => window.xc1Semantics);
  const result = await page.evaluate(async ({ decoder, acousticInput, runtimeMode }) => {
    const pcm = await window.loadXc1ExternalPcm();
    if (pcm.sha256 !== acousticInput.pcmSha256) throw new Error('XC1_BROWSER_PCM_IDENTITY_MISMATCH');
    ort.env.wasm.wasmPaths = '/ort/';
    const loadStarted = performance.now();
    const session = await ort.InferenceSession.create('/robust.onnx', {
      executionProviders: ['webgpu'], graphOptimizationLevel: 'disabled',
    });
    const modelLoadMs = performance.now() - loadStarted;
    const semantics = window.xc1Semantics;
    const windows = semantics.planOwnedWindows({ durationMs: pcm.sampleCount / 16,
      scoreableStartMs: acousticInput.scoreableInterval.startMs,
      scoreableEndMs: acousticInput.scoreableInterval.endMs });
    const observations = [];
    let runCount = 0;
    const schedule = await semantics.executeSchedule(windows.map(spec => ({ ...spec, readyMs: spec.inputWindowEndMs })), async (spec, warmup) => {
      const samples = pcm.samples.slice(spec.startSample, spec.endSample);
      if (samples.length !== 29120) throw new Error('XC1_ROBUST_REAL_CONTEXT_REQUIRED');
      const feeds = { [session.inputNames[0]]: new ort.Tensor('float32', samples, [1, 29120]) };
      const start = performance.timeOrigin + performance.now();
      const outputs = await session.run(feeds);
      const finish = performance.timeOrigin + performance.now();
      runCount += 1;
      const reg = outputs.reg_onset_output, frame = outputs.frame_output;
      if (!reg || !frame) throw new Error('XC1_ROBUST_OUTPUT_CONTRACT_MISMATCH');
      const decoded = semantics.decodeRobustRawOutputs({ regData: reg.data, frameData: frame.data,
        dims: reg.dims, inputWindowStartMs: spec.inputWindowStartMs, takeId: acousticInput.takeId,
        windowId: spec.windowId, decoder });
      const owned = semantics.filterOwnedObservations(decoded, spec.ownedStartMs, spec.ownedEndMs);
      if (!warmup) observations.push(...owned);
      return { timing: { ortSessionRunStartTimestamp: start, ortSessionRunFinishTimestamp: finish,
        ortSessionRunDurationMs: finish - start, decodedCount: decoded.length, publishedCount: owned.length } };
    }, { causal: runtimeMode === 'causal', warmupCount: 3 });
    return { backend: 'webgpu', browserReceivedPcm: { sha256: pcm.sha256, byteLength: pcm.byteLength, sampleCount: pcm.sampleCount },
      modelLoadMs, sessionLoadCount: 1, actualInferenceSessionRunCount: runCount,
      timedSessionRunCount: windows.length, warmupCount: schedule.warmupCount, windowCount: windows.length,
      warmup: schedule.warmupRows,
      ownershipWindows: windows, perWindowTimings: schedule.rows, runtimeRows: schedule.rows,
      processingMs: schedule.rows.reduce((sum, row) => sum + row.processingMs, 0),
      schedulingMode: runtimeMode ?? 'accelerated', decoderInvoked: true, decoderIdentity: decoder,
      acousticObservations: observations };
  }, { decoder: ROBUST_DECODER_IDENTITY, acousticInput: request.acousticInput, runtimeMode: request.runtimeMode });
  return { ...result, webgpuAdapter };
}
