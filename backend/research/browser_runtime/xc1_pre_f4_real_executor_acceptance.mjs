#!/usr/bin/env node

import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const RUNTIME_NODE_MODULES = path.join(REPO_ROOT, 'backend/research/browser_runtime/dr3r_browser_runtime/node_modules');
const BASIC_PITCH_WORK = path.join(REPO_ROOT, 'backend/data/work/basic_pitch_browser_feasibility');
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(RUNTIME_NODE_MODULES, 'playwright'));

const IDENTITIES = {
  robust: {
    deploymentId: 'robust-browser-v1',
    statusKey: 'Robust',
    onnxPath: path.join(REPO_ROOT, 'backend/data/work/phase9gd1_robust_browser_onnx/robust_bytedance_fixed_1820_opset18.onnx'),
    onnxSha256: '4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3',
  },
  onlineAmt: {
    deploymentId: 'online-amt-k8-browser-v1',
    statusKey: 'Online-AMT',
    onnxPath: path.join(REPO_ROOT, 'backend/data/work/phase9g_dr3r1h/graphs/online_amt_grouped_k8_opset18.onnx'),
    onnxSha256: '818c095a3e96f507f45fe5f394169660cb3848fb7e496699a99c1957b51e9f18',
  },
  basicPitch: {
    deploymentId: 'basic-pitch-browser-v1',
    statusKey: 'Basic Pitch',
    modelJsonPath: path.join(BASIC_PITCH_WORK, 'node_modules/@spotify/basic-pitch/model/model.json'),
    modelJsonSha256: '1ed1aaee3409ec1dc098c8b01f430c0911f6fe9412e7af8086750f9e8f302f68',
    weightsPath: path.join(BASIC_PITCH_WORK, 'node_modules/@spotify/basic-pitch/model/group1-shard1of1.bin'),
    weightsSha256: 'b142a95737a52e1e412d5f92e73d8bb80dfe8d04941acc0702f11f4524fb377c',
  },
};

function parseArgs(argv) {
  const args = { channel: 'chrome', headed: true };
  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) throw new Error(`unknown positional argument ${key}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) args[key.slice(2)] = true;
    else {
      args[key.slice(2)] = value;
      index += 1;
    }
  }
  if (!args.output) throw new Error('missing --output');
  return args;
}

async function sha256File(filePath) {
  const hash = createHash('sha256');
  hash.update(await readFile(filePath));
  return hash.digest('hex');
}

async function verifySha(filePath, expected) {
  const actual = await sha256File(filePath);
  if (actual !== expected) throw new Error(`XC1_CANDIDATE_ASSET_IDENTITY_DRIFT:${filePath}:${actual}:${expected}`);
  return actual;
}

function contentType(filePath) {
  if (filePath.endsWith('.js') || filePath.endsWith('.mjs')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  if (filePath.endsWith('.wasm')) return 'application/wasm';
  return 'application/octet-stream';
}

function safeResolve(root, relativePath) {
  const decoded = decodeURIComponent(relativePath).replaceAll('\\', '/');
  if (decoded.includes('..') || path.isAbsolute(decoded) || /^[A-Za-z]:/.test(decoded)) {
    throw new Error('XC1_STAGE_A_PATH_TRAVERSAL');
  }
  const resolved = path.resolve(root, decoded);
  if (!resolved.startsWith(path.resolve(root))) throw new Error('XC1_STAGE_A_PATH_TRAVERSAL');
  return resolved;
}

async function bundleBasicPitch(workDir) {
  const bundleDir = path.join(REPO_ROOT, 'backend/data/work/xc1_r3_acceptance');
  await mkdir(bundleDir, { recursive: true });
  const entryPath = path.join(bundleDir, 'basic_pitch_acceptance_entry.js');
  const bundlePath = path.join(bundleDir, 'basic_pitch_acceptance_bundle.js');
  await writeFile(entryPath, `
import * as tf from '@tensorflow/tfjs';
import { BasicPitch } from '@spotify/basic-pitch/esm/inference.js';
import { outputToNotesPoly, noteFramesToTime } from '@spotify/basic-pitch/esm/toMidi.js';
window.runBasicPitchAcceptance = async function() {
  await tf.setBackend('webgl');
  await tf.ready();
  const model = new BasicPitch('/basic/model/model.json');
  const input = new Float32Array(22050 * 2);
  for (let i = 0; i < input.length; i += 1) input[i] = Math.sin(i / 40) * 0.02;
  let frames = [];
  let onsets = [];
  let contours = [];
  let callbackCount = 0;
  const started = performance.now();
  await model.evaluateModel(input, (f, o, c) => {
    frames = frames.concat(f);
    onsets = onsets.concat(o);
    contours = contours.concat(c);
    callbackCount += 1;
  }, () => {});
  const inferenceMs = performance.now() - started;
  const notes = outputToNotesPoly(frames, onsets, 0.5, 0.3, 5, true, null, null, true, 11);
  const timedNotes = noteFramesToTime(notes);
  return {
    backend: tf.getBackend(),
    actualModelInvocationCount: callbackCount,
    actualInferenceSessionRunCount: callbackCount,
    processingMs: inferenceMs,
    acousticObservations: timedNotes.map((note, index) => ({
      pitch: note.pitchMidi ?? note.pitch_midi,
      performanceTimeMs: note.startTimeSeconds * 1000,
      confidence: note.amplitude ?? 1,
      candidateObservationId: 'basic-pitch-browser-v1:acceptance:' + index,
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

async function startServer({ basicBundlePath }) {
  const ortDist = path.join(RUNTIME_NODE_MODULES, 'onnxruntime-web/dist');
  const basicRoot = path.join(BASIC_PITCH_WORK, 'node_modules/@spotify/basic-pitch');
  const server = createServer((req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      let filePath;
      if (url.pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(`<!doctype html><meta charset="utf-8"><script src="/ort/ort.webgpu.min.js"></script><script type="module" src="/basic-bundle.js"></script>`);
        return;
      }
      if (url.pathname === '/basic-bundle.js') filePath = basicBundlePath;
      else if (url.pathname.startsWith('/ort/')) filePath = safeResolve(ortDist, url.pathname.slice('/ort/'.length));
      else if (url.pathname === '/robust.onnx') filePath = IDENTITIES.robust.onnxPath;
      else if (url.pathname === '/online-k8.onnx') filePath = IDENTITIES.onlineAmt.onnxPath;
      else if (url.pathname.startsWith('/basic/model/')) filePath = safeResolve(path.join(basicRoot, 'model'), url.pathname.slice('/basic/model/'.length));
      else {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      res.writeHead(200, { 'content-type': contentType(filePath), 'cache-control': 'no-store' });
      createReadStream(filePath).pipe(res);
    } catch (error) {
      res.writeHead(500, { 'content-type': 'text/plain' });
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

async function runOrt(page, kind) {
  return page.evaluate(async ({ kind }) => {
    if (!navigator.gpu) throw new Error('WebGPU unavailable: navigator.gpu missing');
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('WebGPU unavailable: requestAdapter returned null');
    ort.env.wasm.wasmPaths = '/ort/';
    const startedLoad = performance.now();
    const session = await ort.InferenceSession.create(kind === 'robust' ? '/robust.onnx' : '/online-k8.onnx', {
      executionProviders: ['webgpu'],
      graphOptimizationLevel: 'disabled',
    });
    const loadMs = performance.now() - startedLoad;
    let feeds;
    if (kind === 'robust') {
      feeds = { [session.inputNames[0]]: new ort.Tensor('float32', new Float32Array(29120), [1, 29120]) };
    } else {
      feeds = {
        audio_last_2048_sequence: new ort.Tensor('float32', new Float32Array(8 * 1 * 2048), [8, 1, 2048]),
        mel_buffer_in: new ort.Tensor('float32', new Float32Array(1 * 229 * 7), [1, 229, 7]),
        cache0_in: new ort.Tensor('float32', new Float32Array(1 * 64 * 5 * 229), [1, 64, 5, 229]),
        cache1_in: new ort.Tensor('float32', new Float32Array(1 * 64 * 3 * 114), [1, 64, 3, 114]),
        h_in: new ort.Tensor('float32', new Float32Array(2 * 1 * 512), [2, 1, 512]),
        c_in: new ort.Tensor('float32', new Float32Array(2 * 1 * 512), [2, 1, 512]),
        prev_output_in: new ort.Tensor('int64', new BigInt64Array(1 * 1 * 88), [1, 1, 88]),
      };
    }
    const startedRun = performance.now();
    const outputs = await session.run(feeds);
    const runMs = performance.now() - startedRun;
    return {
      backend: 'webgpu',
      modelLoadMs: loadMs,
      processingMs: runMs,
      actualInferenceSessionRunCount: 1,
      inputNames: session.inputNames,
      outputNames: Object.keys(outputs),
      acousticObservations: [],
      webgpuAdapter: {
        features: Array.from(adapter.features ?? []),
        info: adapter.info ? {
          vendor: adapter.info.vendor,
          architecture: adapter.info.architecture,
          device: adapter.info.device,
          description: adapter.info.description,
        } : null,
      },
    };
  }, { kind });
}

async function main() {
  const args = parseArgs(process.argv);
  const outputPath = path.resolve(args.output);
  await verifySha(IDENTITIES.robust.onnxPath, IDENTITIES.robust.onnxSha256);
  await verifySha(IDENTITIES.onlineAmt.onnxPath, IDENTITIES.onlineAmt.onnxSha256);
  await verifySha(IDENTITIES.basicPitch.modelJsonPath, IDENTITIES.basicPitch.modelJsonSha256);
  await verifySha(IDENTITIES.basicPitch.weightsPath, IDENTITIES.basicPitch.weightsSha256);
  const basicBundle = await bundleBasicPitch(BASIC_PITCH_WORK);
  const { server, url } = await startServer({ basicBundlePath: basicBundle });
  const browser = await chromium.launch({
    channel: args.channel,
    headless: !args.headed,
    args: [],
  });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    const browserIdentity = {
      channel: args.channel,
      version: await browser.version(),
      headed: Boolean(args.headed),
    };
    const cells = {};
    for (const [key, runner] of [
      ['robust-browser-v1', () => runOrt(page, 'robust')],
      ['online-amt-k8-browser-v1', () => runOrt(page, 'onlineAmt')],
      ['basic-pitch-browser-v1', () => page.evaluate(() => window.runBasicPitchAcceptance())],
    ]) {
      const started = Date.now();
      try {
        const result = await runner();
        cells[key] = {
          status: 'XC1_REAL_BROWSER_INFERENCE_COMPLETE',
          assetShaVerification: 'PASS',
          noScoreTruthInput: true,
          startedAtUnixMs: started,
          ...result,
        };
      } catch (error) {
        cells[key] = {
          status: 'XC1_REAL_BROWSER_INFERENCE_FAILED',
          assetShaVerification: 'PASS',
          noScoreTruthInput: true,
          error: String(error && error.stack ? error.stack : error),
        };
      }
    }
    const report = {
      phase: 'PHASE_9G_XC1_R3_REAL_EXECUTORS_F4_AND_FULL_SEALED_BAKEOFF',
      artifact: 'preF4RealExecutorAcceptance',
      browser: browserIdentity,
      environment: { os: `${os.platform()} ${os.release()} ${os.arch()}`, node: process.version },
      cells,
      overallStatus: Object.values(cells).every((cell) => cell.status === 'XC1_REAL_BROWSER_INFERENCE_COMPLETE')
        ? 'REAL_BROWSER_INFERENCE_PASS'
        : 'REAL_BROWSER_INFERENCE_FAILED',
    };
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    if (report.overallStatus !== 'REAL_BROWSER_INFERENCE_PASS') process.exitCode = 2;
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
