import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, APP, WORK, MODEL, FIXTURE, newJson, verifyRemoteFreeze, fileIdentity } from './continuous-runtime-protocol.mjs';
import { resolveBrandedBrowserExecutable, RUNTIME_NODE_MODULES, collectWebGpuAdapter } from '../../../backend/research/browser_runtime/xc1_browser_runtime_shared.mjs';

export async function buildCaptureBundle(id) {
  const work = path.join(WORK, id); await mkdir(work, { recursive: true });
  const esbuild = await import(pathToFileURL(path.join(ROOT, 'backend/data/work/basic_pitch_browser_feasibility/node_modules/esbuild/lib/main.js')).href);
  for (const [entry, output] of [
    ['scripts/continuous-capture-qualification-entry.ts', 'entry.js'],
    ['src/lib/practice/acoustic-inference/continuous/acoustic-worker.entry.ts', 'worker.js'],
  ]) await esbuild.build({ entryPoints: [path.join(APP, entry)], outfile: path.join(work, output), bundle: true,
    format: 'esm', platform: 'browser', target: 'es2022', sourcemap: 'inline', logLevel: 'silent',
    plugins: [{ name: 'pinned-ort-bootstrap', setup(build) {
      build.onResolve({ filter: /^onnxruntime-web\/webgpu$/ }, () => ({ path: '/ort/ort.webgpu.min.mjs', external: true }));
    } }], nodePaths: [path.join(APP, 'node_modules')] });
  return work;
}
async function qualify(id) {
  const proof = await verifyRemoteFreeze(id), executionStartedAt = new Date().toISOString();
  const work = await buildCaptureBundle(id);
  const requests = [], files = new Map([
    ['/entry.js', path.join(work, 'entry.js')], ['/worker.js', path.join(work, 'worker.js')],
    ['/model.onnx', path.join(ROOT, MODEL)],
    ['/capture.worklet.js', path.join(APP, 'src/lib/practice/acoustic-inference/continuous/capture.worklet.js')],
    ['/fir-44100.f32', path.join(APP, 'public/model-assets/continuous/fir-160-441.f32')],
    ['/fir-48000.f32', path.join(APP, 'public/model-assets/continuous/fir-1-3.f32')],
  ]);
  const server = createServer((req, res) => {
    const url = req.url?.split('?')[0]; requests.push({ url, timestamp: new Date().toISOString() });
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin'); res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    if (url === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Disabled Continuous runtime qualification</title><script type="module" src="/entry.js"></script>'); return; }
    if (url === '/favicon.ico') { res.statusCode = 204; res.end(); return; }
    const file = files.get(url) ?? (/^\/ort\/[\w.-]+\.(mjs|wasm)$/.test(url) ? path.join(APP, 'node_modules/onnxruntime-web/dist', path.basename(url)) : null);
    if (!file) { res.statusCode = 403; res.end('ASSET_ONLY'); return; }
    res.setHeader('Content-Type', file.endsWith('.wasm') ? 'application/wasm' : /\.(js|mjs)$/.test(file) ? 'text/javascript' : 'application/octet-stream');
    createReadStream(file).on('error', () => { res.statusCode = 404; res.end(); }).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  const results = [], diagnostics = [];
  try {
    const require = createRequire(import.meta.url), { chromium } = require(path.join(RUNTIME_NODE_MODULES, 'playwright'));
    const executablePath = resolveBrandedBrowserExecutable('chrome');
    if (!executablePath) throw new Error('BRANDED_CHROME_UNAVAILABLE');
    browser = await chromium.launch({ executablePath, headless: false, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${path.join(ROOT, FIXTURE)}`] });
    const browserIdentity = { executablePath, version: await browser.version(), headed: true, node: process.version,
      playwright: require(path.join(RUNTIME_NODE_MODULES, 'playwright/package.json')).version };
    for (const rate of [44100, 48000]) {
      const context = await browser.newContext(); const page = await context.newPage();
      const rows = [], jobs = []; const at = () => new Date().toISOString();
      diagnostics.push({ rate, rows });
      page.on('console', message => {
        const row = { type: message.type(), timestamp: at(), text: message.text(), location: message.location(), origin: page.url() };
        rows.push(row); jobs.push(Promise.all(message.args().map(arg => arg.evaluate(v => v instanceof Error ? { message: v.message, stack: v.stack } : null).catch(() => null))).then(v => { row.errorArguments = v; }));
      });
      page.on('pageerror', error => rows.push({ type: 'pageerror', timestamp: at(), message: error.message, stack: error.stack }));
      page.on('worker', worker => rows.push({ type: 'worker-created', url: worker.url(), timestamp: at() }));
      page.on('requestfailed', request => rows.push({ type: 'requestfailed', timestamp: at(), url: request.url(), error: request.failure() }));
      page.on('response', response => { if (response.status() >= 400) rows.push({ type: 'failed-response', url: response.url(), status: response.status(), timestamp: at() }); });
      try {
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        const gpu = await collectWebGpuAdapter(page);
        const pending = page.evaluate(rate => window.runContinuousCaptureQualification(rate), rate);
        // Attach a rejection handler immediately while waiting for the assets-ready barrier.
        pending.catch(() => {});
        await Promise.race([
          page.waitForFunction(() => window.continuousAssetsReady === true, undefined, { timeout: 120000 }),
          pending.then(() => { throw new Error('QUALIFICATION_ENDED_BEFORE_OFFLINE_BARRIER'); }),
        ]);
        const offlineAt = at(); await context.setOffline(true);
        const result = await pending;
        await Promise.allSettled(jobs);
        results.push({ rate, offlineAt, result, gpu });
        if (result.status !== 'PASS') throw new Error('BROWSER_QUALIFICATION_FAILED');
        if (rows.some(row => ['error', 'pageerror', 'failed-response', 'requestfailed'].includes(row.type))) throw new Error('UNRESOLVED_BROWSER_DIAGNOSTIC');
      } finally { await context.close(); }
    }
    await newJson(path.join(work, 'browser_qualification.json'), { proof, executionStartedAt, completedAt: new Date().toISOString(),
      status: 'PASS', browser: browserIdentity, model: await fileIdentity(MODEL), fixture: await fileIdentity(FIXTURE),
      results, diagnostics, serverRequests: requests, actualModelRuns: results.reduce((n, r) => n + r.result.snapshot.diagnostics.at(-1).actualSessionRunCount, 0),
      realDeviceProbe: 'NOT_PERFORMED', productionMicrophone: false, scientificAccuracyScoring: false });
    console.log(JSON.stringify({ status: 'PASS', rates: results.map(r => r.rate), actualModelRuns: 4 }));
  } catch (error) {
    await newJson(path.join(work, 'browser_failure.json'), { proof, executionStartedAt, failedAt: new Date().toISOString(),
      error: String(error.stack ?? error), completedResults: results, diagnostics, serverRequests: requests });
    throw error;
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
}
const id = process.argv[3] ?? 'v1';
if (process.argv[2] === 'build') console.log(await buildCaptureBundle(id));
else if (process.argv[2] === 'run') await qualify(id);
