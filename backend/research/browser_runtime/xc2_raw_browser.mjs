import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { REPO_ROOT, RUNTIME_NODE_MODULES, launchXc1Browser, collectWebGpuAdapter, safeResolve, contentType } from './xc1_browser_runtime_shared.mjs';
import { fileSha, atomicJson, digest, preflightOutput } from './xc1_artifacts.mjs';
import { planXc2Windows, decodeXc2, inclusiveFrontier } from './xc2_decoders.mjs';

export const XC2_ONNX = 'backend/data/work/phase9gd1_robust_browser_onnx/robust_bytedance_fixed_1820_opset18.onnx';
export const XC2_ONNX_SHA = '4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3';
export async function executeXc2Raw({ clip, resampler, ownedMs, futureMs, ortVersion = '1.20.1', decoders = ['A', 'B', 'C'], output }) {
  const allowed = new Set(['clipId', 'takeId', 'workId', 'workSelectionGroup', 'split', 'sourceStartSeconds', 'durationMs', 'sourceWavSha256', 'pcm']);
  if (Object.keys(clip).some(key => !allowed.has(key))) throw new Error('XC2_AUDIO_ONLY_CLIP_FIELDS_REQUIRED');
  await preflightOutput(output);
  const pcm = clip.pcm[resampler];
  if (await fileSha(pcm.path) !== pcm.sha256 || await fileSha(XC2_ONNX) !== XC2_ONNX_SHA) throw new Error('XC2_ASSET_DRIFT');
  const windows = planXc2Windows({ sampleCount: pcm.samples, ownedMs, futureMs });
  // Zero-phase FIR interpolation requires real source samples just beyond the
  // last model-input coordinate; include its conservative source-ready bound.
  const preprocessingLookaheadMs = resampler === 'BAND_LIMITED' ? Math.ceil(4410 / 160) / 44100 * 1000 : 0;
  for (const spec of windows) spec.readyMs += preprocessingLookaheadMs;
  const ortRoot = ortVersion === '1.20.1' ? path.join(REPO_ROOT, 'backend/research/browser_runtime/xc1_ort120_runtime/node_modules/onnxruntime-web')
    : ortVersion === '1.30.0' ? path.join(RUNTIME_NODE_MODULES, 'onnxruntime-web') : null;
  if (!ortRoot || JSON.parse(await readFile(path.join(ortRoot, 'package.json'))).version !== ortVersion) throw new Error('XC2_ORT_IDENTITY');
  const server = createServer((request, response) => {
    try {
      const url = decodeURIComponent((request.url ?? '').split('?')[0]);
      if (url.includes('..') || url.includes('\\') || url.includes(':')) throw new Error('TRAVERSAL');
      if (url === '/') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>XC2 acoustic research</title><script src="/ort/ort.webgpu.min.js"></script>'); return; }
      const file = url === '/audio.f32' ? path.resolve(pcm.path) : url === '/robust.onnx' ? path.resolve(XC2_ONNX)
        : /^\/ort\/[A-Za-z0-9_.-]+$/.test(url) ? safeResolve(path.join(ortRoot, 'dist'), url.slice(5)) : null;
      if (!file) throw new Error('NOT_ALLOWLISTED');
      response.setHeader('Content-Type', contentType(file));
      createReadStream(file).on('error', () => { response.statusCode = 404; response.end(); }).pipe(response);
    } catch { response.statusCode = 403; response.end('XC2_AUDIO_ONLY_ROOT'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  const publications = Object.fromEntries(decoders.map(id => [id, []])), rawWindows = [], decoderFailures = {};
  const rawRoot = `${output}.raw`;
  await mkdir(rawRoot, { recursive: true });
  try {
    const launched = await launchXc1Browser({ channel: 'chrome', headed: true }); browser = launched.browser;
    const page = await browser.newPage();
    await page.exposeFunction('xc2PublishRaw', async raw => {
      const regBytes = Buffer.from(raw.reg, 'base64'), frameBytes = Buffer.from(raw.frame, 'base64');
      const regPath = path.join(rawRoot, `${raw.spec.windowId}_onset.f32`), framePath = path.join(rawRoot, `${raw.spec.windowId}_frame.f32`);
      await writeFile(regPath, regBytes, { flag: 'wx' }); await writeFile(framePath, frameBytes, { flag: 'wx' });
      const tensor = { regData: new Float32Array(regBytes.buffer, regBytes.byteOffset, regBytes.length / 4),
        frameData: new Float32Array(frameBytes.buffer, frameBytes.byteOffset, frameBytes.length / 4), dims: raw.dims,
        inputWindowStartMs: raw.spec.inputWindowStartMs, takeId: clip.clipId, windowId: raw.spec.windowId, spec: raw.spec };
      const availability = {};
      for (const decoder of decoders) {
        try {
          const started = performance.now(), events = decodeXc2(tensor, decoder);
          const key = `${resampler}_${ownedMs}_${futureMs}_${decoder}`;
          const observations = events.map((event, index) => ({ ...event,
            observationId: [clip.clipId, key, raw.spec.windowId, event.pitch, Math.round(event.performanceTimeMs * 16000), index].join(':') }));
          const availabilityTimeMs = performance.timeOrigin + performance.now() - raw.captureOrigin;
          publications[decoder].push({ publicationId: `${clip.clipId}:${key}:${raw.spec.windowId}`,
            analyzedThroughPerformanceMs: inclusiveFrontier(raw.spec.ownedEndMs), availabilityTimeMs,
            decoderProcessingMs: performance.now() - started,
            observations: observations.map(event => ({ ...event, availabilityTimeMs })) });
          availability[decoder] = availabilityTimeMs;
        } catch (error) { decoderFailures[decoder] = String(error.stack ?? error); }
      }
      rawWindows.push({ spec: raw.spec, dims: raw.dims, onsetPath: regPath, onsetSha256: await fileSha(regPath),
        framePath, frameSha256: await fileSha(framePath), availabilityTimeMs: availability });
      return { finished: performance.timeOrigin + performance.now() };
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const truthBoundaryProbe = await page.evaluate(async () => Object.fromEntries(await Promise.all(
      ['/truth.mid', '/../full_manifest.json', '/%2e%2e%2ftruth.json', '/C:%5Csecret.mid', '/SMD-piano_v2.zip']
        .map(async url => [url, (await fetch(url)).status]))));
    if (Object.values(truthBoundaryProbe).some(status => status < 400)) throw new Error('XC2_BROWSER_TRUTH_BOUNDARY_FAILED');
    const adapter = await collectWebGpuAdapter(page);
    const { createJiti } = createRequire(import.meta.url)(path.join(RUNTIME_NODE_MODULES, 'jiti'));
    const contract = createJiti(import.meta.url)(path.join(REPO_ROOT, 'apps/customer-web/src/lib/practice/research/acoustic-candidate-contract.ts'));
    const pcmBytes = await readFile(pcm.path);
    const acousticRequest = { pcm: new Float32Array(pcmBytes.buffer, pcmBytes.byteOffset, pcmBytes.length / 4),
      sampleRateHz: 16000, channelCount: 1, sourceId: clip.clipId, captureSessionId: clip.clipId,
      captureStartSample: 0, captureStartTimeMs: 0, acousticChunkId: clip.clipId,
      ownershipStartMs: 1380, ownershipEndMs: clip.durationMs - 220, contextStartMs: 0, contextEndMs: clip.durationMs,
      modelContextMs: 1820 - ownedMs - futureMs, futureContextMs: futureMs,
      runtimeRequestId: `${clip.clipId}:${resampler}:${ownedMs}:${futureMs}`,
      deploymentId: 'robust-browser-v1', candidateId: 'bytedance-robust-augmented-calibrated-v1' };
    const runtime = await contract.executeGreenfieldAcousticCandidate(acousticRequest, () => page.evaluate(async ({ windows, pcm, ortVersion }) => {
      const bytes = await (await fetch('/audio.f32')).arrayBuffer();
      const sha = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(v => v.toString(16).padStart(2, '0')).join('');
      if (sha !== pcm.sha256) throw new Error('XC2_BROWSER_PCM_DRIFT');
      const audio = new Float32Array(bytes), now = () => performance.timeOrigin + performance.now();
      const load = now();
      const session = await ort.InferenceSession.create('/robust.onnx', { executionProviders: ['webgpu'], graphOptimizationLevel: 'disabled' });
      const modelLoadMs = now() - load;
      let invocationCount = 0;
      const run = async spec => { invocationCount += 1; return session.run({ [session.inputNames[0]]: new ort.Tensor('float32', audio.slice(spec.startSample, spec.endSample), [1, 29120]) }); };
      const warmup = [];
      for (let i = 0; i < 3; i += 1) { const start = now(); await run(windows[0]); warmup.push(now() - start); }
      const captureOrigin = now(), rows = []; let chain = Promise.resolve(), outstanding = 0, failure;
      const encode = array => { const data = new Uint8Array(array.buffer, array.byteOffset, array.byteLength); let binary = ''; for (let i = 0; i < data.length; i += 4096) binary += String.fromCharCode(...data.subarray(i, i + 4096)); return btoa(binary); };
      await Promise.all(windows.map(spec => new Promise(resolve => setTimeout(() => {
        const receive = now(), depth = ++outstanding;
        chain = chain.then(async () => {
          if (failure) return;
          const started = now();
          try {
            const inferenceStart = now(), outputs = await run(spec), inferenceFinish = now();
            await window.xc2PublishRaw({ spec, captureOrigin, dims: outputs.reg_onset_output.dims,
              reg: encode(outputs.reg_onset_output.data), frame: encode(outputs.frame_output.data) });
            const finish = now();
            rows.push({ ...spec, scheduledReadyTimestamp: captureOrigin + spec.readyMs, receiveTimestamp: receive,
              pagePostTimestamp: receive, processingStartTimestamp: started, publicationFinishTimestamp: finish,
              queueDelayMs: started - receive, outstandingDepth: depth, processingMs: finish - started,
              ortSessionRunStartTimestamp: inferenceStart, ortSessionRunFinishTimestamp: inferenceFinish, ortSessionRunDurationMs: inferenceFinish - inferenceStart });
          } catch (error) { failure = error; } finally { outstanding -= 1; }
        }); resolve();
      }, Math.max(0, captureOrigin + spec.readyMs - now())))));
      await chain; if (failure) throw failure;
      return { ortVersion, modelLoadMs, sessionLoadCount: 1, actualSessionRunCount: invocationCount, warmup,
        captureOrigin, runtimeRows: rows, browserPcmSha256: sha, executionProviders: ['webgpu'] };
    }, { windows, pcm, ortVersion }));
    const result = { phase: 'PHASE_9G_XC2_ROBUST_PRODUCT_VERDICT_AND_LATENCY_BASELINE',
      status: 'REAL_AUDIO_ONLY_BROWSER_EXECUTION_COMPLETE', clipId: clip.clipId, resampler, ownedMs, futureMs,
      sampleCount: pcm.samples, pcmSha256: pcm.sha256, onnxSha256: XC2_ONNX_SHA, preprocessingLookaheadMs,
      browser: launched.identity, adapter, runtime, publications, decoderFailures, rawWindows,
      expectedScoreInput: false, midiInput: false, truthBoundaryProbe, modelExecutionSharedAcrossDecoders: true,
      availabilityClock: 'performance-origin ms = absolute Node/browser monotonic timestamp minus captureOrigin',
      bookkeepingCaveat: 'Shared raw persistence and all requested decoder work are included in serialized service; candidate publication timestamps are individually measured, not backdated.' };
    result.artifactCanonicalSha256 = digest(result);
    await atomicJson(output, result); return result;
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
