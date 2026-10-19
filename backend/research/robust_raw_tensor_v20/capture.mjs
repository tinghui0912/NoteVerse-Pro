// Isolated raw-only execution process: no outer control, historical payload or baseline decoder imports.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { open, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { ROOT, DIR, OUT, WORK, hash, now, bytes, save, corpusIdentity } from './io.mjs';
import { assertInventory, decodeLE, PAIR_BYTES, TENSOR_BYTES, CORPUS_BYTES } from './wire.mjs';

const startedAt = now(), reads = [], requests = [], diagnostics = [], windows = [], workers = [];
const allowedFiles = new Set([DIR + '/stage-a-config.json', OUT + '/remote-capture-permission.json']);
const read = async p => { assert.ok(allowedFiles.has(p), 'RAW_PROCESS_READ_NOT_ALLOWED:' + p); reads.push({ path: p, at: now() }); return bytes(p); };
const configBytes = await read(DIR + '/stage-a-config.json'), config = JSON.parse(configBytes);
const permission = JSON.parse(await read(OUT + '/remote-capture-permission.json'));
assert.equal(permission.configSha256, hash(configBytes)); assert.equal(permission.freezeCommit, permission.remoteHead);
assert.ok(permission.remoteVerifiedAt < startedAt, 'PROSPECTIVE_REMOTE_PERMISSION_REQUIRED');
await save(OUT + '/capture-started.json', { startedAt, permission, allowedExecutions: 1 });
const files = new Map();
for (const [route, a] of Object.entries(config.assets)) {
  allowedFiles.add(a.path); const b = await read(a.path);
  assert.equal(hash(b), a.sha256); assert.equal(b.length, a.bytes); files.set(route, { path: a.path, sha256: a.sha256 });
}
for (const b of config.bundles) {
  assert.ok(b.inputs.every(p => [DIR + '/capture-worker.mjs', DIR + '/capture-entry.mjs', DIR + '/wire.mjs'].includes(p)), 'NON_RAW_BUNDLE');
  allowedFiles.add(b.path); assert.equal(hash(await read(b.path)), b.sha256);
  files.set('/' + path.basename(b.path), b);
}
allowedFiles.add(config.manifest.path); const manifestBytes = await read(config.manifest.path);
assert.equal(hash(manifestBytes), config.manifest.sha256);
const manifest = JSON.parse(manifestBytes); assertInventory(manifest);
for (const j of manifest.jobs) {
  allowedFiles.add(j.inputBlobPath); const b = await read(j.inputBlobPath); assert.equal(hash(b), j.inputBlobSha256);
  for (const w of j.windows) { const input = b.subarray(w.inputByteOffset, w.inputByteOffset + w.inputBytes);
    assert.equal(input.length, 29120 * 4); assert.equal(decodeLE(input).length, 29120); assert.equal(hash(input), w.inputSha256); }
  files.set('/input/' + j.jobId, { path: j.inputBlobPath, sha256: j.inputBlobSha256 });
}
const all = manifest.jobs.flatMap(j => j.windows.map(w => ({ ...w, jobId: j.jobId, sourceDomainId: j.sourceDomainId,
  sourceCaseId: j.sourceCaseId, sourceRateHz: j.sourceRateHz, sourceOriginSample: j.sourceOriginSample })));
const handles = new Map(), blobs = [], positions = new Map(), jobFinalReadbacks = [], finalReadbackFailures = [];
// Exclusive job blobs prevent a second capture from overwriting partial or complete evidence.
for (const j of manifest.jobs) {
  const p = OUT + '/tensors/' + j.jobId + '.f32';
  await import('node:fs/promises').then(fs => fs.mkdir(path.dirname(path.join(ROOT, p)), { recursive: true }));
  handles.set(j.jobId, await open(path.join(ROOT, p), 'wx+')); positions.set(j.jobId, 0);
}
let forbiddenRequests = 0, serverFailure = null, lastProgress = null;
const server = createServer(async (req, res) => {
  const route = req.url, allowed = req.method === 'GET' && (route === '/' || files.has(route))
    || req.method === 'POST' && (/^\/raw\/\d+$/.test(route) || route === '/progress');
  requests.push({ method: req.method, route, allowed, at: now() });
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin'); res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  if (!allowed) { forbiddenRequests++; res.statusCode = 403; res.end('RAW_ASSET_ONLY'); return; }
  try {
    if (req.method === 'GET') {
      if (route === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><link rel="icon" href="data:,"><script type="module" src="/capture-entry.js"></script>'); return; }
      const f = files.get(route), b = await read(f.path); assert.equal(hash(b), f.sha256);
      res.setHeader('Content-Type', f.path.endsWith('.wasm') ? 'application/wasm' : /\.(mjs|js)$/.test(f.path) ? 'text/javascript' : 'application/octet-stream'); res.end(b); return;
    }
    const chunks = []; let size = 0;
    for await (const c of req) { size += c.length; if (size > PAIR_BYTES) throw Error('POST_SIZE_LIMIT'); chunks.push(c); }
    const b = Buffer.concat(chunks);
    if (route === '/progress') {
      lastProgress = JSON.parse(b.toString());
      await writeFile(path.join(ROOT, WORK, 'capture-progress.json'), JSON.stringify({ at: now(), ...lastProgress }));
      res.end('{}'); return;
    }
    const ordinal = Number(route.split('/').at(-1)), w = all[ordinal];
    assert.ok(w && ordinal === windows.length, 'RAW_UPLOAD_SEQUENCE'); assert.equal(b.length, PAIR_BYTES);
    assert.equal(decodeLE(b.subarray(0, TENSOR_BYTES)).length, 16104); assert.equal(decodeLE(b.subarray(TENSOR_BYTES)).length, 16104);
    const h = handles.get(w.jobId), offset = positions.get(w.jobId);
    const wrote = await h.write(b, 0, b.length, offset); assert.equal(wrote.bytesWritten, b.length); await h.sync();
    const check = Buffer.alloc(b.length), got = await h.read(check, 0, check.length, offset);
    assert.equal(got.bytesRead, b.length); assert.equal(hash(check), hash(b));
    const row = { ...w, blobPath: OUT + '/tensors/' + w.jobId + '.f32', byteOffset: offset, byteLength: PAIR_BYTES,
      onsetOffset: offset, onsetLength: TENSOR_BYTES, frameOffset: offset + TENSOR_BYTES, frameLength: TENSOR_BYTES,
      onsetSha256: hash(b.subarray(0, TENSOR_BYTES)), frameSha256: hash(b.subarray(TENSOR_BYTES)), pairSha256: hash(b),
      dtype: 'float32', shape: [1,183,88], finite: true, readbackSha256: hash(check) };
    windows.push(row); positions.set(w.jobId, offset + b.length);
    if (manifest.jobs.find(j => j.jobId === w.jobId).windows.at(-1).runOrdinal === ordinal) {
      const whole = Buffer.alloc(offset + b.length), readback = await h.read(whole, 0, whole.length, 0);
      assert.equal(readback.bytesRead, whole.length);
      const jobWindows = windows.filter(r => r.jobId === w.jobId);
      for (const r of jobWindows) {
        const raw = whole.subarray(r.byteOffset, r.byteOffset + PAIR_BYTES);
        assert.equal(hash(raw), r.pairSha256); assert.equal(hash(raw.subarray(0, TENSOR_BYTES)), r.onsetSha256);
        assert.equal(hash(raw.subarray(TENSOR_BYTES)), r.frameSha256);
      }
      jobFinalReadbacks.push({ jobId: w.jobId, bytes: whole.length, sha256: hash(whole), pairsVerified: jobWindows.length, completedAt: now() });
    }
    if ((ordinal + 1) % 10 === 0 || ordinal === 227) console.log(JSON.stringify({ capturedPairs: ordinal + 1, canonicalBytes: (ordinal + 1) * PAIR_BYTES }));
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ runOrdinal: ordinal, pairSha256: row.pairSha256 }));
  } catch (error) { serverFailure ??= String(error.stack ?? error); res.statusCode = 500; res.end(String(error)); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const require = createRequire(import.meta.url), root = path.join(ROOT, 'backend/research/browser_runtime/dr3r_browser_runtime/node_modules/playwright');
const { chromium } = require(root), playwrightVersion = require(path.join(root, 'package.json')).version;
let browser, page, trace = null, failure = null, GPU = null, browserIdentity = null;
try {
  browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: false });
  browserIdentity = { version: await browser.version(), headed: true, brand: 'Google Chrome', playwright: playwrightVersion, extraBrowserFlags: [] };
  const context = await browser.newContext(); page = await context.newPage();
  const base = `http://127.0.0.1:${server.address().port}`;
  await context.route('**/*', r => r.request().url().startsWith(base + '/') ? r.continue() : r.abort());
  page.on('worker', w => workers.push({ url: w.url(), pathname: new URL(w.url()).pathname, at: now() }));
  page.on('pageerror', e => diagnostics.push({ type: 'pageerror', error: e.message }));
  page.on('console', m => diagnostics.push({ type: 'console', level: m.type(), text: m.text() }));
  page.on('requestfailed', r => diagnostics.push({ type: 'requestfailed', url: r.url(), failure: r.failure() }));
  await page.goto(base + '/');
  GPU = await page.evaluate(async () => { if (!navigator.gpu) throw Error('WEBGPU_UNAVAILABLE'); const a = await navigator.gpu.requestAdapter();
    if (!a) throw Error('ADAPTER_UNAVAILABLE'); const i = a.info ?? await a.requestAdapterInfo?.();
    return { info: i ? { vendor: i.vendor, architecture: i.architecture, device: i.device, description: i.description } : null,
      isFallbackAdapter: a.isFallbackAdapter, features: [...a.features] }; });
  assert.ok(!GPU.isFallbackAdapter && !/swiftshader|software|llvmpipe/i.test(JSON.stringify(GPU.info)), 'HARDWARE_WEBGPU_REQUIRED');
  await page.waitForFunction(() => typeof window.captureRaw === 'function');
  trace = await page.evaluate(m => window.captureRaw(m), manifest);
  assert.equal(trace.phase, 'COMPLETE'); assert.equal(trace.loads, 1); assert.equal(trace.loadAttempts, 1);
  assert.equal(trace.runs, 228); assert.equal(trace.attempted, 228); assert.equal(trace.successfulSessionRuns, 228);
  assert.equal(trace.failedSessionRuns, 0); assert.equal(jobFinalReadbacks.length, 18);
  assert.equal(trace.workerConstructions, 1); assert.equal(trace.browserInputsVerified, 228); assert.equal(windows.length, 228);
  assert.equal(trace.completedUploads, 228); assert.equal(trace.unresolvedRequests, 0); assert.equal(forbiddenRequests, 0);
  assert.equal(workers.filter(w => w.pathname === '/capture-worker.js').length, 1);
  assert.ok(workers.every(w => ['/capture-worker.js','/ort/ort-wasm-simd-threaded.jsep.mjs'].includes(w.pathname)), 'UNEXPECTED_WORKER');
  if (serverFailure) throw Error(serverFailure);
} catch (error) { failure = String(error.stack ?? error); trace ??= await page?.evaluate(() => window.captureTrace).catch(() => null); }
finally {
  try { await browser?.close(); } catch (error) { failure ??= String(error.stack ?? error); }
  await new Promise(r => server.close(r));
  for (const [jobId, h] of handles) {
    const p = OUT + '/tensors/' + jobId + '.f32';
    try {
      await h.close(); const b = await bytes(p), jobWindows = windows.filter(w => w.jobId === jobId);
      assert.equal(b.length, positions.get(jobId));
      for (const w of jobWindows) {
        const raw = b.subarray(w.byteOffset, w.byteOffset + PAIR_BYTES);
        assert.equal(raw.length, PAIR_BYTES); assert.equal(hash(raw), w.pairSha256);
        assert.equal(hash(raw.subarray(0, TENSOR_BYTES)), w.onsetSha256); assert.equal(hash(raw.subarray(TENSOR_BYTES)), w.frameSha256);
        decodeLE(raw);
      }
      const immediateWhole = jobFinalReadbacks.find(r => r.jobId === jobId);
      if (immediateWhole) assert.equal(hash(b), immediateWhole.sha256);
      blobs.push({ jobId, path: p, bytes: b.length, sha256: hash(b), pairCount: jobWindows.length, finalPairAndTensorReadbacks: 'PASS' });
    } catch (error) {
      failure ??= String(error.stack ?? error); finalReadbackFailures.push({ jobId, error: String(error) });
      const b = await bytes(p).catch(() => Buffer.alloc(0));
      blobs.push({ jobId, path: p, bytes: b.length, sha256: hash(b), finalPairAndTensorReadbacks: 'FAILED_PRESERVED_PARTIAL_BYTES' });
    }
  }
  const canonicalBytes = blobs.reduce((n, b) => n + b.bytes, 0);
  if (!failure && canonicalBytes !== CORPUS_BYTES) failure = 'RAW_CANONICAL_BYTE_COUNT';
  const receipt = { modelSessionLoads: trace?.loads ?? lastProgress?.loads ?? 0,
    modelSessionLoadAttempts: trace?.loadAttempts ?? lastProgress?.loadAttempts ?? 0,
    modelSessionRuns: trace?.attempted ?? lastProgress?.attempted ?? 0,
    successfulSessionRuns: trace?.successfulSessionRuns ?? lastProgress?.successfulSessionRuns ?? 0,
    failedSessionRuns: trace?.failedSessionRuns ?? lastProgress?.failedSessionRuns ?? 0,
    attemptedSessionRuns: trace?.attempted ?? lastProgress?.attempted ?? 0, captureWorkerConstructions: trace?.workerConstructions ?? 0,
    captureOwnerWorkers: trace?.workerConstructions ?? 0,
    inputCount: trace?.browserInputsVerified ?? 0, rawTensorPairs: windows.length, rawCanonicalBytes: canonicalBytes,
    decoderRuns: 0, productVerdictRuns: 0, truthAccessCount: 0, hiddenWarmupRuns: 0,
    unknownRuns: Math.max(0, (trace?.attempted ?? lastProgress?.attempted ?? 0)
      - (trace?.successfulSessionRuns ?? lastProgress?.successfulSessionRuns ?? 0)
      - (trace?.failedSessionRuns ?? lastProgress?.failedSessionRuns ?? 0)) };
  await save(OUT + '/tensor-corpus-manifest.json', { schema: 'V20_CANONICAL_RAW_ONSET_FRAME_CORPUS_V1',
    startedAt, completedAt: now(), status: failure ? 'BLOCKED_PARTIAL_RAW_CORPUS_SEALED' : 'RAW_TENSOR_CORPUS_SEALED',
    permission, modelIdentity: config.modelIdentity, modelSha256: config.assets['/model.onnx'].sha256,
    ORT: config.ORT, provider: config.provider, graphOptimizationLevel: config.graphOptimizationLevel, automaticFallback: false,
    browser: browserIdentity, GPU, blobs, windows, corpusCanonicalSha256: corpusIdentity(windows), receipt,
    canonicalFormat: 'IEEE754_FLOAT32_LITTLE_ENDIAN_ONSET_THEN_FRAME_NO_PADDING', compression: 'NONE',
    workers: workers.map(w => ({ ...w, classification: w.pathname === '/capture-worker.js' ? 'V20_CAPTURE_OWNER'
      : w.pathname === '/ort/ort-wasm-simd-threaded.jsep.mjs' ? 'ORT_RUNTIME_SUBORDINATE' : 'UNEXPECTED_WORKER' })),
    jobFinalReadbacks, finalReadbackFailures, rawBrowserWorkerEvents: workers.length,
    observedOrtRuntimeWorkerEvents: workers.filter(w => w.pathname.startsWith('/ort/')).length,
    captureWorkerDefinition: '/capture-worker.js; ORT runtime infrastructure is not a second capture owner',
    failure, trace, requests, forbiddenRequests, diagnostics, rawOnlyDataReads: reads, bundles: config.bundles,
    StageB: 'NOT_STARTED', truthOpened: false, productVerdictComputed: false });
  const manifestSha256 = hash(await bytes(OUT + '/tensor-corpus-manifest.json'));
  await save(OUT + '/raw-tensor-seal.json', { sealedAt: now(), status: failure ? 'BLOCKED_PARTIAL_RAW_CORPUS_SEALED' : 'RAW_TENSOR_CORPUS_SEALED',
    manifestPath: OUT + '/tensor-corpus-manifest.json', manifestSha256, corpusCanonicalSha256: corpusIdentity(windows),
    jobs: blobs.length, ...receipt, failure, StageB: 'NOT_STARTED', decoderAccessPermitted: false });
  console.log(JSON.stringify({ status: failure ? 'BLOCKED' : 'SEALED', receipt, failure }));
  if (failure) process.exitCode = 1;
}
