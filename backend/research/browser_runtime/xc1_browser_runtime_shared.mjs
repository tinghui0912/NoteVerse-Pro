import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const XC1_BROWSER_RUNTIME_SHARED_SCHEMA_VERSION = 1;

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const RUNTIME_NODE_MODULES = path.join(REPO_ROOT, 'backend/research/browser_runtime/dr3r_browser_runtime/node_modules');
export const BASIC_PITCH_WORK = path.join(REPO_ROOT, 'backend/data/work/basic_pitch_browser_feasibility');

export const XC1_DEFAULT_ASSET_PATHS = Object.freeze({
  robustOnnxPath: path.join(REPO_ROOT, 'backend/data/work/phase9gd1_robust_browser_onnx/robust_bytedance_fixed_1820_opset18.onnx'),
  onlineAmtK8OnnxPath: path.join(REPO_ROOT, 'backend/data/work/phase9g_dr3r1h/graphs/online_amt_grouped_k8_opset18.onnx'),
  onlineAmtK1OnnxPath: path.join(REPO_ROOT, 'backend/data/work/phase9g_dr3r1h/graphs/online_amt_grouped_k1_opset18.onnx'),
  basicPitchWorkDir: BASIC_PITCH_WORK,
});

const require = createRequire(import.meta.url);

export async function sha256File(filePath) {
  const hash = createHash('sha256');
  hash.update(await readFile(filePath));
  return hash.digest('hex');
}

export async function verifySha(filePath, expected, label) {
  if (!filePath) throw new Error(`XC1_CANDIDATE_ASSET_REQUIRED:${label}`);
  const actual = await sha256File(filePath);
  if (actual !== expected) {
    throw new Error(`XC1_CANDIDATE_ASSET_IDENTITY_DRIFT:${label}:${actual}:${expected}`);
  }
  return actual;
}

export function contentType(filePath) {
  if (filePath.endsWith('.js') || filePath.endsWith('.mjs')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  if (filePath.endsWith('.wasm')) return 'application/wasm';
  if (filePath.endsWith('.onnx')) return 'application/octet-stream';
  return 'application/octet-stream';
}

export function safeResolve(root, relativePath) {
  const decoded = decodeURIComponent(relativePath).replaceAll('\\', '/');
  if (decoded.includes('..') || path.isAbsolute(decoded) || /^[A-Za-z]:/.test(decoded)) {
    throw new Error('XC1_STAGE_A_PATH_TRAVERSAL');
  }
  const resolved = path.resolve(root, decoded);
  const rootResolved = path.resolve(root);
  if (resolved !== rootResolved && !resolved.startsWith(`${rootResolved}${path.sep}`)) {
    throw new Error('XC1_STAGE_A_PATH_TRAVERSAL');
  }
  return resolved;
}

export async function bundleBasicPitch(workDir = BASIC_PITCH_WORK) {
  const bundleDir = path.join(REPO_ROOT, 'backend/data/work/xc1_r3a_acceptance');
  await mkdir(bundleDir, { recursive: true });
  const entryPath = path.join(bundleDir, 'basic_pitch_executor_entry.js');
  const bundlePath = path.join(bundleDir, 'basic_pitch_executor_bundle.js');
  await writeFile(entryPath, `
import * as tf from '@tensorflow/tfjs';
import { BasicPitch } from '@spotify/basic-pitch/esm/inference.js';
import { outputToNotesPoly, noteFramesToTime } from '@spotify/basic-pitch/esm/toMidi.js';

window.runXc1BasicPitchExecutor = async function(options = {}) {
  await tf.setBackend('webgl');
  await tf.ready();
  const model = new BasicPitch('/basic/model/model.json');
  const pcm = await window.loadXc1ExternalPcm();
  const input = window.resampleLinear(pcm.samples, 16000, 22050);
  let frames = [];
  let onsets = [];
  let callbackCount = 0;
  const started = performance.now();
  await model.evaluateModel(input, (f, o) => {
    frames = frames.concat(f);
    onsets = onsets.concat(o);
    callbackCount += 1;
  }, () => {});
  const inferenceMs = performance.now() - started;
  const notes = outputToNotesPoly(frames, onsets, 0.5, 0.3, 5, true, null, null, true, 11);
  const timedNotes = noteFramesToTime(notes);
  return {
    backend: tf.getBackend(),
    browserReceivedPcm: {
      sha256: pcm.sha256,
      byteLength: pcm.byteLength,
      sampleCount: pcm.sampleCount,
    },
    decoderImportPath: 'node_modules/@spotify/basic-pitch/esm/toMidi.js',
    outputToNotesPolyCalled: true,
    noteFramesToTimeCalled: true,
    actualModelInvocationCount: callbackCount,
    actualInferenceSessionRunCount: callbackCount,
    processingMs: inferenceMs,
    noteCount: timedNotes.length,
    acousticObservations: timedNotes.map((note, index) => ({
      pitch: note.pitchMidi ?? note.pitch_midi ?? note.pitch,
      performanceTimeMs: note.startTimeSeconds * 1000,
      confidence: note.amplitude ?? 1,
      candidateObservationId: ['basic-pitch-browser-v1', options.takeId ?? 'unknown-take', options.windowId ?? 'window0', note.pitchMidi ?? note.pitch_midi ?? note.pitch, Math.round(note.startTimeSeconds * 16000), index].join(':'),
    })),
  };
};
`, 'utf8');
  const esbuild = await import(pathToFileURL(path.join(workDir, 'node_modules/esbuild/lib/main.js')).href);
  await esbuild.build({
    entryPoints: [entryPath],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    outfile: bundlePath,
    absWorkingDir: workDir,
    nodePaths: [path.join(workDir, 'node_modules')],
    logLevel: 'silent',
  });
  return bundlePath;
}

export async function startXc1BrowserAssetServer({
  robustOnnxPath = XC1_DEFAULT_ASSET_PATHS.robustOnnxPath,
  onlineAmtK8OnnxPath = XC1_DEFAULT_ASSET_PATHS.onlineAmtK8OnnxPath,
  onlineAmtK1OnnxPath = XC1_DEFAULT_ASSET_PATHS.onlineAmtK1OnnxPath,
  basicPitchWorkDir = BASIC_PITCH_WORK,
  basicBundlePath,
  stageARoot,
} = {}) {
  const ortDist = path.join(RUNTIME_NODE_MODULES, 'onnxruntime-web/dist');
  const basicRoot = path.join(basicPitchWorkDir, 'node_modules/@spotify/basic-pitch');
  const bundlePath = basicBundlePath ?? await bundleBasicPitch(basicPitchWorkDir);
  const server = createServer((req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      let filePath;
      if (url.pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(`<!doctype html><meta charset="utf-8"><script>
window.sha256Hex = async function(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
};
window.loadXc1ExternalPcm = async function() {
  const response = await fetch('/audio/input.pcm', { cache: 'no-store' });
  if (!response.ok) throw new Error('XC1_BROWSER_PCM_FETCH_FAILED:' + response.status);
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength % 4 !== 0) throw new Error('XC1_BROWSER_PCM_BYTES_NOT_FLOAT32_ALIGNED');
  return {
    byteLength: buffer.byteLength,
    sampleCount: buffer.byteLength / 4,
    sha256: await window.sha256Hex(buffer.slice(0)),
    samples: new Float32Array(buffer),
  };
};
window.resampleLinear = function(input, sourceRate, targetRate) {
  const outputLength = Math.max(1, Math.floor(input.length * targetRate / sourceRate));
  const output = new Float32Array(outputLength);
  for (let i = 0; i < output.length; i += 1) {
    const sourceIndex = i * sourceRate / targetRate;
    const left = Math.floor(sourceIndex);
    const right = Math.min(input.length - 1, left + 1);
    const frac = sourceIndex - left;
    output[i] = (input[left] ?? 0) * (1 - frac) + (input[right] ?? 0) * frac;
  }
  return output;
};
</script><script src="/ort/ort.webgpu.min.js"></script><script type="module" src="/basic-bundle.js"></script>`);
        return;
      }
      if (url.pathname === '/basic-bundle.js') filePath = bundlePath;
      else if (url.pathname === '/audio/input.pcm') {
        if (!stageARoot) throw new Error('XC1_STAGE_A_ROOT_REQUIRED_FOR_PCM');
        filePath = safeResolve(path.join(stageARoot, 'audio'), 'input.pcm');
      }
      else if (url.pathname.startsWith('/ort/')) filePath = safeResolve(ortDist, url.pathname.slice('/ort/'.length));
      else if (url.pathname === '/robust.onnx') filePath = robustOnnxPath;
      else if (url.pathname === '/online-k8.onnx') filePath = onlineAmtK8OnnxPath;
      else if (url.pathname === '/online-k1.onnx') filePath = onlineAmtK1OnnxPath;
      else if (url.pathname.startsWith('/basic/model/')) filePath = safeResolve(path.join(basicRoot, 'model'), url.pathname.slice('/basic/model/'.length));
      else {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      res.writeHead(200, { 'content-type': contentType(filePath), 'cache-control': 'no-store' });
      createReadStream(filePath).pipe(res);
    } catch (error) {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(String(error && error.stack ? error.stack : error));
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, url: `http://127.0.0.1:${address.port}/` });
    });
  });
}

export async function materializeSyntheticStageARoot({
  root,
  fixtureId = 'synthetic-piano-like',
  sampleRateHz = 16000,
  durationMs = 2200,
} = {}) {
  if (!root) throw new Error('XC1_STAGE_A_ROOT_REQUIRED');
  await rm(root, { recursive: true, force: true });
  const audioDir = path.join(root, 'audio');
  const manifestsDir = path.join(root, 'manifests');
  await mkdir(audioDir, { recursive: true });
  await mkdir(manifestsDir, { recursive: true });
  const sampleCount = Math.floor(sampleRateHz * durationMs / 1000);
  const pcm = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i += 1) {
    const t = i / sampleRateHz;
    const envelope = t > 0.2 && t < 1.6 ? Math.exp(-(t - 0.2) * 2.0) : 0;
    pcm[i] = envelope * (Math.sin(2 * Math.PI * 261.625565 * t) * 0.08 + Math.sin(2 * Math.PI * 329.627557 * t) * 0.04);
  }
  const pcmPath = path.join(audioDir, 'input.pcm');
  await writeFile(pcmPath, Buffer.from(pcm.buffer));
  const sha256 = await sha256File(pcmPath);
  const manifest = {
    schemaVersion: 1,
    fixtureClass: 'NON_SMD_SYNTHETIC_PRE_F4_ACCEPTANCE',
    takes: [{
      takeId: fixtureId,
      sourceAcousticWavSha256: 'synthetic-non-smd-generated-pcm',
      canonicalPcm: {
        relativeStageAPath: 'audio/input.pcm',
        sha256,
        byteSize: sampleCount * 4,
        sampleCount,
        sampleRateHz,
        dtype: 'float32-le-raw',
      },
      scoreableInterior: {
        startMs: 1000,
        endMs: durationMs - 220,
        pastContextMs: 1000,
        futureContextMs: 220,
      },
    }],
  };
  const manifestPath = path.join(manifestsDir, 'stage_a_manifest.json');
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return { root, manifestPath, take: manifest.takes[0] };
}

export async function resolveFrozenAcousticInput({ stageARoot, manifestPath, takeId }) {
  if (!stageARoot) throw new Error('XC1_STAGE_A_ROOT_REQUIRED');
  if (!manifestPath) throw new Error('XC1_STAGE_A_MANIFEST_REQUIRED');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const take = (manifest.takes ?? []).find((candidate) => candidate.takeId === takeId);
  if (!take) throw new Error(`XC1_STAGE_A_TAKE_NOT_IN_MANIFEST:${takeId}`);
  const pcm = take.canonicalPcm;
  if (!pcm || pcm.sampleRateHz !== 16000 || pcm.dtype !== 'float32-le-raw') {
    throw new Error('XC1_STAGE_A_FROZEN_INPUT_IDENTITY_DRIFT:pcm-contract');
  }
  const relative = pcm.relativeStageAPath?.replaceAll('\\', '/');
  if (!relative || !relative.startsWith('audio/')) {
    throw new Error('XC1_STAGE_A_FROZEN_INPUT_IDENTITY_DRIFT:pcm-path');
  }
  const pcmPath = safeResolve(stageARoot, relative);
  const bytes = (await readFile(pcmPath)).byteLength;
  if (bytes !== pcm.byteSize) throw new Error(`XC1_STAGE_A_FROZEN_INPUT_IDENTITY_DRIFT:byteSize:${bytes}:${pcm.byteSize}`);
  const actualSha = await sha256File(pcmPath);
  if (actualSha !== pcm.sha256) throw new Error(`XC1_STAGE_A_FROZEN_INPUT_IDENTITY_DRIFT:sha256:${actualSha}:${pcm.sha256}`);
  if (bytes / 4 !== pcm.sampleCount) throw new Error(`XC1_STAGE_A_FROZEN_INPUT_IDENTITY_DRIFT:sampleCount:${bytes / 4}:${pcm.sampleCount}`);
  return {
    takeId,
    stageARoot,
    manifestPath,
    pcmPath,
    pcmUrl: '/audio/input.pcm',
    pcmSha256: pcm.sha256,
    byteSize: pcm.byteSize,
    sampleCount: pcm.sampleCount,
    sampleRateHz: pcm.sampleRateHz,
    dtype: pcm.dtype,
    scoreableInterval: take.scoreableInterior,
    sourceAcousticWavSha256: take.acousticWavSha256 ?? take.sourceAcousticWavSha256,
  };
}

export async function launchXc1Browser({ channel = 'chrome', headed = true } = {}) {
  const { chromium } = require(path.join(RUNTIME_NODE_MODULES, 'playwright'));
  const explicitExecutablePath = resolveBrandedBrowserExecutable(channel);
  const browser = await chromium.launch({
    ...(explicitExecutablePath ? { executablePath: explicitExecutablePath } : { channel }),
    headless: !headed,
    args: [],
  });
  const browserProcess = typeof browser.process === 'function' ? browser.process() : null;
  return {
    browser,
    identity: {
      channel,
      version: await browser.version(),
      headed: Boolean(headed),
      executablePath: browserProcess?.spawnfile ?? explicitExecutablePath ?? null,
      launchArgsIncludeUnsafeWebGpu: (browserProcess?.spawnargs ?? []).some((arg) => arg.includes('enable-unsafe-webgpu')),
      os: `${os.platform()} ${os.release()} ${os.arch()}`,
      node: process.version,
      playwrightRuntime: path.join(RUNTIME_NODE_MODULES, 'playwright'),
    },
  };
}

export function resolveBrandedBrowserExecutable(channel) {
  if (process.platform !== 'win32') return null;
  const candidates = channel === 'msedge'
    ? [
      path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'),
      path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Microsoft/Edge/Application/msedge.exe'),
    ]
    : [
      path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Google/Chrome/Application/chrome.exe'),
      path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Google/Chrome/Application/chrome.exe'),
    ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

export async function collectWebGpuAdapter(page) {
  return page.evaluate(async () => {
    if (!navigator.gpu) throw new Error('WebGPU unavailable: navigator.gpu missing');
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('WebGPU unavailable: requestAdapter returned null');
    return {
      features: Array.from(adapter.features ?? []),
      info: adapter.info ? {
        vendor: adapter.info.vendor,
        architecture: adapter.info.architecture,
        device: adapter.info.device,
        description: adapter.info.description,
      } : null,
    };
  });
}

export async function moduleIdentity(filePath, exportName) {
  return {
    file: path.relative(REPO_ROOT, filePath).replaceAll('\\', '/'),
    sha256: await sha256File(filePath),
    exportName,
  };
}

export function assertNoSmokeStatus(receipt) {
  if (receipt?.status === 'XC1_STAGE_A_BROWSER_EXECUTION_NOT_INVOKED_BY_SMOKE') {
    throw new Error('XC1_OFFICIAL_ACCEPTANCE_REJECTS_SMOKE_RECEIPT');
  }
}

export function ensureAssetExists(filePath, label) {
  if (!existsSync(filePath)) throw new Error(`XC1_CANDIDATE_ASSET_MISSING:${label}:${filePath}`);
}
