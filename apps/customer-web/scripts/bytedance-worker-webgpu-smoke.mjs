#!/usr/bin/env node
// Development/research smoke harness for the production ByteDance browser Worker.
//
// This intentionally exercises createByteDanceBrowserWorkerClient(), which in
// turn constructs the Vite/Next-visible module Worker entry. It does not copy or
// commit the ONNX model; pass a local or staged asset path with --model.

import crypto from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, rm, writeFile, readFile } from 'node:fs/promises';
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
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key.slice(2)] = true;
    } else {
      args[key.slice(2)] = next;
      i += 1;
    }
  }
  return args;
}

const args = parseArgs(process.argv);
const modelPath = path.resolve(args.model ?? '');
const fixtureDir = path.resolve(args['fixture-dir'] ?? '');
const outputPath = args.output ? path.resolve(args.output) : null;
const directReportPath = args['direct-report'] ? path.resolve(args['direct-report']) : null;
const warmRuns = Number(args['warm-runs'] ?? 5);
const browserChannel = typeof args['browser-channel'] === 'string' ? args['browser-channel'] : 'chrome';
const headed = Object.prototype.hasOwnProperty.call(args, 'headed');

if (!existsSync(modelPath)) throw new Error(`Missing --model: ${modelPath}`);
if (!existsSync(fixtureDir)) throw new Error(`Missing --fixture-dir: ${fixtureDir}`);
if (!Number.isFinite(warmRuns) || warmRuns < 1) throw new Error('--warm-runs must be a positive number');

const modelStats = await statAndHash(modelPath);
if (modelStats.byteSize !== EXPECTED_MODEL_SIZE) {
  throw new Error(`Model byte size mismatch: expected ${EXPECTED_MODEL_SIZE}, got ${modelStats.byteSize}`);
}
if (modelStats.sha256 !== EXPECTED_MODEL_SHA256) {
  throw new Error(`Model SHA256 mismatch: expected ${EXPECTED_MODEL_SHA256}, got ${modelStats.sha256}`);
}

const tempDir = path.join(repoRoot, 'tmp', `bytedance-worker-webgpu-smoke-${process.pid}`);
await rm(tempDir, { recursive: true, force: true });
await mkdir(tempDir, { recursive: true });

const browserErrors = [];
const browserWarnings = [];

try {
  await writeFile(path.join(tempDir, 'index.html'), html(), 'utf8');
  await writeFile(path.join(tempDir, 'entry.ts'), entrySource({
    modelSize: modelStats.byteSize,
    modelSha256: modelStats.sha256,
    warmRuns,
  }), 'utf8');

  const vite = await createViteServer({
    root: tempDir,
    logLevel: 'error',
    plugins: [{
      name: 'bytedance-worker-smoke-assets',
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
            if (url.pathname.startsWith('/fixtures/')) {
              const rel = decodeURIComponent(url.pathname.slice('/fixtures/'.length));
              serveFile(res, path.join(fixtureDir, rel), mimeType(path.extname(rel)));
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
  const viteAddress = vite.httpServer?.address();
  if (!viteAddress || typeof viteAddress === 'string') {
    throw new Error('Vite server did not expose a TCP address.');
  }

  const launchOptions = {
    headless: !headed,
    args: ['--enable-unsafe-webgpu'],
  };
  if (browserChannel) {
    launchOptions.channel = browserChannel;
  }
  const browser = await chromium.launch(launchOptions);
  try {
    const page = await browser.newPage();
    page.on('console', (message) => {
      const text = `${message.type()}: ${message.text()}`;
      if (message.type() === 'error') {
        browserErrors.push(text);
      } else if (message.type() === 'warning') {
        browserWarnings.push(text);
      }
    });
    page.on('pageerror', (error) => {
      browserErrors.push(error.stack ?? error.message);
    });

    await page.goto(`http://127.0.0.1:${viteAddress.port}/index.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__RESULT__ || window.__ERROR__, null, { timeout: 300000 });
    const pageResult = await page.evaluate(() => ({
      result: window.__RESULT__ ?? null,
      error: window.__ERROR__ ?? null,
    }));

    const directReport = directReportPath && existsSync(directReportPath)
      ? JSON.parse(await readFile(directReportPath, 'utf8'))
      : null;

    const report = {
      testedGitSha: await gitSha(),
      smokeCommand: process.argv.join(' '),
      harnessPath: path.relative(repoRoot, __filename).replaceAll(path.sep, '/'),
      model: {
        filename: path.basename(modelPath),
        byteSize: modelStats.byteSize,
        sha256: modelStats.sha256,
      },
      runtime: {
        browserChannel,
        headed,
        browserVersion: browser.version(),
        os: {
          platform: os.platform(),
          release: os.release(),
          arch: os.arch(),
        },
      },
      productionWorkerFactoryUsed: pageResult.result?.productionWorkerFactoryUsed ?? false,
      workerSmoke: pageResult.result,
      directFeasibilityReport: summarizeDirectReport(directReport),
      browserConsole: {
        errors: browserErrors,
        warnings: browserWarnings,
      },
      error: pageResult.error,
    };

    if (outputPath) {
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    }
    console.log(JSON.stringify(report, null, 2));
    if (pageResult.error) {
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
    await vite.close();
  }
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

function html() {
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><title>ByteDance Production Worker WebGPU Smoke</title></head>
<body>
<pre id="status">running</pre>
<script type="module" src="/entry.ts"></script>
</body>
</html>`;
}

function entrySource(config) {
  return `
import {
  BYTEDANCE_INPUT_DESCRIPTOR,
  createByteDanceBrowserWorkerClient,
  defaultByteDanceModelManifest,
} from '../../apps/customer-web/src/lib/practice/acoustic-inference';

const CONFIG = ${JSON.stringify(config)};

function parseNpy(buffer) {
  const bytes = new Uint8Array(buffer);
  const magic = String.fromCharCode(...bytes.slice(0, 6));
  if (magic !== '\\x93NUMPY') throw new Error('not an npy file');
  const major = bytes[6];
  let headerLen;
  let offset;
  if (major === 1) {
    headerLen = bytes[8] | (bytes[9] << 8);
    offset = 10;
  } else if (major === 2) {
    headerLen = bytes[8] | (bytes[9] << 8) | (bytes[10] << 16) | (bytes[11] << 24);
    offset = 12;
  } else {
    throw new Error('unsupported npy version ' + major);
  }
  const header = new TextDecoder('latin1').decode(bytes.slice(offset, offset + headerLen));
  if (!header.includes("'descr': '<f4'") && !header.includes('"descr": "<f4"')) {
    throw new Error('only little-endian float32 npy is supported: ' + header);
  }
  const shapeMatch = header.match(/'shape': \\(([^)]*)\\)/) || header.match(/"shape": \\[([^\\]]*)\\]/);
  if (!shapeMatch) throw new Error('cannot parse npy shape: ' + header);
  const shape = shapeMatch[1].split(',').map((part) => part.trim()).filter(Boolean).map(Number);
  return { shape, data: new Float32Array(buffer, offset + headerLen) };
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('fetch failed: ' + url);
  return response.json();
}

async function fetchNpy(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('fetch failed: ' + url);
  return parseNpy(await response.arrayBuffer());
}

function percentile(values, q) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * q) - 1));
  return sorted[index];
}

async function webgpuInfo() {
  if (!navigator.gpu) {
    return { available: false, adapterAcquired: false, adapter: null };
  }
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    return { available: true, adapterAcquired: false, adapter: null };
  }
  let info = null;
  try {
    if (typeof adapter.requestAdapterInfo === 'function') {
      info = await adapter.requestAdapterInfo();
    } else if (adapter.info) {
      info = adapter.info;
    }
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
  const fixturesManifest = await fetchJson('/fixtures/manifest.json');
  const fixture = fixturesManifest.fixtures[0];
  const input = await fetchNpy('/fixtures/' + fixture.input_tensor_npy);
  if (input.shape[0] !== BYTEDANCE_INPUT_DESCRIPTOR.shape[1]) {
    throw new Error('fixture input shape does not match ByteDance input descriptor');
  }

  const client = createByteDanceBrowserWorkerClient();
  const manifest = defaultByteDanceModelManifest({
    modelUrl: '/model.onnx',
    expectedByteSize: CONFIG.modelSize,
    sha256: CONFIG.modelSha256,
  });

  const loadStart = performance.now();
  const loadDiagnostics = await client.load(manifest);
  const loadEnd = performance.now();

  const makeRequest = (requestId) => ({
    requestId,
    pcm: input.data,
    sampleRateHz: 16000,
    channelCount: 1,
    captureStartSampleIndex: 0,
    captureStartTime: { domainId: 'worker-smoke', ms: 0, sampleIndex: 0 },
    inferenceRequestedAtMs: performance.now(),
  });

  const firstStart = performance.now();
  const first = await client.infer(makeRequest('first'));
  const firstEnd = performance.now();

  const warm = [];
  for (let index = 0; index < CONFIG.warmRuns; index += 1) {
    const started = performance.now();
    const result = await client.infer(makeRequest('warm-' + index));
    const ended = performance.now();
    warm.push({
      index,
      endToEndMs: ended - started,
      workerTimingMs: result.diagnostics?.timingMs ?? null,
      messageAndClientOverheadMs:
        result.diagnostics?.timingMs ? (ended - started) - result.diagnostics.timingMs.workerTotal : null,
      eventCount: result.events.length,
    });
  }

  await client.dispose();

  return {
    productionWorkerFactoryUsed: true,
    userAgent: navigator.userAgent,
    webgpu,
    load: {
      clientEndToEndMs: loadEnd - loadStart,
      diagnostics: loadDiagnostics ?? null,
    },
    input: {
      tensorName: BYTEDANCE_INPUT_DESCRIPTOR.name,
      dtype: BYTEDANCE_INPUT_DESCRIPTOR.dtype,
      shape: BYTEDANCE_INPUT_DESCRIPTOR.shape,
      fixtureId: fixture.fixture_id,
      inputTensorNpy: fixture.input_tensor_npy,
      expectedPitches: fixture.expected_pitches,
    },
    firstInference: {
      clientEndToEndMs: firstEnd - firstStart,
      diagnostics: first.diagnostics ?? null,
      eventCount: first.events.length,
      firstEvents: first.events.slice(0, 10),
    },
    warmInference: {
      runs: warm.length,
      samples: warm,
      medianEndToEndMs: percentile(warm.map((item) => item.endToEndMs), 0.5),
      p95EndToEndMs: percentile(warm.map((item) => item.endToEndMs), 0.95),
      medianWorkerOnnxMs: percentile(
        warm.map((item) => item.workerTimingMs?.onnxInference).filter((value) => typeof value === 'number'),
        0.5
      ),
    },
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

function mimeType(ext) {
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.npy' || ext === '.onnx') return 'application/octet-stream';
  return 'application/octet-stream';
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

async function gitSha() {
  const { execFile } = await import('node:child_process');
  return new Promise((resolve) => {
    execFile('git', ['rev-parse', 'HEAD'], { cwd: repoRoot }, (error, stdout) => {
      resolve(error ? null : stdout.trim());
    });
  });
}

function summarizeDirectReport(report) {
  if (!report) return null;
  const result = report.result ?? report;
  return {
    sourcePath: directReportPath ? path.relative(repoRoot, directReportPath).replaceAll(path.sep, '/') : null,
    backend: result.backend ?? null,
    browserVersion: report.runtime?.browser_version ?? null,
    userAgent: result.user_agent ?? null,
    webgpuAdapter: result.webgpu_adapter ?? null,
    modelLoadMs: result.model_load_ms ?? null,
    firstInferenceMs: result.first_inference_ms ?? null,
    warmInferenceMs: result.warm_inference_ms ?? null,
    comparisons: result.comparisons ?? null,
    error: report.error ?? null,
  };
}
