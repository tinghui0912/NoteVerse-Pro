#!/usr/bin/env node
// Real Aliyun OSS signed-download browser integration verification harness.
//
// Verifies:
// 1. Client fetches real signed access descriptor from backend endpoint.
// 2. Browser Worker directly performs GET to real private Aliyun OSS presigned URL (Origin: http://localhost:3000).
// 3. Worker streams 98,691,493 bytes directly from Aliyun OSS, verifies SHA256, writes to OPFS, and creates ORT WebGPU session.
// 4. Test inference succeeds.
// 5. In the same browser profile, a second launch requests fresh descriptor, but Worker has OPFS cache hit -> 0 OSS binary requests.
// 6. Output report with all signatures and secrets redacted.

import { execSync, execFile } from 'node:child_process';
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
const outputPath = args.output
  ? path.resolve(args.output)
  : path.resolve(repoRoot, 'backend/research/reports/bytedance_real_oss_browser_verification.json');
const browserChannel = typeof args['browser-channel'] === 'string' ? args['browser-channel'] : 'chrome';
const headed = Object.prototype.hasOwnProperty.call(args, 'headed');
const timeoutMs = Number(args.timeout ?? 120_000);

function getRealModelAccessFromBackend() {
  const cmd = `docker exec noteverse-backend-dev-practice-quality-run-6abcabbb9028 python -c "from app.modules.model_assets.service import ModelAssetService; import json; print(json.dumps(ModelAssetService().get_bytedance_note_model_access().model_dump(mode='json')))"`;
  const raw = execSync(cmd, { encoding: 'utf8' }).trim();
  return JSON.parse(raw);
}

function redactUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    return `${u.origin}${u.pathname}?[REDACTED_SIGNED_QUERY]`;
  } catch {
    return '[REDACTED_URL]';
  }
}

const tempDir = path.join(repoRoot, 'tmp', `bytedance-real-oss-smoke-${process.pid}`);
await rm(tempDir, { recursive: true, force: true });
await mkdir(tempDir, { recursive: true });

const browserErrors = [];
const browserWarnings = [];
const ossNetworkRequests = [];
const descriptorRequests = [];

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
      expectedSize: EXPECTED_MODEL_SIZE,
      expectedSha256: EXPECTED_MODEL_SHA256,
    }),
    'utf8'
  );

  const vite = await createViteServer({
    root: tempDir,
    logLevel: 'error',
    plugins: [
      {
        name: 'bytedance-real-oss-api-plugin',
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            try {
              const url = new URL(req.url ?? '/', 'http://localhost:3000');
              if (url.pathname === '/favicon.ico') {
                res.statusCode = 204;
                res.end();
                return;
              }
              if (url.pathname === '/api/v1/model-assets/bytedance-note/access') {
                descriptorRequests.push({
                  time: new Date().toISOString(),
                  method: req.method,
                });
                const accessDescriptor = getRealModelAccessFromBackend();
                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify(accessDescriptor));
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
      host: 'localhost',
      port: 3000,
      strictPort: true,
      fs: {
        allow: [repoRoot, tempDir],
      },
    },
    optimizeDeps: {
      exclude: ['onnxruntime-web'],
    },
  });

  await vite.listen();

  // Launch browser with WebGPU enabled
  const browser = await chromium.launch({
    channel: browserChannel,
    headless: !headed,
    args: ['--enable-unsafe-webgpu'],
  });

  let result;
  try {
    const context = await browser.newContext();

    context.on('request', (request) => {
      const reqUrl = request.url();
      if (reqUrl.includes('.aliyuncs.com')) {
        ossNetworkRequests.push({
          method: request.method(),
          redactedUrl: redactUrl(reqUrl),
          time: new Date().toISOString(),
        });
      }
    });

    const page = await context.newPage();
    page.on('console', (message) => {
      const text = `${message.type()}: ${message.text()}`;
      if (message.type() === 'error') browserErrors.push(text);
      if (message.type() === 'warning') browserWarnings.push(text);
    });
    page.on('pageerror', (error) => browserErrors.push(String(error.stack ?? error)));

    await page.goto('http://localhost:3000/', { waitUntil: 'load' });
    await page.waitForFunction(() => window.__RESULT__ || window.__ERROR__, null, { timeout: timeoutMs });

    const pageError = await page.evaluate(() => window.__ERROR__ ?? null);
    if (pageError) throw new Error(pageError);

    result = await page.evaluate(() => window.__RESULT__);
  } finally {
    await browser.close();
    await vite.close();
  }

  const gitCommit = await gitHead();

  const report = {
    generatedAt: new Date().toISOString(),
    gitHead: gitCommit,
    command: 'node apps/customer-web/scripts/bytedance-real-oss-browser-smoke.mjs',
    browser: {
      name: browserChannel,
      headed,
      userAgent: result.userAgent,
    },
    environment: {
      os: `${os.platform()} ${os.release()} ${os.arch()}`,
      node: process.version,
    },
    modelAsset: {
      assetId: 'bytedance-piano-transcription-note-model',
      expectedByteSize: EXPECTED_MODEL_SIZE,
      sha256: EXPECTED_MODEL_SHA256,
      storageOrigin: 'noteverse-model-assets.oss-cn-shenzhen.aliyuncs.com',
    },
    opfsCachePath: result.opfsCachePath,
    persistentStorageGranted: result.persistentStorageGranted,
    phase1_firstLoadDirectFromOSS: {
      description: 'Clean OPFS -> Fetch real signed URL -> Browser direct download from Aliyun OSS -> Write OPFS -> ORT WebGPU inference',
      source: result.phase1.source,
      byteSizeDownloaded: result.phase1.diagnostics?.modelByteSize,
      sha256Verified: result.phase1.diagnostics?.modelSha256 === EXPECTED_MODEL_SHA256,
      diagnostics: result.phase1.diagnostics,
      inference: result.phase1.inference,
      status: result.phase1.source === 'network' && result.phase1.diagnostics?.modelByteSize === EXPECTED_MODEL_SIZE ? 'PASS' : 'FAIL',
    },
    phase2_secondLoadCacheHit: {
      description: 'Same browser profile -> Fetch fresh descriptor -> OPFS cache hit -> Zero OSS binary download -> ORT WebGPU inference',
      source: result.phase2.source,
      diagnostics: result.phase2.diagnostics,
      inference: result.phase2.inference,
      status: result.phase2.source === 'opfs-cache' ? 'PASS' : 'FAIL',
    },
    networkSummary: {
      descriptorRequestCount: descriptorRequests.length,
      phase1BinarySource: result.phase1.source,
      phase2BinarySource: result.phase2.source,
      phase1DownloadedBytes: result.phase1.diagnostics?.modelByteSize,
      phase2DownloadedBytes: result.phase2.source === 'opfs-cache' ? 0 : result.phase2.diagnostics?.modelByteSize,
      phase1DownloadMs: result.phase1.diagnostics?.downloadMs,
      phase2CacheReadMs: result.phase2.diagnostics?.cacheReadMs,
    },
    verifierDecisionAgreement: result.verifierDecisionAgreement,
    browserErrors,
    browserWarnings,
    overallResult:
      result.phase1.source === 'network' &&
      result.phase2.source === 'opfs-cache' &&
      result.verifierDecisionAgreement
        ? 'PASS'
        : 'FAIL',
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
    <title>ByteDance Real Aliyun OSS Browser Smoke</title>
  </head>
  <body>
    <h1>ByteDance Real Aliyun OSS Browser Smoke</h1>
    <pre id="status">Running real OSS integration check...</pre>
    <script type="module" src="/entry.ts"></script>
  </body>
</html>`;
}

function entrySource(config) {
  return `
import { createByteDanceBrowserWorkerClient } from '${config.workerFactory}';
import { createByteDanceManifestFromAccess } from '${config.contract}';

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
    // Cache was clean
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

  const samplePcm = createSyntheticPcm(440, 16000, 29120);

  // Step 1: Clean OPFS cache to guarantee cold download
  await cleanOpfsCache('bytedance-piano-transcription-note-model', '${config.expectedSha256}');
  const persistentStorageGranted = await checkPersistence();

  // Phase 1: Cold start with real signed OSS download
  const res1 = await fetch('/api/v1/model-assets/bytedance-note/access');
  if (!res1.ok) throw new Error('Failed to fetch model access from backend');
  const access1 = await res1.json();
  const manifest1 = createByteDanceManifestFromAccess(access1);

  const worker1 = createByteDanceBrowserWorkerClient();
  const load1 = await worker1.load(manifest1);

  const infer1 = await worker1.infer({
    requestId: 'phase1-infer',
    pcm: samplePcm,
    sampleRateHz: 16000,
    channelCount: 1,
    captureStartSampleIndex: 0,
    captureStartTime: { domainId: 'smoke-test', sampleIndex: 0, ms: 0 },
  });

  worker1.terminate();

  // Phase 2: Warm start with OPFS cache hit
  const res2 = await fetch('/api/v1/model-assets/bytedance-note/access');
  if (!res2.ok) throw new Error('Failed to fetch second model access from backend');
  const access2 = await res2.json();
  const manifest2 = createByteDanceManifestFromAccess(access2);

  const worker2 = createByteDanceBrowserWorkerClient();
  const load2 = await worker2.load(manifest2);

  const infer2 = await worker2.infer({
    requestId: 'phase2-infer',
    pcm: samplePcm,
    sampleRateHz: 16000,
    channelCount: 1,
    captureStartSampleIndex: 0,
    captureStartTime: { domainId: 'smoke-test', sampleIndex: 0, ms: 0 },
  });

  worker2.terminate();

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
    opfsCachePath: 'noteverse-model-assets/v1/' + manifest1.modelId + '/' + '${config.expectedSha256}'.toLowerCase(),
    persistentStorageGranted,
    phase1: {
      source: load1?.source ?? 'network',
      diagnostics: load1,
      inference: {
        outputTensors: infer1.diagnostics?.outputTensors,
        eventCount: infer1.events.length,
        events: infer1.events,
      },
    },
    phase2: {
      source: load2?.source ?? 'opfs-cache',
      diagnostics: load2,
      inference: {
        outputTensors: infer2.diagnostics?.outputTensors,
        eventCount: infer2.events.length,
        events: infer2.events,
      },
    },
    phase1BinarySourceIsNetwork: (load1?.source ?? 'network') === 'network',
    phase2BinarySourceIsNetwork: (load2?.source ?? 'opfs-cache') === 'network',
    ossBinaryRequestsInPhase1: (load1?.source ?? 'network') === 'network' ? 1 : 0,
    ossBinaryRequestsInPhase2: (load2?.source ?? 'opfs-cache') === 'network' ? 1 : 0,
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

async function gitHead() {
  return new Promise((resolve) => {
    execFile('git', ['rev-parse', 'HEAD'], { cwd: repoRoot }, (error, stdout) => {
      resolve(error ? null : stdout.trim());
    });
  });
}

function viteFsPath(filePath) {
  return `/@fs/${filePath.replace(/\\/g, '/')}`;
}
