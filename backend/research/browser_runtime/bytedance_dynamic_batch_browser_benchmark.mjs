#!/usr/bin/env node
// Research-only headed browser benchmark for ByteDance dynamic-batch ONNX.

import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import playwright from '../../../apps/customer-web/node_modules/playwright/index.js';

const { chromium } = playwright;
const __filename = fileURLToPath(import.meta.url);

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      args[key.slice(2)] = true;
    } else {
      args[key.slice(2)] = value;
      index += 1;
    }
  }
  return args;
}

const args = parseArgs(process.argv);
const modelPath = path.resolve(args.model ?? '');
const fixtureDir = path.resolve(args['fixture-dir'] ?? '');
const ortDir = path.resolve(args['ort-dir'] ?? '');
const outputPath = args.output ? path.resolve(args.output) : null;
const warmRuns = Number(args['warm-runs'] ?? 12);
const browserChannel = args['browser-channel'] ?? 'chrome';
const headed = Object.prototype.hasOwnProperty.call(args, 'headed');
const batchSizes = String(args['batch-sizes'] ?? '1,2,4,8').split(',').map((value) => Number(value.trim()));

if (!existsSync(modelPath)) throw new Error(`Missing --model: ${modelPath}`);
if (!existsSync(fixtureDir)) throw new Error(`Missing --fixture-dir: ${fixtureDir}`);
if (!existsSync(ortDir)) throw new Error(`Missing --ort-dir: ${ortDir}`);
if (!existsSync(path.join(ortDir, 'ort.webgpu.min.js'))) {
  throw new Error(`Missing ORT WebGPU runtime: ${path.join(ortDir, 'ort.webgpu.min.js')}`);
}
const ortPackagePath = path.resolve(ortDir, '..', 'package.json');
const ortPackage = JSON.parse(await readFile(ortPackagePath, 'utf8'));
const modelIdentity = await statAndHash(modelPath);

const pageHtml = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>ByteDance Dynamic Batch Benchmark</title></head>
<body>
<pre id="status">running</pre>
<script src="/ort/ort.webgpu.min.js"></script>
<script>
const WARM_RUNS = ${JSON.stringify(warmRuns)};
const BATCH_SIZES = ${JSON.stringify(batchSizes)};

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
  const shapeMatch = header.match(/'shape': \\(([^)]*)\\)/) || header.match(/"shape": \\[([^\\]]*)\\]/);
  if (!shapeMatch) throw new Error('cannot parse npy shape: ' + header);
  const shape = shapeMatch[1].split(',').map((part) => part.trim()).filter(Boolean).map(Number);
  return { shape, data: new Float32Array(buffer, offset + headerLen) };
}

async function fetchNpy(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('fetch failed: ' + url);
  return parseNpy(await response.arrayBuffer());
}

function percentile(values, q) {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * q) - 1);
  return sorted[index] ?? null;
}

function summarize(samples, batchSize) {
  const median = percentile(samples, 0.5);
  const p95 = percentile(samples, 0.95);
  return {
    samples,
    minMs: Math.min(...samples),
    medianMs: median,
    p95Ms: p95,
    maxMs: Math.max(...samples),
    medianMsPerWindow: median / batchSize,
    p95MsPerWindow: p95 / batchSize,
    medianWindowsPerSecond: batchSize / (median / 1000),
    p95WindowsPerSecond: batchSize / (p95 / 1000),
  };
}

function compareFloatArrays(actual, expected) {
  if (actual.length !== expected.length) throw new Error('raw tensor length mismatch');
  let sum = 0;
  let max = 0;
  for (let index = 0; index < actual.length; index += 1) {
    const delta = Math.abs(actual[index] - expected[index]);
    sum += delta;
    max = Math.max(max, delta);
  }
  return {
    meanAbsDelta: sum / actual.length,
    maxAbsDelta: max,
  };
}

async function main() {
  if (!navigator.gpu) throw new Error('WebGPU unavailable');
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('WebGPU adapter unavailable');
  let adapterInfo = null;
  try {
    adapterInfo = typeof adapter.requestAdapterInfo === 'function'
      ? await adapter.requestAdapterInfo()
      : adapter.info ?? null;
  } catch (error) {
    adapterInfo = { error: String(error && error.stack ? error.stack : error) };
  }

  ort.env.wasm.wasmPaths = '/ort/';
  const startedLoad = performance.now();
  const session = await ort.InferenceSession.create('/model.onnx', {
    executionProviders: ['webgpu'],
    graphOptimizationLevel: 'disabled',
  });
  const modelLoadMs = performance.now() - startedLoad;

  const manifest = await (await fetch('/fixtures/manifest.json')).json();
  const inputs = [];
  const references = [];
  for (const fixture of manifest.fixtures) {
    inputs.push(await fetchNpy('/fixtures/' + fixture.input_tensor_npy));
    references.push({
      onset: await fetchNpy('/fixtures/' + fixture.reg_onset_output_npy),
      frame: await fetchNpy('/fixtures/' + fixture.frame_output_npy),
    });
  }
  const inputSamples = inputs[0].shape[0];
  const results = {};
  for (const batchSize of BATCH_SIZES) {
    const batched = new Float32Array(batchSize * inputSamples);
    for (let index = 0; index < batchSize; index += 1) {
      batched.set(inputs[index % inputs.length].data, index * inputSamples);
    }
    const tensor = new ort.Tensor('float32', batched, [batchSize, inputSamples]);
    const firstStarted = performance.now();
    const firstOutput = await session.run({ audio: tensor });
    const firstInferenceMs = performance.now() - firstStarted;
    const rawParity = [];
    const onsetDims = Array.from(firstOutput.reg_onset_output.dims);
    const frameDims = Array.from(firstOutput.frame_output.dims);
    const onsetItemLength = onsetDims.slice(1).reduce((product, value) => product * value, 1);
    const frameItemLength = frameDims.slice(1).reduce((product, value) => product * value, 1);
    for (let index = 0; index < batchSize; index += 1) {
      const fixtureIndex = index % inputs.length;
      rawParity.push({
        index,
        fixtureInputIndex: fixtureIndex,
        regOnset: compareFloatArrays(
          firstOutput.reg_onset_output.data.subarray(index * onsetItemLength, (index + 1) * onsetItemLength),
          references[fixtureIndex].onset.data,
        ),
        frame: compareFloatArrays(
          firstOutput.frame_output.data.subarray(index * frameItemLength, (index + 1) * frameItemLength),
          references[fixtureIndex].frame.data,
        ),
      });
    }
    const samples = [];
    for (let run = 0; run < WARM_RUNS; run += 1) {
      const started = performance.now();
      await session.run({ audio: tensor });
      samples.push(performance.now() - started);
    }
    results[String(batchSize)] = {
      batchSize,
      inputShape: [batchSize, inputSamples],
      firstInferenceMs,
      outputShapes: {
        regOnset: Array.from(firstOutput.reg_onset_output.dims),
        frame: Array.from(firstOutput.frame_output.dims),
      },
      rawParity,
      warm: summarize(samples, batchSize),
    };
  }
  return {
    backend: 'webgpu',
    ortVersion: ort.version ?? null,
    userAgent: navigator.userAgent,
    webgpu: {
      available: true,
      adapterAcquired: true,
      adapter: {
        isFallbackAdapter: adapter.isFallbackAdapter ?? null,
        features: Array.from(adapter.features ?? []),
        info: adapterInfo,
      },
    },
    modelLoadMs,
    warmRuns: WARM_RUNS,
    results,
  };
}

main().then((result) => {
  window.__RESULT__ = result;
  document.getElementById('status').textContent = JSON.stringify(result, null, 2);
}).catch((error) => {
  window.__ERROR__ = String(error && error.stack ? error.stack : error);
  document.getElementById('status').textContent = window.__ERROR__;
});
</script>
</body>
</html>`;

const mimeByExt = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.onnx', 'application/octet-stream'],
  ['.npy', 'application/octet-stream'],
  ['.wasm', 'application/wasm'],
]);

function serveFile(res, filePath) {
  res.setHeader('Content-Type', mimeByExt.get(path.extname(filePath)) ?? 'application/octet-stream');
  createReadStream(filePath).pipe(res);
}

const server = createServer((req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(pageHtml);
      return;
    }
    if (url.pathname === '/favicon.ico') {
      res.statusCode = 204;
      res.end();
      return;
    }
    if (url.pathname === '/model.onnx') return serveFile(res, modelPath);
    if (url.pathname.startsWith('/fixtures/')) {
      return serveFile(res, path.join(fixtureDir, decodeURIComponent(url.pathname.slice('/fixtures/'.length))));
    }
    if (url.pathname.startsWith('/ort/')) {
      return serveFile(res, path.join(ortDir, decodeURIComponent(url.pathname.slice('/ort/'.length))));
    }
    res.statusCode = 404;
    res.end('not found');
  } catch (error) {
    res.statusCode = 500;
    res.end(String(error && error.stack ? error.stack : error));
  }
});

server.listen(0, '127.0.0.1', async () => {
  const address = server.address();
  const browser = await chromium.launch({
    headless: !headed,
    channel: browserChannel,
    args: ['--enable-unsafe-webgpu'],
  });
  const browserConsole = [];
  try {
    const page = await browser.newPage();
    page.on('console', (message) => browserConsole.push({ type: message.type(), text: message.text() }));
    page.on('pageerror', (error) => browserConsole.push({ type: 'pageerror', text: error.stack ?? error.message }));
    await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__RESULT__ || window.__ERROR__, null, { timeout: 300000 });
    const result = await page.evaluate(() => ({ result: window.__RESULT__ ?? null, error: window.__ERROR__ ?? null }));
    const report = {
      reportType: 'continuous_dynamic_batch_browser_benchmark',
      command: process.argv.join(' '),
      runtime: {
        browserChannel,
        headed,
        browserVersion: browser.version(),
        os: { platform: os.platform(), release: os.release(), arch: os.arch() },
      },
      ortAsset: {
        version: ortPackage.version,
        packagePath: ortPackagePath,
        distDirectory: ortDir,
      },
      model: {
        path: modelPath,
        byteSize: modelIdentity.byteSize,
        sha256: modelIdentity.sha256,
      },
      browserConsole,
      ...result,
    };
    if (outputPath) {
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, JSON.stringify(report, null, 2), 'utf8');
    }
    console.log(JSON.stringify(report, null, 2));
    if (result.error) process.exitCode = 1;
  } finally {
    await browser.close();
    server.close();
  }
});

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
