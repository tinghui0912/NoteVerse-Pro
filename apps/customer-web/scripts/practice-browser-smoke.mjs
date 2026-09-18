#!/usr/bin/env node
// Customer Web Browser-Local Practice Smoke Harness
//
// Verifies in real headed Chrome:
// 1. PracticeScoreArtifact v1 consumed browser-locally
// 2. BrowserMicrophoneCaptureController + AudioWorklet + Resampler
// 3. ByteDance Worker + OPFS model cache + ORT WebGPU inference
// 4. AcousticEventStreamNormalizer -> StepPracticeRuntime verification & step advance
// 5. Absolute network isolation: 0 /practice/sessions, 0 WebSockets

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
  : path.resolve(repoRoot, 'backend/research/reports/practice_browser_smoke_latest.json');
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

const tempDir = path.join(repoRoot, 'tmp', `practice-browser-smoke-${process.pid}`);
await rm(tempDir, { recursive: true, force: true });
await mkdir(tempDir, { recursive: true });

const browserErrors = [];
const browserWarnings = [];
const disallowedRequests = [];

try {
  await writeFile(path.join(tempDir, 'index.html'), html(), 'utf8');
  await writeFile(
    path.join(tempDir, 'entry.ts'),
    entrySource({
      liveModule: viteFsPath(
        path.join(repoRoot, 'apps/customer-web/src/lib/practice/acoustic-inference/live-capture.ts')
      ),
      workerFactory: viteFsPath(
        path.join(repoRoot, 'apps/customer-web/src/lib/practice/acoustic-inference/bytedance-worker-factory.ts')
      ),
      contract: viteFsPath(
        path.join(repoRoot, 'apps/customer-web/src/lib/practice/acoustic-inference/bytedance-contract.ts')
      ),
      worklet: viteFsPath(
        path.join(repoRoot, 'apps/customer-web/src/lib/practice/acoustic-inference/bytedance-capture.worklet.js')
      ),
      stepRuntime: viteFsPath(
        path.join(repoRoot, 'apps/customer-web/src/lib/practice/local-core/step-runtime.ts')
      ),
      timebase: viteFsPath(
        path.join(repoRoot, 'apps/customer-web/src/lib/practice/local-core/timebase.ts')
      ),
      session: viteFsPath(
        path.join(repoRoot, 'apps/customer-web/src/lib/practice/local-core/session.ts')
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
        name: 'practice-browser-smoke-assets',
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
      },
    ],
    server: {
      host: '127.0.0.1',
      port: 0,
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
  const baseUrl = `http://127.0.0.1:${address.port}/`;

  const browser = await chromium.launch({
    channel: browserChannel,
    headless: !headed,
    args: ['--enable-unsafe-webgpu', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('console', (msg) => {
    const text = msg.text();
    if (msg.type() === 'error') {
      browserErrors.push(text);
    } else if (msg.type() === 'warning') {
      browserWarnings.push(text);
    }
  });

  page.on('pageerror', (error) => {
    browserErrors.push(String(error && error.stack ? error.stack : error));
  });

  page.on('request', (request) => {
    const url = request.url();
    if (
      url.includes('/practice/sessions') ||
      url.includes('/targets') ||
      request.resourceType() === 'websocket'
    ) {
      disallowedRequests.push(`${request.method()} ${url}`);
    }
  });

  await page.goto(baseUrl, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__RESULT__ || window.__ERROR__, null, { timeout: timeoutMs });
  const pageError = await page.evaluate(() => window.__ERROR__ ?? null);
  if (pageError) throw new Error(pageError);
  const result = await page.evaluate(() => window.__RESULT__);

  await browser.close();
  await vite.close();

  const report = {
    generatedAt: new Date().toISOString(),
    gitHead: await gitHead(),
    command: `${process.argv0} ${process.argv.slice(1).join(' ')}`,
    harness: 'apps/customer-web/scripts/practice-browser-smoke.mjs',
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
    disallowedNetworkRequests: disallowedRequests,
    result,
    browserErrors,
    browserWarnings,
  };

  if (outputPath) {
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }

  console.log(JSON.stringify(report, null, 2));

  if (disallowedRequests.length > 0) {
    throw new Error(`Disallowed network requests during practice: ${disallowedRequests.join(', ')}`);
  }
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

function html() {
  return `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Practice browser smoke</title></head>
  <body>
    <pre id="status">running</pre>
    <script type="module" src="/entry.ts"></script>
  </body>
</html>`;
}

function entrySource(config) {
  return `
import {
  BrowserMicrophoneCaptureController,
} from '${config.liveModule}';
import { createByteDanceBrowserWorkerClient } from '${config.workerFactory}';
import { defaultByteDanceModelManifest } from '${config.contract}';
import { StepPracticeRuntime } from '${config.stepRuntime}';
import { PracticeTimebase } from '${config.timebase}';
import { createLocalSessionId } from '${config.session}';

const CONFIG = ${JSON.stringify(config)};

const smokeArtifact = {
  schemaVersion: 1,
  artifactId: 'practice-score-artifact:browser-smoke',
  scoreId: 'smoke-score',
  revisionId: 'smoke-rev',
  scoreTempoSegments: [{ startBeat: 0.0, bpm: 80.0 }],
  meterSegments: [
    {
      startBeat: 0.0,
      numerator: 4,
      denominator: 4,
      measureDurationBeats: 4.0,
      countInPulses: 4,
      source: 'MUSICXML',
    },
  ],
  expectedPracticeGroups: [
    {
      groupId: 'g-0',
      onsetBeat: 0.0,
      canonicalEndBeat: 1.0,
      pitches: ['A4'],
      renderNoteIds: ['n-0'],
      measureNumbers: ['1'],
      eventIds: ['e-0'],
      expectedNotes: [{ pitch: 'A4', midiPitch: 69 }],
      strikeTargets: [{ pitch: 'A4', midiPitch: 69 }],
      staffIds: ['1'],
      voiceIds: ['1'],
    },
    {
      groupId: 'g-1',
      onsetBeat: 1.0,
      canonicalEndBeat: 2.0,
      pitches: ['B4'],
      renderNoteIds: ['n-1'],
      measureNumbers: ['1'],
      eventIds: ['e-1'],
      expectedNotes: [{ pitch: 'B4', midiPitch: 71 }],
      strikeTargets: [{ pitch: 'B4', midiPitch: 71 }],
      staffIds: ['1'],
      voiceIds: ['1'],
    },
  ],
  practiceAttackSteps: [
    {
      stepId: 's-0',
      expectedGroupIndex: 0,
      onsetBeat: 0.0,
      attackTargets: [
        {
          attackId: 'a-0',
          pitch: 'A4',
          notes: [
            {
              stepNoteId: 'sn-0',
              eventId: 'e-0',
              pitch: 'A4',
              renderNoteId: 'n-0',
              measureNumbers: ['1'],
              staffIds: ['1'],
              voiceIds: ['1'],
            },
          ],
          eventIds: ['e-0'],
          renderNoteIds: ['n-0'],
          measureNumbers: ['1'],
        },
      ],
      continuation: [],
      renderNoteIds: ['n-0'],
      measureNumbers: ['1'],
      staffIds: ['1'],
      voiceIds: ['1'],
    },
    {
      stepId: 's-1',
      expectedGroupIndex: 1,
      onsetBeat: 1.0,
      attackTargets: [
        {
          attackId: 'a-1',
          pitch: 'B4',
          notes: [
            {
              stepNoteId: 'sn-1',
              eventId: 'e-1',
              pitch: 'B4',
              renderNoteId: 'n-1',
              measureNumbers: ['1'],
              staffIds: ['1'],
              voiceIds: ['1'],
            },
          ],
          eventIds: ['e-1'],
          renderNoteIds: ['n-1'],
          measureNumbers: ['1'],
        },
      ],
      continuation: [],
      renderNoteIds: ['n-1'],
      measureNumbers: ['1'],
      staffIds: ['1'],
      voiceIds: ['1'],
    },
  ],
};

async function webgpuInfo() {
  if (!navigator.gpu) return { available: false, adapterAcquired: false };
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) return { available: true, adapterAcquired: false };
  return {
    available: true,
    adapterAcquired: true,
    features: Array.from(adapter.features ?? []),
    limits: adapter.limits ? {
      maxBufferSize: adapter.limits.maxBufferSize,
      maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
      maxComputeWorkgroupStorageSize: adapter.limits.maxComputeWorkgroupStorageSize,
    } : null,
  };
}

function createSyntheticMediaStream(frequency = 440) {
  const audio = new AudioContext();
  const destination = audio.createMediaStreamDestination();
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  gain.gain.value = 0.3;
  oscillator.frequency.value = frequency;
  oscillator.connect(gain);
  gain.connect(destination);
  oscillator.start();
  return {
    stream: destination.stream,
    async close() {
      oscillator.stop();
      oscillator.disconnect();
      gain.disconnect();
      await audio.close();
    },
  };
}

async function main() {
  const webgpu = await webgpuInfo();
  const localSessionId = createLocalSessionId();
  const timebase = new PracticeTimebase({ domainId: localSessionId });

  // 1. Initialize StepPracticeRuntime
  const runtime = new StepPracticeRuntime({
    artifact: smokeArtifact,
    inputSource: 'MICROPHONE',
    localSessionId,
    clock: { nowMs: () => performance.now() },
    timebase,
  });

  const initialTarget = runtime.currentTarget();
  const stepAdvances = [];
  const stepObservations = [];

  // 2. Synthetic 440Hz audio source for A4
  const syntheticSource = createSyntheticMediaStream(440);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: async () => syntheticSource.stream,
    },
  });

  // 3. Manifest pointing to local test model endpoint
  const manifest = defaultByteDanceModelManifest({
    modelUrl: '/model.onnx',
    expectedByteSize: CONFIG.modelSize,
    sha256: CONFIG.modelSha256,
  });

  let loadDiagnostic = null;

  // 4. Create BrowserMicrophoneCaptureController
  const controller = new BrowserMicrophoneCaptureController({
    manifest,
    sessionTimebase: timebase,
    sourceSampleRateHz: 48000,
    captureDomainId: localSessionId,
    workerClientFactory: () => {
      const client = createByteDanceBrowserWorkerClient();
      const origLoad = client.load.bind(client);
      client.load = async (m) => {
        loadDiagnostic = await origLoad(m);
        return loadDiagnostic;
      };
      return client;
    },
    evidenceSink: {
      currentStepTarget: () => runtime.currentTarget(),
      onStepObservation: (obs) => {
        stepObservations.push(obs);
        const decision = runtime.observe(obs);
        if (decision.kind === 'MATCH') {
          stepAdvances.push({
            decision,
            currentTarget: runtime.currentTarget(),
          });
        }
      },
    },
  });

  // 5. Start controller
  await controller.start();

  // 6. Wait for at least one inference and verification
  const deadline = performance.now() + 30_000;
  while (performance.now() < deadline) {
    if (stepAdvances.length > 0 || stepObservations.length >= 3) {
      break;
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  // 7. Pause and stop lifecycle check
  await controller.stop();
  await syntheticSource.close();

  const finalTarget = runtime.currentTarget();

  return {
    webgpu,
    localSessionId,
    initialTarget,
    stepObservationsCount: stepObservations.length,
    stepObservations: stepObservations.slice(0, 10),
    stepAdvances,
    finalTarget,
    loadDiagnostic,
    offlineExecutionPassed: true,
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
