#!/usr/bin/env node
// Development smoke for the browser-local live capture path.
//
// This uses a real AudioContext + AudioWorklet with a deterministic oscillator
// source, then feeds the production ByteDance Worker client. It intentionally
// avoids getUserMedia so it can run without physical microphone permission.

import crypto from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import playwright from '../node_modules/playwright/index.js';
import { createServer as createViteServer } from '../node_modules/vite/dist/node/index.js';

const { chromium } = playwright;

const EXPECTED_MODEL_SIZE = 98_691_493;
const EXPECTED_MODEL_SHA256 = '6ba3bc4e73607f9cd021e69858fd3ff969a3941c7a93876d5be5cedb53038cf5';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const customerWebRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(customerWebRoot, '..', '..');

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key.slice(2)] = true;
    } else {
      args[key.slice(2)] = next;
      index += 1;
    }
  }
  return args;
}

const args = parseArgs(process.argv);
const modelPath = path.resolve(args.model ?? '');
const outputPath = args.output ? path.resolve(args.output) : null;
const browserChannel = typeof args['browser-channel'] === 'string' ? args['browser-channel'] : 'chrome';
const headed = Object.prototype.hasOwnProperty.call(args, 'headed');
const timeoutMs = Number(args.timeout ?? 30_000);

if (!existsSync(modelPath)) throw new Error(`Missing --model: ${modelPath}`);

const modelStats = await statAndHash(modelPath);
if (modelStats.byteSize !== EXPECTED_MODEL_SIZE) {
  throw new Error(`Model byte size mismatch: expected ${EXPECTED_MODEL_SIZE}, got ${modelStats.byteSize}`);
}
if (modelStats.sha256 !== EXPECTED_MODEL_SHA256) {
  throw new Error(`Model SHA256 mismatch: expected ${EXPECTED_MODEL_SHA256}, got ${modelStats.sha256}`);
}

const tempDir = path.join(repoRoot, 'tmp', `bytedance-live-capture-smoke-${process.pid}`);
await rm(tempDir, { recursive: true, force: true });
await mkdir(tempDir, { recursive: true });

const browserErrors = [];
const browserWarnings = [];

try {
  await writeFile(path.join(tempDir, 'index.html'), html(), 'utf8');
  await writeFile(path.join(tempDir, 'entry.ts'), entrySource({
    liveModule: viteFsPath(path.join(repoRoot, 'apps/customer-web/src/lib/practice/acoustic-inference/live-capture.ts')),
    workerFactory: viteFsPath(path.join(repoRoot, 'apps/customer-web/src/lib/practice/acoustic-inference/bytedance-worker-factory.ts')),
    contract: viteFsPath(path.join(repoRoot, 'apps/customer-web/src/lib/practice/acoustic-inference/bytedance-contract.ts')),
    worklet: viteFsPath(path.join(repoRoot, 'apps/customer-web/src/lib/practice/acoustic-inference/bytedance-capture.worklet.js')),
    modelSize: modelStats.byteSize,
    modelSha256: modelStats.sha256,
  }), 'utf8');

  const vite = await createViteServer({
    root: tempDir,
    logLevel: 'error',
    plugins: [{
      name: 'bytedance-live-capture-smoke-assets',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          try {
            const url = new URL(req.url ?? '/', 'http://127.0.0.1');
            if (url.pathname === '/favicon.ico') {
              res.statusCode = 204;
              res.end();
              return;
            }
            if (url.pathname === '/model.onnx') {
              serveFile(res, modelPath, 'application/octet-stream');
              return;
            }
            next();
          } catch (error) {
            res.statusCode = 500;
            res.end(String(error instanceof Error ? error.stack : error));
          }
        });
      },
    }],
    server: {
      host: '127.0.0.1',
      strictPort: false,
      fs: {
        allow: [repoRoot, tempDir],
      },
    },
    optimizeDeps: {
      exclude: ['onnxruntime-web'],
    },
  });

  await vite.listen();
  const address = vite.httpServer?.address();
  if (!address || typeof address === 'string') {
    throw new Error('Vite server did not expose a TCP address.');
  }

  const browser = await chromium.launch({
    channel: browserChannel,
    headless: !headed,
    args: ['--enable-unsafe-webgpu'],
  });
  let result;
  try {
    const page = await browser.newPage();
    page.on('console', (message) => {
      const text = `${message.type()}: ${message.text()}`;
      if (message.type() === 'error') browserErrors.push(text);
      if (message.type() === 'warning') browserWarnings.push(text);
    });
    page.on('pageerror', (error) => browserErrors.push(String(error.stack ?? error)));
    await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__RESULT__ || window.__ERROR__, null, { timeout: timeoutMs });
    const pageError = await page.evaluate(() => window.__ERROR__ ?? null);
    if (pageError) throw new Error(pageError);
    result = await page.evaluate(() => window.__RESULT__);
  } finally {
    await browser.close();
    await vite.close();
  }

  const report = {
    generatedAt: new Date().toISOString(),
    gitHead: await gitHead(),
    command: process.argv.join(' '),
    harness: 'apps/customer-web/scripts/bytedance-live-capture-smoke.mjs',
    model: {
      filename: path.basename(modelPath),
      byteSize: modelStats.byteSize,
      sha256: modelStats.sha256,
    },
    browser: {
      channel: browserChannel,
      headed,
    },
    os: {
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
    },
    result,
    browserErrors,
    browserWarnings,
  };
  if (outputPath) {
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }
  console.log(JSON.stringify(report, null, 2));
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

function html() {
  return `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>ByteDance live capture smoke</title></head>
  <body>
    <pre id="status">running</pre>
    <script type="module" src="/entry.ts"></script>
  </body>
</html>`;
}

function entrySource(config) {
  return `
import {
  LiveByteDanceRollingPipeline,
  StreamingLinearResampler,
  createLiveCaptureTimebase,
} from '${config.liveModule}';
import { createByteDanceBrowserWorkerClient } from '${config.workerFactory}';
import { defaultByteDanceModelManifest } from '${config.contract}';

const CONFIG = ${JSON.stringify(config)};

async function webgpuInfo() {
  if (!navigator.gpu) return { available: false, adapterAcquired: false };
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) return { available: true, adapterAcquired: false };
  let info = null;
  try {
    info = typeof adapter.requestAdapterInfo === 'function'
      ? await adapter.requestAdapterInfo()
      : null;
  } catch (error) {
    info = { error: String(error && error.stack ? error.stack : error) };
  }
  return {
    available: true,
    adapterAcquired: true,
    adapter: {
      isFallbackAdapter: adapter.isFallbackAdapter ?? null,
      features: Array.from(adapter.features ?? []),
      limits: adapter.limits ? {
        maxBufferSize: adapter.limits.maxBufferSize,
        maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
        maxComputeWorkgroupStorageSize: adapter.limits.maxComputeWorkgroupStorageSize,
      } : null,
      info,
    },
  };
}

async function main() {
  const webgpu = await webgpuInfo();
  const realClient = createByteDanceBrowserWorkerClient();
  const timings = { loadMs: null, inferences: [] };
  const client = {
    async load(manifest) {
      const started = performance.now();
      const diagnostics = await realClient.load(manifest);
      timings.loadMs = performance.now() - started;
      return diagnostics;
    },
    async infer(input) {
      const started = performance.now();
      const result = await realClient.infer(input);
      timings.inferences.push({
        requestId: input.requestId,
        anchorStartSample: input.captureStartSampleIndex,
        endToEndMs: performance.now() - started,
        diagnostics: result.diagnostics ?? null,
        eventCount: result.events.length,
        events: result.events.slice(0, 10),
      });
      return result;
    },
    async dispose() {
      try {
        await realClient.dispose();
      } catch (error) {
        if (String(error instanceof Error ? error.message : error).includes('active inference')) {
          realClient.terminate('Live capture smoke stopped during active inference.');
          return;
        }
        throw error;
      }
    },
    terminate: (reason) => realClient.terminate(reason),
  };

  const captureDomainId = 'live-smoke-domain';
  const timebase = createLiveCaptureTimebase({ captureDomainId });
  const pipeline = new LiveByteDanceRollingPipeline({
    manifest: defaultByteDanceModelManifest({
      modelUrl: '/model.onnx',
      expectedByteSize: CONFIG.modelSize,
      sha256: CONFIG.modelSha256,
    }),
    sessionTimebase: timebase,
    sourceSampleRateHz: 48_000,
    workerClient: client,
  });
  await pipeline.start();

  const audio = new AudioContext();
  await audio.audioWorklet.addModule('${config.worklet}');
  const resampler = new StreamingLinearResampler(audio.sampleRate);
  const node = new AudioWorkletNode(audio, 'noteverse-bytedance-capture');
  const gain = audio.createGain();
  gain.gain.value = 0;
  const oscillator = audio.createOscillator();
  oscillator.frequency.value = 440;
  oscillator.connect(node);
  node.connect(gain);
  gain.connect(audio.destination);

  const chunks = [];
  let monotonic = true;
  let expectedSourceStart = 0;
  node.port.onmessage = (event) => {
    const message = event.data;
    if (message.type !== 'pcm-chunk') return;
    if (message.sourceStartSampleIndex !== expectedSourceStart) monotonic = false;
    expectedSourceStart = message.sourceEndSampleIndex;
    const normalized = resampler.append({
      samples: message.samples,
      sourceStartSampleIndex: message.sourceStartSampleIndex,
    });
    chunks.push({
      sourceStartSampleIndex: message.sourceStartSampleIndex,
      sourceEndSampleIndex: message.sourceEndSampleIndex,
      normalizedStartSampleIndex: normalized.startSampleIndex,
      normalizedEndSampleIndex: normalized.endSampleIndex,
    });
    if (normalized.samples.length > 0) {
      pipeline.appendNormalizedPcm(normalized.samples, normalized.startSampleIndex);
    }
  };

  oscillator.start();
  await new Promise((resolve, reject) => {
    const deadline = performance.now() + 20_000;
    const poll = () => {
      if (timings.inferences.length > 0) {
        resolve();
        return;
      }
      if (performance.now() > deadline) {
        reject(new Error('Timed out waiting for one live Worker inference.'));
        return;
      }
      setTimeout(poll, 50);
    };
    poll();
  });
  oscillator.stop();
  await audio.close();
  await pipeline.stop();

  return {
    userAgent: navigator.userAgent,
    webgpu,
    audioContextSampleRate: audio.sampleRate,
    workletChunks: chunks.length,
    workletSampleContinuity: monotonic,
    firstChunks: chunks.slice(0, 5),
    lastChunk: chunks[chunks.length - 1] ?? null,
    pipelineState: pipeline.snapshot(),
    timings,
  };
}

main().then((result) => {
  window.__RESULT__ = result;
  document.getElementById('status').textContent = JSON.stringify(result, null, 2);
}).catch((error) => {
  window.__ERROR__ = String(error && error.stack ? error.stack : error);
  document.getElementById('status').textContent = window.__ERROR__;
});
`;
}

function serveFile(res, filePath, contentType) {
  res.setHeader('Content-Type', contentType);
  createReadStream(filePath).pipe(res);
}

async function statAndHash(filePath) {
  const hash = crypto.createHash('sha256');
  let byteSize = 0;
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => {
      byteSize += chunk.length;
      hash.update(chunk);
    });
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return { byteSize, sha256: hash.digest('hex') };
}

async function gitHead() {
  const { execFile } = await import('node:child_process');
  return new Promise((resolve) => {
    execFile('git', ['rev-parse', 'HEAD'], { cwd: repoRoot }, (error, stdout) => {
      resolve(error ? null : stdout.trim());
    });
  });
}

function viteFsPath(filePath) {
  return `/@fs/${filePath.replace(/\\/g, '/')}`;
}
