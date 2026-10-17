import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, APP, WORK, MODEL, FIXTURE, newJson, verify, fileIdentity } from './protocol.mjs';
import { resolveBrandedBrowserExecutable, RUNTIME_NODE_MODULES, collectWebGpuAdapter } from '../../../../backend/research/browser_runtime/xc1_browser_runtime_shared.mjs';
import { classifyRuntimeDiagnostic } from '../continuous-runtime-diagnostics.mjs';

const proof = await verify();
const verification = JSON.parse(await readFile(path.join(WORK, 'verification.json'), 'utf8'));
if (verification.status !== 'PASS' || verification.proof.freezeCommit !== proof.freezeCommit) throw new Error('PRE_BROWSER_VERIFICATION_NOT_PASS');
await mkdir(WORK, { recursive: true });
const esbuild = await import(pathToFileURL(path.join(ROOT, 'backend/data/work/basic_pitch_browser_feasibility/node_modules/esbuild/lib/main.js')).href);
const bundleFiles = [];
for (const [entry, output] of [
  ['scripts/continuous-capture-qualification-entry.ts', 'gate1.js'],
  ['scripts/audio-context-clock/entry.ts', 'gate2.js'],
  ['src/lib/practice/acoustic-inference/continuous/acoustic-worker.entry.ts', 'worker.js'],
]) {
  await esbuild.build({ entryPoints: [path.join(APP, entry)], outfile: path.join(WORK, output), bundle: true,
    format: 'esm', platform: 'browser', target: 'es2022', sourcemap: 'inline', logLevel: 'silent',
    plugins: [{ name: 'pinned-ort', setup(build) {
      build.onResolve({ filter: /^onnxruntime-web\/webgpu$/ }, () => ({ path: '/ort/ort.webgpu.min.mjs', external: true }));
    } }], nodePaths: [path.join(APP, 'node_modules')] });
  bundleFiles.push(await fileIdentity(path.relative(ROOT, path.join(WORK, output))));
}
const requests = [], files = new Map([
  ...['gate1.js', 'gate2.js', 'worker.js'].map(p => ['/' + p, path.join(WORK, p)]),
  ['/model.onnx', path.join(ROOT, MODEL)],
  ['/capture.worklet.js', path.join(APP, 'src/lib/practice/acoustic-inference/continuous/capture.worklet.js')],
  ['/fir-44100.f32', path.join(APP, 'public/model-assets/continuous/fir-160-441.f32')],
  ['/fir-48000.f32', path.join(APP, 'public/model-assets/continuous/fir-1-3.f32')],
]);
const server = createServer((req, res) => {
  const url = req.url?.split('?')[0]; requests.push({ url, timestamp: new Date().toISOString() });
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin'); res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  if (url === '/gate1' || url === '/gate2') {
    res.setHeader('Content-Type', 'text/html'); res.end(`<!doctype html><title>Disabled clock qualification</title><script type="module" src="${url}.js"></script>`); return;
  }
  if (url === '/favicon.ico') { res.statusCode = 204; res.end(); return; }
  const file = files.get(url) ?? (/^\/ort\/[\w.-]+\.(mjs|wasm)$/.test(url) ? path.join(APP, 'node_modules/onnxruntime-web/dist', path.basename(url)) : null);
  if (!file) { res.statusCode = 403; res.end('ASSET_ONLY'); return; }
  res.setHeader('Content-Type', file.endsWith('.wasm') ? 'application/wasm' : /\.(js|mjs)$/.test(file) ? 'text/javascript' : 'application/octet-stream');
  createReadStream(file).on('error', () => { res.statusCode = 404; res.end(); }).pipe(res);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
let gate = 1;
const gate1 = [], gate2 = [], diagnostics = [];
const at = () => new Date().toISOString();
const executionStartedAt = at();
function watch(page, identity) {
  const rows = [], jobs = [];
  diagnostics.push({ ...identity, rows });
  page.on('console', message => {
    const row = { type: message.type(), timestamp: at(), text: message.text(), location: message.location(), origin: page.url() };
    rows.push(row); jobs.push(Promise.all(message.args().map(arg => arg.evaluate(v => v instanceof Error ? { message: v.message, stack: v.stack } : null).catch(() => null))).then(v => { row.errorArguments = v; }));
  });
  page.on('pageerror', error => rows.push({ type: 'pageerror', timestamp: at(), message: error.message, stack: error.stack }));
  page.on('worker', worker => rows.push({ type: 'worker-created', url: worker.url(), timestamp: at() }));
  page.on('requestfailed', request => rows.push({ type: 'requestfailed', timestamp: at(), url: request.url(), error: request.failure() }));
  page.on('response', response => { if (response.status() >= 400) rows.push({ type: 'failed-response', url: response.url(), status: response.status(), timestamp: at() }); });
  return async model => {
    await Promise.allSettled(jobs);
    for (const row of rows) row.classification = classifyRuntimeDiagnostic(row, model);
    if (rows.some(row => row.classification === 'BLOCKING_DIAGNOSTIC')) throw new Error('UNRESOLVED_BROWSER_DIAGNOSTIC');
  };
}
try {
  const require = createRequire(import.meta.url), { chromium } = require(path.join(RUNTIME_NODE_MODULES, 'playwright'));
  const executablePath = resolveBrandedBrowserExecutable('chrome');
  if (!executablePath) throw new Error('BRANDED_CHROME_UNAVAILABLE');
  browser = await chromium.launch({ executablePath, headless: false, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${path.join(ROOT, FIXTURE)}`] });
  const browserIdentity = { executablePath, version: await browser.version(), headed: true, node: process.version,
    playwright: require(path.join(RUNTIME_NODE_MODULES, 'playwright/package.json')).version };
  for (const rate of [44100, 48000]) {
    const context = await browser.newContext(), page = await context.newPage();
    const checkDiagnostics = watch(page, { gate, rate });
    try {
      await page.goto(`http://127.0.0.1:${server.address().port}/gate1`);
      const gpu = await collectWebGpuAdapter(page);
      const pending = page.evaluate(rate => window.runContinuousCaptureQualification(rate), rate);
      pending.catch(() => {});
      await Promise.race([
        page.waitForFunction(() => window.continuousAssetsReady === true, undefined, { timeout: 120000 }),
        pending.then(() => { throw new Error('QUALIFICATION_ENDED_BEFORE_OFFLINE_BARRIER'); }),
      ]);
      const offlineAt = at(); await context.setOffline(true);
      const result = await pending;
      gate1.push({ rate, offlineAt, result, gpu });
      if (result.status !== 'PASS') throw new Error('MODEL_NEUTRAL_REQUALIFICATION_FAILED');
      if (!diagnostics.at(-1).rows.some(row => row.type === 'worker-created' && row.url.endsWith('/worker.js'))) throw new Error('REAL_WORKER_NOT_OBSERVED');
      await checkDiagnostics(result.model);
      console.log('Gate 1 passed rate', rate);
    } finally { await context.close(); }
  }
  await newJson(path.join(WORK, 'gate1.json'), { proof, executionStartedAt, completedAt: at(), browser: browserIdentity,
    status: 'PASS', disposition: 'CONTINUOUS_MODEL_NEUTRAL_RUNTIME_REQUALIFIED', model: await fileIdentity(MODEL), fixture: await fileIdentity(FIXTURE),
    results: gate1, diagnostics: diagnostics.filter(r => r.gate === 1), bundleFiles,
    actualModelRuns: gate1.reduce((n, r) => n + r.result.snapshot.diagnostics.at(-1).actualSessionRunCount, 0),
    realDevice: 'NOT_PERFORMED', scientificEvaluation: false });
  gate = 2;
  const gate2StartedAt = at();
  for (const rate of [44100, 48000]) for (const kind of ['A', 'B', 'C', 'D']) {
    const context = await browser.newContext(), page = await context.newPage();
    const checkDiagnostics = watch(page, { gate, rate, scenario: kind });
    try {
      await page.goto(`http://127.0.0.1:${server.address().port}/gate2`);
      const result = await page.evaluate(({ rate, kind }) => window.runAudioContextClockGate(rate, kind), { rate, kind });
      gate2.push(result);
      if (result.status !== 'PASS') throw new Error('CLOCK_GATE_FAILED');
      await checkDiagnostics(null);
      console.log('Gate 2 passed', rate, kind);
    } finally { await context.close(); }
  }
  await newJson(path.join(WORK, 'gate2.json'), { proof, executionStartedAt: gate2StartedAt, completedAt: at(), browser: browserIdentity,
    status: 'PASS', results: gate2, diagnostics: diagnostics.filter(r => r.gate === 2), actualModelRuns: 0, serverRequests: requests,
    disposition: 'CONTINUOUS_AUDIO_CONTEXT_CLOCK_CONTRACT_READY_FOR_CONTROLLER_INTEGRATION',
    limitations: ['Internal render-timeline consistency only', 'No physical input/output latency qualification', 'No real device', 'No UX SLO', 'No capability enablement'] });
} catch (error) {
  const disposition = gate === 1 ? 'CONTINUOUS_MODEL_NEUTRAL_RUNTIME_REQUALIFICATION_BLOCKED' : 'CONTINUOUS_AUDIO_CONTEXT_CLOCK_CONTRACT_V2_BLOCKED';
  await newJson(path.join(WORK, 'failure.json'), { proof, executionStartedAt, failedAt: at(), gate, disposition,
    error: String(error.stack ?? error), gate1, gate2, diagnostics, serverRequests: requests, bundleFiles });
  console.error(disposition, String(error)); process.exitCode = 1;
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
