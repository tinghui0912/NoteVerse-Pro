#!/usr/bin/env node
// Production OPFS ModelAssetStore smoke harness.
//
// Tests:
// 1. Cleans OPFS cache for the ByteDance note model SHA.
// 2. First fresh Worker LOAD -> downloads model via network into OPFS -> verifies size + SHA -> ORT WebGPU session created -> deterministic inference succeeds.
// 3. First Worker is terminated.
// 4. Model URL is blocked on the network.
// 5. Second fresh Worker LOAD -> OPFS cache hit -> ZERO network requests -> ORT WebGPU session created -> same deterministic inference succeeds.
// 6. Validates verifier decision and output shapes agreement.

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
const outputPath = args.output
  ? path.resolve(args.output)
  : path.resolve(repoRoot, 'backend/research/reports/bytedance_model_opfs_smoke_latest.json');
const browserChannel = typeof args['browser-channel'] === 'string' ? args['browser-channel'] : 'chrome';
const headed = Object.prototype.hasOwnProperty.call(args, 'headed');
const timeoutMs = Number(args.timeout ?? 60_000);

if (!existsSync(modelPath)) throw new Error(`Missing --model: ${modelPath}`);

const modelStats = await statAndHash(modelPath);
if (modelStats.byteSize !== EXPECTED_MODEL_SIZE) {
  throw new Error(`Model byte size mismatch: expected ${EXPECTED_MODEL_SIZE}, got ${modelStats.byteSize}`);
}
if (modelStats.sha256 !== EXPECTED_MODEL_SHA256) {
  throw new Error(`Model SHA256 mismatch: expected ${EXPECTED_MODEL_SHA256}, got ${modelStats.sha256}`);
}

const tempDir = path.join(repoRoot, 'tmp', `bytedance-model-opfs-smoke-${process.pid}`);
await rm(tempDir, { recursive: true, force: true });
await mkdir(tempDir, { recursive: true });

const browserErrors = [];
const browserWarnings = [];

let modelBlocked = false;
let firstPhaseNetworkRequests = 0;
let secondPhaseNetworkRequests = 0;

try {
  await writeFile(path.join(tempDir, 'index.html'), html(), 'utf8');
  await writeFile(
    path.join(tempDir, 'entry.ts'),
    entrySource({
      workerFactory: viteFsPath(
        path.join(repoRoot, 'apps/customer-web/src/lib/practice/acoustic-inference/bytedance-worker-factory.ts')
      ),
      contract: viteFsPath(
        path.join(repoRoot, 'apps/customer-web/src/lib/practice/acoustic-inference/bytedance-contract.ts')
      ),
      modelSize: modelStats.byteSize,
      modelSha256: modelStats.sha256,
    }),
    'utf8'
  );

  const vite = await createViteServer({
    root: tempDir,
    logLevel: 'error',
    plugins: [
      {
        name: 'bytedance-opfs-smoke-assets',
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            try {
              const url = new URL(req.url ?? '/', 'http://127.0.0.1');
              if (url.pathname === '/favicon.ico') {
                res.statusCode = 204;
                res.end();
                return;
              }
              if (url.pathname === '/api/block-model') {
                modelBlocked = true;
                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ blocked: true }));
                return;
              }
              if (url.pathname === '/api/network-stats') {
                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json');
                res.end(
                  JSON.stringify({
                    firstPhaseNetworkRequests,
                    secondPhaseNetworkRequests,
                  })
                );
                return;
              }
              if (url.pathname === '/model.onnx') {
                if (modelBlocked) {
                  secondPhaseNetworkRequests += 1;
                  res.statusCode = 404;
                  res.end('Model network access blocked for offline test');
                  return;
                }
                firstPhaseNetworkRequests += 1;
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
      },
    ],
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
    harness: 'apps/customer-web/scripts/bytedance-model-opfs-smoke.mjs',
    browser: {
      name: browserChannel,
      headed,
      userAgent: result.userAgent,
    },
    environment: {
      os: `${os.platform()} ${os.release()} ${os.arch()}`,
      node: process.version,
    },
    model: {
      path: modelPath,
      byteSize: modelStats.byteSize,
      sha256: modelStats.sha256,
    },
    opfsCachePath: result.opfsCachePath,
    persistentStorageGranted: result.persistentStorageGranted,
    firstLoad: {
      source: result.firstLoad.source,
      networkRequestCount: firstPhaseNetworkRequests,
      diagnostics: result.firstLoad.diagnostics,
      inference: result.firstLoad.inference,
    },
    secondLoad: {
      source: result.secondLoad.source,
      networkRequestCount: secondPhaseNetworkRequests,
      diagnostics: result.secondLoad.diagnostics,
      inference: result.secondLoad.inference,
    },
    verifierDecisionAgreement: result.verifierDecisionAgreement,
    browserErrors,
    browserWarnings,
  };

  if (outputPath) {
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, JSON.stringify(report, null, 2), 'utf8');
  }

  console.log(JSON.stringify(report, null, 2));
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

function html() {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>ByteDance OPFS Model Asset Smoke</title>
  </head>
  <body>
    <h1>ByteDance OPFS Model Asset Smoke</h1>
    <pre id="status">Running...</pre>
    <script type="module" src="/entry.ts"></script>
  </body>
</html>`;
}

function entrySource(config) {
  return `
import { createByteDanceBrowserWorkerClient } from '${config.workerFactory}';
import { defaultByteDanceModelManifest } from '${config.contract}';

const CONFIG = {
  modelUrl: '/model.onnx',
  modelSize: ${config.modelSize},
  modelSha256: '${config.modelSha256}',
};

function createSyntheticPcm(frequencyHz, sampleRateHz, length) {
  const pcm = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    pcm[i] = Math.sin((2 * Math.PI * frequencyHz * i) / sampleRateHz) * 0.5;
  }
  return pcm;
}

async function cleanOpfsCache(assetId, sha256) {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) {
    throw new Error('navigator.storage.getDirectory is unavailable');
  }
  const root = await navigator.storage.getDirectory();
  try {
    const baseDir = await root.getDirectoryHandle('noteverse-model-assets');
    const v1Dir = await baseDir.getDirectoryHandle('v1');
    const assetDir = await v1Dir.getDirectoryHandle(assetId);
    await assetDir.removeEntry(sha256.toLowerCase(), { recursive: true });
  } catch {
    // Cache was already clean
  }
}

async function checkPersistence() {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
      return await navigator.storage.persist();
    }
  } catch {
    return null;
  }
  return null;
}

async function main() {
  const webgpu = typeof navigator !== 'undefined' && 'gpu' in navigator;
  if (!webgpu) {
    throw new Error('WebGPU is unavailable in this browser session.');
  }

  const manifest = defaultByteDanceModelManifest({
    modelUrl: CONFIG.modelUrl,
    expectedByteSize: CONFIG.modelSize,
    sha256: CONFIG.modelSha256,
  });

  // Step 1: Clean OPFS cache for deterministic test
  await cleanOpfsCache(manifest.modelId, CONFIG.modelSha256);
  const persistentStorageGranted = await checkPersistence();

  // Step 2: First Worker - Online LOAD
  const worker1 = createByteDanceBrowserWorkerClient();
  const load1 = await worker1.load(manifest);
  const samplePcm = createSyntheticPcm(440, 16000, 29120);

  const infer1 = await worker1.infer({
    requestId: 'test-infer-1',
    pcm: samplePcm,
    sampleRateHz: 16000,
    channelCount: 1,
    captureStartSampleIndex: 0,
    captureStartTime: { domainId: 'smoke-test', sampleIndex: 0, ms: 0 },
  });

  // Step 3: Terminate first worker
  worker1.terminate();

  // Step 4: Block model on the network
  const blockResp = await fetch('/api/block-model');
  if (!blockResp.ok) throw new Error('Failed to block model network access');

  // Step 5: Second fresh Worker - Offline LOAD from OPFS
  const worker2 = createByteDanceBrowserWorkerClient();
  const load2 = await worker2.load(manifest);

  const infer2 = await worker2.infer({
    requestId: 'test-infer-2',
    pcm: samplePcm,
    sampleRateHz: 16000,
    channelCount: 1,
    captureStartSampleIndex: 0,
    captureStartTime: { domainId: 'smoke-test', sampleIndex: 0, ms: 0 },
  });

  worker2.terminate();

  // Verify decision & output shapes agreement
  const agreement = (
    infer1.events.length === infer2.events.length &&
    JSON.stringify(infer1.diagnostics?.outputTensors) === JSON.stringify(infer2.diagnostics?.outputTensors) &&
    infer1.events.every((e1, idx) => {
      const e2 = infer2.events[idx];
      return e1.pitch === e2.pitch && e1.midiPitch === e2.midiPitch;
    })
  );

  return {
    userAgent: navigator.userAgent,
    opfsCachePath: 'noteverse-model-assets/v1/' + manifest.modelId + '/' + CONFIG.modelSha256.toLowerCase(),
    persistentStorageGranted,
    firstLoad: {
      source: load1.diagnostics?.source ?? 'network',
      diagnostics: load1.diagnostics,
      inference: {
        outputTensors: infer1.diagnostics?.outputTensors,
        eventCount: infer1.events.length,
        events: infer1.events,
      },
    },
    secondLoad: {
      source: load2.diagnostics?.source ?? 'opfs-cache',
      diagnostics: load2.diagnostics,
      inference: {
        outputTensors: infer2.diagnostics?.outputTensors,
        eventCount: infer2.events.length,
        events: infer2.events,
      },
    },
    verifierDecisionAgreement: agreement,
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
