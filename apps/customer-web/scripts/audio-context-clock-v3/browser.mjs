import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, APP, WORK, MODEL, FIXTURE, newJson, verify, fileIdentity, gateStatus, SUCCESS, BLOCKED } from './protocol.mjs';
import { resolveBrandedBrowserExecutable, RUNTIME_NODE_MODULES, collectWebGpuAdapter } from '../../../../backend/research/browser_runtime/xc1_browser_runtime_shared.mjs';
import { classifyRuntimeDiagnostic } from '../continuous-runtime-diagnostics.mjs';

const proof = await verify();
const verification = JSON.parse(await readFile(path.join(WORK, 'verification.json'), 'utf8'));
if (verification.status !== 'PASS' || verification.proof.freezeCommit !== proof.freezeCommit) throw new Error('PRE_BROWSER_VERIFICATION_NOT_PASS');
await mkdir(WORK, { recursive: true });
const esbuild = await import(pathToFileURL(path.join(ROOT, 'backend/data/work/basic_pitch_browser_feasibility/node_modules/esbuild/lib/main.js')).href);
const bundles = [];
for (const [entry, output] of [
  ['scripts/continuous-capture-qualification-entry.ts', 'gate1.js'],
  ['scripts/audio-context-clock/entry.ts', 'gate2.js'],
  ['src/lib/practice/acoustic/model/acoustic-worker.entry.ts', 'worker.js'],
]) {
  await esbuild.build({ entryPoints: [path.join(APP, entry)], outfile: path.join(WORK, output), bundle: true,
    format: 'esm', platform: 'browser', target: 'es2022', sourcemap: 'inline', logLevel: 'silent',
    plugins: [{ name: 'pinned-ort', setup(build) {
      build.onResolve({ filter: /^onnxruntime-web\/webgpu$/ }, () => ({ path: '/ort/ort.webgpu.min.mjs', external: true }));
    } }], nodePaths: [path.join(APP, 'node_modules')] });
  bundles.push(await fileIdentity(path.relative(ROOT, path.join(WORK, output))));
}
const requests = [], files = new Map([
  ...['gate1.js', 'gate2.js', 'worker.js'].map(p => ['/' + p, path.join(WORK, p)]), ['/model.onnx', path.join(ROOT, MODEL)],
  ['/capture.worklet.js', path.join(APP, 'src/lib/practice/acoustic/source/capture.worklet.js')],
  ['/fir-44100.f32', path.join(APP, 'public/model-assets/practice-acoustic/fir-160-441.f32')],
  ['/fir-48000.f32', path.join(APP, 'public/model-assets/practice-acoustic/fir-1-3.f32')],
]);
const server = createServer((req, res) => {
  const url = req.url?.split('?')[0]; requests.push({ url, timestamp: new Date().toISOString() });
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin'); res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  if (url === '/gate1' || url === '/gate2') { res.setHeader('Content-Type', 'text/html'); res.end(`<!doctype html><title>Disabled clock v3 qualification</title><script type="module" src="${url}.js"></script>`); return; }
  if (url === '/favicon.ico') { res.statusCode = 204; res.end(); return; }
  const file = files.get(url) ?? (/^\/ort\/[\w.-]+\.(mjs|wasm)$/.test(url) ? path.join(APP, 'node_modules/onnxruntime-web/dist', path.basename(url)) : null);
  if (!file) { res.statusCode = 403; res.end('ASSET_ONLY'); return; }
  res.setHeader('Content-Type', file.endsWith('.wasm') ? 'application/wasm' : /\.(js|mjs)$/.test(file) ? 'text/javascript' : 'application/octet-stream');
  createReadStream(file).on('error', () => { res.statusCode = 404; res.end(); }).pipe(res);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const at = () => new Date().toISOString();
const gate1 = [44100, 48000].map(rate => ({ rate, state: 'NOT_STARTED' }));
const gate2 = [44100, 48000].flatMap(rate => ['A', 'B', 'C', 'D'].map(scenario => ({ rate, scenario, state: 'NOT_STARTED' })));
const diagnostics = [], executionStartedAt = at();
let browser, browserIdentity, activeCell, failure;
function watch(page, identity) {
  const rows = [], jobs = []; diagnostics.push({ ...identity, rows });
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
function assertClockResult(result) {
  if (result.status !== 'PASS' || result.boundaries.some(b => b.leadSamples < 0)
    || result.segments.some(s => Math.abs(s.durationMismatchSamples) > 1)
    || result.pauseWitnesses.some(p => p.pausedPerformanceTimeMs !== p.resumePerformanceTimeMs || p.deltaMs !== 0)) throw new Error('CLOCK_IDENTITY_OR_SAMPLE_INVARIANT');
  if (result.scenario === 'C') {
    const witness = result.futureBoundaryWitness;
    if (!witness || witness.futureContextTime !== witness.startContextTime + witness.durationMs / 1000
      || witness.completionSourceSample !== witness.registeredSourceSample
      || witness.transport.completionReason !== 'SCOPE_COMPLETED' || witness.transport.performanceTimeMs !== witness.durationMs
      || result.applied.filter(b => b.type === 'TERMINAL').length !== 1) throw new Error('FUTURE_BOUNDARY_WITNESS_FAILED');
  }
}
try {
  const require = createRequire(import.meta.url), { chromium } = require(path.join(RUNTIME_NODE_MODULES, 'playwright'));
  const executablePath = resolveBrandedBrowserExecutable('chrome'); if (!executablePath) throw new Error('BRANDED_CHROME_UNAVAILABLE');
  browser = await chromium.launch({ executablePath, headless: false, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${path.join(ROOT, FIXTURE)}`] });
  browserIdentity = { executablePath, version: await browser.version(), headed: true, node: process.version,
    playwright: require(path.join(RUNTIME_NODE_MODULES, 'playwright/package.json')).version };
  for (const cell of gate1) {
    activeCell = cell; cell.state = 'RUNNING'; cell.startedAt = at();
    const context = await browser.newContext(), page = await context.newPage(); const checkDiagnostics = watch(page, { gate: 1, rate: cell.rate });
    try {
      await page.goto(`http://127.0.0.1:${server.address().port}/gate1`); cell.gpu = await collectWebGpuAdapter(page);
      const pending = page.evaluate(rate => window.runContinuousCaptureQualification(rate), cell.rate); pending.catch(() => {});
      await Promise.race([page.waitForFunction(() => window.continuousAssetsReady === true, undefined, { timeout: 120000 }),
        pending.then(() => { throw new Error('ENDED_BEFORE_OFFLINE_BARRIER'); })]);
      cell.offlineAt = at(); await context.setOffline(true); cell.result = await pending;
      if (cell.result.status !== 'PASS' || !diagnostics.at(-1).rows.some(row => row.type === 'worker-created' && row.url.endsWith('/worker.js'))) throw new Error('MODEL_NEUTRAL_GATE_FAILED');
      await checkDiagnostics(cell.result.model); cell.state = 'PASS'; cell.completedAt = at(); console.log('Gate 1 PASS', cell.rate);
    } finally { await context.close(); }
  }
  // Gate 2 cannot start unless both independent current-code model executions passed.
  if (gateStatus(gate1) !== 'PASS') throw new Error('GATE1_NOT_PASS');
  for (const cell of gate2) {
    activeCell = cell; cell.state = 'RUNNING'; cell.startedAt = at();
    const context = await browser.newContext(), page = await context.newPage(); const checkDiagnostics = watch(page, { gate: 2, rate: cell.rate, scenario: cell.scenario });
    try {
      await page.goto(`http://127.0.0.1:${server.address().port}/gate2`);
      cell.result = await page.evaluate(({ rate, kind }) => window.runAudioContextClockGate(rate, kind), { rate: cell.rate, kind: cell.scenario });
      assertClockResult(cell.result); await checkDiagnostics(null);
      cell.state = 'PASS'; cell.completedAt = at(); console.log('Gate 2 PASS', cell.rate, cell.scenario);
    } finally { await context.close(); }
  }
} catch (error) {
  failure = String(error.stack ?? error);
  if (activeCell) { activeCell.state = 'FAILED'; activeCell.failedAt = at(); activeCell.error = String(error.stack ?? error); }
  console.error(BLOCKED, String(error)); process.exitCode = 1;
} finally {
  await browser?.close(); await new Promise(resolve => server.close(resolve));
  const disposition = gateStatus(gate1) === 'PASS' && gateStatus(gate2) === 'PASS' ? SUCCESS : BLOCKED;
  await newJson(path.join(WORK, 'execution.json'), { proof, executionStartedAt, completedAt: at(), browser: browserIdentity, disposition,
    gate1: { status: gateStatus(gate1), cells: gate1 }, gate2: { status: gateStatus(gate2), cells: gate2 },
    actualModelRuns: gate1.reduce((n, c) => n + (c.result?.snapshot?.diagnostics.at(-1)?.actualSessionRunCount ?? 0), 0),
    modelRunCountComplete: gate1.filter(c => c.state !== 'NOT_STARTED').every(c => Boolean(c.result)), failure,
    diagnostics, serverRequests: requests, bundles, model: await fileIdentity(MODEL), fixture: await fileIdentity(FIXTURE),
    realDevice: 'NOT_PERFORMED', productionMicrophone: false, D4: false });
  console.log(disposition);
}
