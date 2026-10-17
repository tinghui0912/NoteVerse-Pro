import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { ROOT, APP, WORK, verify, newJson } from './continuous-application-protocol.mjs';
import { RUNTIME_NODE_MODULES, resolveBrandedBrowserExecutable } from '../../../backend/research/browser_runtime/xc1_browser_runtime_shared.mjs';

const proof = await verify(), work = path.join(WORK, 'clock-gate-v1'); await mkdir(work, { recursive: true });
const esbuild = await import(pathToFileURL(path.join(ROOT, 'backend/data/work/basic_pitch_browser_feasibility/node_modules/esbuild/lib/main.js')).href);
await esbuild.build({ entryPoints: [path.join(APP, 'scripts/continuous-clock-contract-entry.ts')], outfile: path.join(work, 'entry.js'),
  bundle: true, platform: 'browser', format: 'esm', target: 'es2022', logLevel: 'silent' });
const server = createServer((request, response) => {
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin'); response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  if (request.url === '/') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Pre-controller clock contract gate</title><script type="module" src="/entry.js"></script>'); return; }
  if (request.url === '/favicon.ico') { response.statusCode = 204; response.end(); return; }
  const file = request.url === '/entry.js' ? path.join(work, 'entry.js') : request.url === '/capture.worklet.js'
    ? path.join(APP, 'src/lib/practice/acoustic/source/capture.worklet.js') : null;
  if (!file) { response.statusCode = 403; response.end(); return; }
  response.setHeader('Content-Type', 'text/javascript'); createReadStream(file).pipe(response);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
const results = [], diagnostics = [];
try {
  const require = createRequire(import.meta.url), { chromium } = require(path.join(RUNTIME_NODE_MODULES, 'playwright'));
  const executablePath = resolveBrandedBrowserExecutable('chrome');
  browser = await chromium.launch({ executablePath, headless: false, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${path.join(ROOT, 'backend/data/work/xc6_capture/fake-device.wav')}`] });
  const executionStartedAt = new Date().toISOString();
  for (const rate of [44100, 48000]) {
    const context = await browser.newContext(), page = await context.newPage();
    const rows = []; diagnostics.push({ rate, rows });
    page.on('console', message => rows.push({ type: message.type(), text: message.text(), location: message.location() }));
    page.on('pageerror', error => rows.push({ type: 'pageerror', message: error.message, stack: error.stack }));
    try {
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      const pending = page.evaluate(rate => window.probeContinuousClock(rate), rate); pending.catch(() => {});
      await Promise.race([page.waitForFunction(() => window.clockProbeAssetsReady, undefined, { timeout: 10000 }),
        pending.then(() => { throw new Error('PROBE_ENDED_BEFORE_READY'); })]);
      await context.setOffline(true);
      const result = await pending; results.push(result);
      if (result.status === 'CONTINUOUS_CAPTURE_CLOCK_CONTRACT_BLOCKED') break;
    } finally { await context.close(); }
  }
  await newJson(path.join(WORK, 'clock_gate_result_v1.json'), { proof, executionStartedAt, completedAt: new Date().toISOString(),
    browser: { executablePath, version: await browser.version(), headed: true, playwright: require(path.join(RUNTIME_NODE_MODULES, 'playwright/package.json')).version },
    results, diagnostics, status: results.some(r => r.status === 'CONTINUOUS_CAPTURE_CLOCK_CONTRACT_BLOCKED')
      ? 'CONTINUOUS_CAPTURE_CLOCK_CONTRACT_BLOCKED' : 'CLOCK_GATE_PASS_ONLY_NOT_APPLICATION_ACCEPTANCE',
    newNeuralInferenceCount: 0, realDeviceProbe: 'NOT_PERFORMED', productionMicrophone: false });
  console.log(JSON.stringify(results));
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
