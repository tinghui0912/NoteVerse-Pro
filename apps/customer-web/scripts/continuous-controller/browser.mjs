import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, APP, MODEL, FIXTURE, paths, newJson, verify, fileIdentity, SUCCESS, BLOCKED } from './protocol.mjs';
import { resolveBrandedBrowserExecutable, RUNTIME_NODE_MODULES, collectWebGpuAdapter } from '../../../../backend/research/browser_runtime/xc1_browser_runtime_shared.mjs';
import { classifyRuntimeDiagnostic } from '../continuous-runtime-diagnostics.mjs';

const id = process.argv[2] ?? 'v1', proof = await verify(id), work = paths(id).work;
const verification = JSON.parse(await readFile(path.join(work, 'verification.json'), 'utf8'));
if (verification.status !== 'PASS' || verification.proof.freezeCommit !== proof.freezeCommit) throw new Error('PRE_BROWSER_VERIFICATION_NOT_PASS');
await mkdir(work, { recursive: true });
const esbuild = await import(pathToFileURL(path.join(ROOT, 'backend/data/work/basic_pitch_browser_feasibility/node_modules/esbuild/lib/main.js')).href);
const bundles = [];
for (const [entry, output] of [
  ['scripts/continuous-controller/entry.ts', 'entry.js'],
  ['src/lib/practice/acoustic-inference/continuous/acoustic-worker.entry.ts', 'worker.js'],
]) {
  await esbuild.build({ entryPoints: [path.join(APP, entry)], outfile: path.join(work, output), bundle: true,
    format: 'esm', platform: 'browser', target: 'es2022', sourcemap: 'inline', logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
    plugins: [{ name: 'pinned-ort', setup(build) { build.onResolve({ filter: /^onnxruntime-web\/webgpu$/ }, () => ({ path: '/ort/ort.webgpu.min.mjs', external: true })); } }],
    nodePaths: [path.join(APP, 'node_modules')] });
  bundles.push(await fileIdentity(path.relative(ROOT, path.join(work, output))));
}
const requests = [], files = new Map([
  ['/entry.js', path.join(work, 'entry.js')], ['/worker.js', path.join(work, 'worker.js')], ['/model.onnx', path.join(ROOT, MODEL)],
  ['/capture.worklet.js', path.join(APP, 'src/lib/practice/acoustic-inference/continuous/capture.worklet.js')],
  ['/model-assets/continuous/fir-160-441.f32', path.join(APP, 'public/model-assets/continuous/fir-160-441.f32')],
  ['/model-assets/continuous/fir-1-3.f32', path.join(APP, 'public/model-assets/continuous/fir-1-3.f32')],
]);
const server = createServer((req, res) => {
  const url = req.url?.split('?')[0]; requests.push({ url, timestamp: new Date().toISOString() });
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin'); res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  if (url === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Disabled Continuous controller qualification</title><script type="module" src="/entry.js"></script>'); return; }
  if (url === '/favicon.ico') { res.statusCode = 204; res.end(); return; }
  const file = files.get(url) ?? (/^\/ort\/[\w.-]+\.(mjs|wasm)$/.test(url) ? path.join(APP, 'node_modules/onnxruntime-web/dist', path.basename(url)) : null);
  if (!file) { res.statusCode = 403; res.end('ASSET_ONLY'); return; }
  res.setHeader('Content-Type', file.endsWith('.wasm') ? 'application/wasm' : /\.(js|mjs)$/.test(file) ? 'text/javascript' : 'application/octet-stream');
  createReadStream(file).on('error', () => { res.statusCode = 404; res.end(); }).pipe(res);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const scenarios = ['natural_recording_offline', 'count_in_cancel_multiple_pause_manual_stop', 'pause_near_terminal_resume_natural', 'recording_analysis_failure_running'];
const cells = [44100, 48000].flatMap(rate => scenarios.map(scenario => ({ rate, scenario, state: 'NOT_STARTED' })));
const diagnostics = [], at = () => new Date().toISOString(), executionStartedAt = at();
let browser, browserIdentity, activeCell, failure;
try {
  const require = createRequire(import.meta.url), { chromium } = require(path.join(RUNTIME_NODE_MODULES, 'playwright'));
  const executablePath = resolveBrandedBrowserExecutable('chrome'); if (!executablePath) throw new Error('BRANDED_CHROME_UNAVAILABLE');
  browser = await chromium.launch({ executablePath, headless: false, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${path.join(ROOT, FIXTURE)}`] });
  browserIdentity = { executablePath, version: await browser.version(), headed: true, node: process.version,
    playwright: require(path.join(RUNTIME_NODE_MODULES, 'playwright/package.json')).version };
  for (const cell of cells) {
    activeCell = cell; cell.state = 'RUNNING'; cell.startedAt = at();
    const context = await browser.newContext(), page = await context.newPage(), rows = [], jobs = [];
    diagnostics.push({ rate: cell.rate, scenario: cell.scenario, rows });
    page.on('console', message => {
      const row = { type: message.type(), timestamp: at(), text: message.text(), location: message.location(), origin: page.url() };
      rows.push(row); jobs.push(Promise.all(message.args().map(arg => arg.evaluate(v => v instanceof Error ? { message: v.message, stack: v.stack } : null).catch(() => null))).then(v => { row.errorArguments = v; }));
    });
    page.on('pageerror', error => rows.push({ type: 'pageerror', timestamp: at(), message: error.message, stack: error.stack }));
    page.on('worker', worker => rows.push({ type: 'worker-created', url: worker.url(), timestamp: at() }));
    page.on('requestfailed', request => rows.push({ type: 'requestfailed', timestamp: at(), url: request.url(), error: request.failure() }));
    page.on('response', response => { if (response.status() >= 400) rows.push({ type: 'failed-response', url: response.url(), status: response.status(), timestamp: at() }); });
    try {
      await page.goto(`http://127.0.0.1:${server.address().port}/`); cell.gpu = await collectWebGpuAdapter(page);
      const pending = page.evaluate(({ rate, scenario }) => window.runContinuousControllerQualification(rate, scenario), cell); pending.catch(() => {});
      await Promise.race([page.waitForFunction(() => window.controllerAssetsReady === true, undefined, { timeout: 120000 }),
        pending.then(() => { throw new Error('ENDED_BEFORE_READY_BARRIER'); })]);
      cell.offlineAt = at(); await context.setOffline(true); await page.evaluate(() => { window.controllerOfflineReady = true; });
      cell.result = await pending; await Promise.allSettled(jobs);
      for (const row of rows) row.classification = classifyRuntimeDiagnostic(row, cell.result.model);
      if (cell.result.status !== 'PASS' || rows.some(r => r.classification === 'BLOCKING_DIAGNOSTIC')
        || !rows.some(r => r.type === 'worker-created' && r.url.endsWith('/worker.js'))) throw new Error('CONTROLLER_OR_BROWSER_DIAGNOSTIC_FAILED');
      cell.state = 'PASS'; cell.completedAt = at(); console.log('PASS', cell.rate, cell.scenario, 'model runs', cell.result.actualModelRuns);
    } finally { await context.close(); }
  }
} catch (error) {
  failure = String(error.stack ?? error); if (activeCell) { activeCell.state = 'FAILED'; activeCell.error = failure; }
  console.error(BLOCKED, failure); process.exitCode = 1;
} finally {
  await browser?.close(); await new Promise(resolve => server.close(resolve));
  const disposition = cells.every(c => c.state === 'PASS') ? SUCCESS : BLOCKED;
  await newJson(path.join(work, 'browser.json'), { proof, executionStartedAt, completedAt: at(), browser: browserIdentity, disposition,
    status: cells.every(c => c.state === 'PASS') ? 'PASS' : 'PARTIAL_EXECUTION_BLOCKED', cells, diagnostics, failure, requests, bundles,
    actualModelRuns: cells.reduce((n, c) => n + (c.result?.actualModelRuns ?? 0), 0),
    modelRunCountComplete: cells.filter(c => c.state !== 'NOT_STARTED').every(c => Boolean(c.result)),
    model: await fileIdentity(MODEL), fixture: await fileIdentity(FIXTURE), productionMicrophone: false, realDevice: 'NOT_PERFORMED' });
  console.log(disposition);
}
