import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT, launchXc1Browser, collectWebGpuAdapter, contentType } from './xc1_browser_runtime_shared.mjs';
import { atomicJson, fileSha, preflightOutput, digest } from './xc1_artifacts.mjs';
import { ROOT, OLD_ROOT, PHASE, load } from './xc2_r1_diagnose.mjs';
import { XC2_ONNX, XC2_ONNX_SHA } from './xc2_raw_browser.mjs';
import { planXc2Windows } from './xc2_decoders.mjs';
import { pitchName, latencySummary } from './xc2_product_metrics.mjs';
import { describe } from './robust_runtime_evidence_analysis.mjs';
import { classifyBacklog } from './xc1_browser_semantics.mjs';

export async function runRuntimeCell(plan, config, clipRow, repeat, ordinal) {
  const output = `${ROOT}/runtime/${repeat}_${config.id}_${clipRow.clip.clipId}.json`;
  try { await stat(output); throw new Error(`R1_IMMUTABLE_CELL_EXISTS:${output}`); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  await preflightOutput(output);
  const clip = clipRow.clip, pcm = clip.pcm.LINEAR;
  for (const a of [pcm, clipRow.guardedSource, plan.coefficients]) if (await fileSha(a.path) !== a.sha256) throw new Error('R1_AUDIO_OR_FIR_DRIFT');
  if (await fileSha(XC2_ONNX) !== XC2_ONNX_SHA) throw new Error('R1_MODEL_DRIFT');
  const ortRoot = `${REPO_ROOT}/backend/research/browser_runtime/xc1_ort120_runtime/node_modules/onnxruntime-web`;
  if (JSON.parse(await readFile(`${ortRoot}/package.json`)).version !== '1.20.1') throw new Error('R1_ORT_DRIFT');
  const code = ['xc2_r1_browser_acoustic.mjs', 'xc2_r1_streaming_resampler.mjs', 'xc2_r1_bounded_finalizer.mjs', 'xc2_decoders.mjs', 'xc1_robust_decoder.mjs'];
  const files = new Map([['/audio.f32', pcm.path], ['/source.f32', clipRow.guardedSource.path], ['/fir.f32', plan.coefficients.path], ['/robust.onnx', XC2_ONNX],
    ...code.map(n => [`/code/${n}`, `backend/research/browser_runtime/${n}`])]);
  const server = createServer((request, response) => {
    try {
      const url = decodeURIComponent(request.url.split('?')[0]);
      if (url.includes('..') || url.includes('\\') || url.includes(':')) throw new Error('ROOT');
      if (url === '/') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>XC2 R1 runtime research</title><script src="/ort/ort.webgpu.min.js"></script>'); return; }
      const file = files.get(url) ?? (/^\/ort\/[\w.-]+$/.test(url) ? `${ortRoot}/dist/${url.slice(5)}` : null);
      if (!file) throw new Error('NOT_ALLOWLISTED');
      response.setHeader('Content-Type', url.endsWith('.mjs') ? 'text/javascript' : contentType(file));
      createReadStream(file).on('error', () => { response.statusCode = 404; response.end(); }).pipe(response);
    } catch { response.statusCode = 403; response.end('AUDIO_ONLY'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    const launched = await launchXc1Browser({ channel: 'chrome', headed: true }); browser = launched.browser;
    const page = await browser.newPage(); await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const adapter = await collectWebGpuAdapter(page);
    const probes = await page.evaluate(async () => Promise.all(['/truth.mid', '/../truth.json', '/SMD-piano_v2.zip', '/%2e%2e%5ctruth.mid'].map(async url => (await fetch(url)).status)));
    if (probes.some(s => s < 400)) throw new Error('R1_ROOT_ISOLATION');
    // Score is supplied only to the downstream product consumer, not the acoustic constructor/run arguments.
    const truth = await load(`${OLD_ROOT}/${clip.split.toLowerCase()}_benchmark.json`);
    const scenario = [...truth.clips.find(c => c.clipId === clip.clipId).scenarios].sort((a, b) => a.id.localeCompare(b.id))[0];
    const expected = scenario.expected.map(s => ({ strikeId: s.strikeId, groupId: s.groupId, pitch: pitchName(s.pitch), expectedPerformanceTimeMs: s.timeMs }));
    await page.evaluate(async expected => {
      const { BoundedContinuousFinalizationLedger } = await import('/code/xc2_r1_bounded_finalizer.mjs');
      window.createProductConsumer = clock => new BoundedContinuousFinalizationLedger(expected, { clock });
    }, expected);
    const windows = planXc2Windows({ sampleCount: pcm.samples, ownedMs: config.ownedMs, futureMs: config.futureMs });
    if (config.resampler === 'BAND_LIMITED') windows.forEach(s => s.readyMs += 28 / 44100 * 1000);
    const runtime = await page.evaluate(async ({ windows, config, clipId, expectedShas }) => {
      const now = () => performance.timeOrigin + performance.now();
      const fetchF32 = async (url, expected) => { const bytes = await (await fetch(url)).arrayBuffer();
        const actual = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
        if (actual !== expected) throw new Error('R1_BROWSER_AUDIO_DRIFT'); return new Float32Array(bytes); };
      const pcm = await fetchF32('/audio.f32', expectedShas.pcm), guardedSource = await fetchF32('/source.f32', expectedShas.source), coefficients = await fetchF32('/fir.f32', expectedShas.fir);
      const { createAcousticExecutor } = await import('/code/xc2_r1_browser_acoustic.mjs');
      const acoustic = await createAcousticExecutor({ pcm, guardedSource, coefficients, clipId, resampler: config.resampler });
      const warmup = [];
      for (let i = 0; i < 3; i++) { acoustic.reset(); const start = now(); await acoustic.run(windows[0]); warmup.push(now() - start); }
      acoustic.reset();
      const captureOrigin = now(), consumer = window.createProductConsumer(() => now() - captureOrigin);
      let chain = Promise.resolve(), outstanding = 0, failure; const rows = [], publications = [];
      await Promise.all(windows.map(spec => new Promise(resolve => setTimeout(() => {
        const receive = now(), depth = ++outstanding;
        chain = chain.then(async () => {
          if (failure) return;
          const start = now();
          try {
            const result = await acoustic.run(spec), acousticFinish = now();
            const frontier = new Float64Array([spec.ownedEndMs]); new BigUint64Array(frontier.buffer)[0] -= 1n;
            const pub = { publicationId: spec.windowId, analyzedThroughPerformanceMs: frontier[0], availabilityTimeMs: acousticFinish - captureOrigin,
              observations: result.observations.map(o => ({ ...o, pitch: ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][o.pitch % 12] + (Math.floor(o.pitch / 12) - 1) })) };
            const finalizerStart = now(); consumer.publish(pub); const finalizerFinish = now();
            rows.push({ ...spec, receiveTimestamp: receive, scheduledReadyTimestamp: captureOrigin + spec.readyMs, processingStartTimestamp: start,
              publicationFinishTimestamp: finalizerFinish, acousticPublicationFinishTimestamp: acousticFinish,
              schedulingDelayMs: receive - captureOrigin - spec.readyMs, queueDelayMs: start - receive, outstandingDepth: depth,
              processingMs: finalizerFinish - start, acousticProcessingMs: acousticFinish - start, finalizerCpuMs: finalizerFinish - finalizerStart,
              ...Object.fromEntries(Object.entries(result).filter(([key]) => key !== 'observations')) });
            // Only compact acoustic publications/metrics remain in memory; no raw tensor export or Node RPC on the critical path.
            publications.push(pub);
          } catch (error) { failure = String(error.stack ?? error); } finally { outstanding--; }
        }); resolve();
      }, Math.max(0, captureOrigin + spec.readyMs - now())))));
      await chain; if (failure) throw new Error(failure);
      const last = publications.at(-1), terminalStart = now(); consumer.completeNaturalScope(last.analyzedThroughPerformanceMs, now() - captureOrigin);
      const terminalFinalizerCpuMs = now() - terminalStart;
      const result = { identity: acoustic.identity(), captureOrigin, rows, publications, boundedFinalization: consumer.snapshot(), terminalFinalizerCpuMs, warmup };
      result.browserResultReadyTimestamp = now(); return result;
    }, { windows, config, clipId: clip.clipId, expectedShas: { pcm: pcm.sha256, source: clipRow.guardedSource.sha256, fir: plan.coefficients.sha256 } });
    const nodeReceiptTimestamp = performance.timeOrigin + performance.now();
    const steady = runtime.rows.slice(3).filter(r => !r.shiftedFinalWindow);
    const exportStart = performance.now(), result = { phase: PHASE, classification: 'PRODUCTION_LIKE_RUNTIME_ENGINEERING_ONLY_NOT_PRODUCT_QUALIFICATION',
      config, repeat, ordinal, clipId: clip.clipId, browser: launched.identity, adapter, probes, runtime,
      model: { path: XC2_ONNX, sha256: XC2_ONNX_SHA }, frozenSourceDigest: plan.sourceDigest,
      warmFence: 'Three explicit warmup runs, then first three timed windows excluded from warm service distribution; all full rows retained for causal queue classification.',
      summary: { productProcessingMs: describe(steady.map(r => r.processingMs)), pureOrtMs: describe(steady.map(r => r.ortSessionRunDurationMs)),
        decoderMs: describe(steady.map(r => r.decoderMs)), resamplerAndInputCopyMs: describe(steady.map(r => r.preprocessMs)),
        resamplerMs: describe(steady.map(r => r.resamplerMs)), inputCopyMs: describe(steady.map(r => r.inputCopyMs)), finalizerCpuMs: describe(steady.map(r => r.finalizerCpuMs)),
        queueMs: describe(runtime.rows.map(r => r.queueDelayMs)), backlog: classifyBacklog(runtime.rows.filter(r => !r.shiftedFinalWindow), config.ownedMs),
        captureReadyToAcousticPublicationMs: describe(runtime.rows.map(r => r.acousticPublicationFinishTimestamp - r.scheduledReadyTimestamp)),
        captureReadyToProductPublicationMs: describe(runtime.rows.map(r => r.publicationFinishTimestamp - r.scheduledReadyTimestamp)),
        oldestOwnedSourceToProductPublicationMs: describe(runtime.rows.map(r => r.publicationFinishTimestamp - runtime.captureOrigin - r.ownedStartMs)),
        verdictLatency: Object.fromEntries(['CORRECT','MISSING','WRONG','INCOMPLETE_CHORD','EXTRA'].map(k => [k, latencySummary(runtime.boundedFinalization.verdicts.filter(v => v.verdict === k).map(v => v.finalizationLatencyMs))])) },
      boundary: { neuralInputContainsScore: false, downstreamFinalizerScoreSeparate: true, rawTensorExport: false, hashingInCriticalPath: false, nodeIpcInCriticalPath: false,
        browserStreamingBandLimited: config.resampler === 'BAND_LIMITED', linearInputNote: 'LINEAR uses existing canonical 16k PCM; no new browser-linear microphone resampler qualification claimed.' },
      postCaptureBrowserSerializationAndNodeIpcMs: nodeReceiptTimestamp - runtime.browserResultReadyTimestamp,
      artifactExportSerializationMs: null, fileWriteAndHashMs: null };
    const serializeStart = performance.now(); JSON.stringify(result); result.artifactExportSerializationMs = performance.now() - serializeStart;
    result.postCaptureReceiptAssemblyMs = performance.now() - exportStart;
    result.artifactCanonicalSha256 = digest(result); const writeStart = performance.now(); await atomicJson(output, result); const sha = await fileSha(output);
    return { path: output, sha256: sha, summary: result.summary, config: config.id, repeat, clipId: clip.clipId,
      postCaptureFileWriteAndHashMs: performance.now() - writeStart };
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
}

export async function runRuntime() {
  const freeze = await load('backend/research/reports/phase9g_xc2_r1_policy_freeze_2026-10-16.json');
  for (const s of freeze.sources) if (await fileSha(s.path) !== s.sha256) throw new Error('R1_FROZEN_SOURCE_DRIFT');
  const parity = await load(`${ROOT}/browser_resampler_parity.json`);
  if (!parity.pass) throw new Error('BAND_LIMITED_BROWSER_RUNTIME_NOT_YET_QUALIFIED');
  const prep = await load(`${ROOT}/preparation.json`), rows = [];
  const plan = { ...prep, sourceDigest: digest(freeze.sources) };
  for (const cell of freeze.runtimeOrder) {
    const config = freeze.configurations.find(c => c.id === cell.config), clip = prep.runtimeClips.find(c => c.clip.clipId === cell.clipId);
    const row = await runRuntimeCell(plan, config, clip, cell.repeat, rows.length); rows.push(row);
    console.log(JSON.stringify({ completed: rows.length, expected: freeze.runtimeOrder.length, ...row, summary: { processing: row.summary.productProcessingMs, backlog: row.summary.backlog } }));
  }
  await atomicJson(`${ROOT}/runtime_summary.json`, { phase: PHASE, freezeDigest: digest(freeze), rows,
    primaryQualification: 'Finite 28-second clip repeated-session causal measurements; not indefinite-runtime or UI/perceptual proof.' });
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await runRuntime();
