#!/usr/bin/env node
// Research-only browser harness for the ByteDance fixed-anchor ONNX export.
//
// This is intentionally outside production code. It serves the exported ONNX
// model, golden .npy fixtures, and onnxruntime-web assets to a real Chromium
// page, then compares browser raw outputs against PyTorch golden outputs.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import playwright from '../../../apps/customer-web/node_modules/playwright/index.js';

const { chromium } = playwright;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    args[key.slice(2)] = argv[i + 1];
    i += 1;
  }
  return args;
}

const args = parseArgs(process.argv);
const modelPath = path.resolve(args.model ?? '');
const fixtureDir = path.resolve(args['fixture-dir'] ?? '');
const ortDir = path.resolve(args['ort-dir'] ?? '');
const backend = args.backend ?? 'webgpu';
const warmRuns = Number(args['warm-runs'] ?? 20);
const outputPath = args.output ? path.resolve(args.output) : null;

if (!existsSync(modelPath)) throw new Error(`Missing --model: ${modelPath}`);
if (!existsSync(fixtureDir)) throw new Error(`Missing --fixture-dir: ${fixtureDir}`);
if (!existsSync(ortDir)) throw new Error(`Missing --ort-dir: ${ortDir}`);

const ortScript = backend === 'webgpu' ? 'ort.webgpu.min.js' : 'ort.min.js';
if (!existsSync(path.join(ortDir, ortScript))) {
  throw new Error(`Missing ORT Web script: ${path.join(ortDir, ortScript)}`);
}

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
  const ext = path.extname(filePath);
  res.setHeader('Content-Type', mimeByExt.get(ext) ?? 'application/octet-stream');
  createReadStream(filePath).pipe(res);
}

const pageHtml = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>ByteDance ONNX Browser Harness</title></head>
<body>
<pre id="status">running</pre>
<script src="/ort/${ortScript}"></script>
<script>
const BACKEND = ${JSON.stringify(backend)};
const WARM_RUNS = ${JSON.stringify(warmRuns)};
const ONSET_THRESHOLD = 0.2;
const FRAME_THRESHOLD = 0.2;
const LOCAL_PRE_SECONDS = 0.05;
const LOCAL_POST_SECONDS = 0.12;
const TARGET_ANCHOR_SECONDS = 1.6;
const MIDI_OFFSET = 21;

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
  if (header.includes("'fortran_order': True") || header.includes('"fortran_order": true')) {
    throw new Error('fortran-order npy is not supported');
  }
  const shapeMatch = header.match(/'shape': \\(([^)]*)\\)/) || header.match(/"shape": \\[([^\\]]*)\\]/);
  if (!shapeMatch) throw new Error('cannot parse npy shape: ' + header);
  const shape = shapeMatch[1]
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map(Number);
  const dataOffset = offset + headerLen;
  return { shape, data: new Float32Array(buffer, dataOffset) };
}

async function fetchNpy(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('fetch failed: ' + url);
  return parseNpy(await response.arrayBuffer());
}

function pitchToMidi(pitch) {
  const match = /^([A-G])([#b]?)(-?\\d+)$/.exec(pitch);
  if (!match) throw new Error('bad pitch ' + pitch);
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[match[1]];
  const accidental = match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0;
  const octave = Number(match[3]);
  return 12 * (octave + 1) + base + accidental;
}

function expectedDecision(onset, frame, fixture) {
  const frameCount = onset.shape[0];
  const clipStart = fixture.target_second - TARGET_ANCHOR_SECONDS;
  for (const pitch of fixture.expected_pitches) {
    const pitchIndex = pitchToMidi(pitch) - MIDI_OFFSET;
    let onsetMax = -Infinity;
    let frameMax = -Infinity;
    for (let t = 0; t < frameCount; t += 1) {
      const absoluteTime = clipStart + t / 100.0;
      if (absoluteTime < fixture.target_second - LOCAL_PRE_SECONDS) continue;
      if (absoluteTime > fixture.target_second + LOCAL_POST_SECONDS) continue;
      const valueIndex = t * 88 + pitchIndex;
      onsetMax = Math.max(onsetMax, onset.data[valueIndex]);
      frameMax = Math.max(frameMax, frame.data[valueIndex]);
    }
    if (!(onsetMax >= ONSET_THRESHOLD && frameMax >= FRAME_THRESHOLD)) return false;
  }
  return true;
}

function compareFloatArrays(actual, expected) {
  if (actual.length !== expected.length) throw new Error('length mismatch');
  let sum = 0;
  let max = 0;
  for (let i = 0; i < actual.length; i += 1) {
    const delta = Math.abs(actual[i] - expected[i]);
    sum += delta;
    max = Math.max(max, delta);
  }
  return { mean_abs_delta: sum / actual.length, max_abs_delta: max };
}

async function main() {
  ort.env.wasm.wasmPaths = '/ort/';
  const startedLoad = performance.now();
  const session = await ort.InferenceSession.create('/model.onnx', {
    executionProviders: [BACKEND],
    graphOptimizationLevel: 'disabled',
  });
  const loadMs = performance.now() - startedLoad;
  const manifest = await (await fetch('/fixtures/manifest.json')).json();
  const comparisons = [];
  let firstInferenceMs = null;
  const warmLatencies = [];
  for (const [fixtureIndex, fixture] of manifest.fixtures.entries()) {
    const input = await fetchNpy('/fixtures/' + fixture.input_tensor_npy);
    const onsetRef = await fetchNpy('/fixtures/' + fixture.reg_onset_output_npy);
    const frameRef = await fetchNpy('/fixtures/' + fixture.frame_output_npy);
    const tensor = new ort.Tensor('float32', input.data, [1, input.shape[0]]);
    const started = performance.now();
    const output = await session.run({ audio: tensor });
    const inferenceMs = performance.now() - started;
    if (fixtureIndex === 0) firstInferenceMs = inferenceMs;
    const onset = { shape: Array.from(output.reg_onset_output.dims).slice(1), data: output.reg_onset_output.data };
    const frame = { shape: Array.from(output.frame_output.dims).slice(1), data: output.frame_output.data };
    comparisons.push({
      fixture_id: fixture.fixture_id,
      onset_shape_equal: JSON.stringify(onset.shape) === JSON.stringify(onsetRef.shape),
      frame_shape_equal: JSON.stringify(frame.shape) === JSON.stringify(frameRef.shape),
      onset: compareFloatArrays(onset.data, onsetRef.data),
      frame: compareFloatArrays(frame.data, frameRef.data),
      verifier_decision_agree:
        expectedDecision(onset, frame, fixture) === expectedDecision(onsetRef, frameRef, fixture),
    });
    if (fixtureIndex === 0) {
      for (let i = 0; i < WARM_RUNS; i += 1) {
        const warmStarted = performance.now();
        await session.run({ audio: tensor });
        warmLatencies.push(performance.now() - warmStarted);
      }
    }
  }
  warmLatencies.sort((a, b) => a - b);
  const p95Index = Math.min(warmLatencies.length - 1, Math.ceil(warmLatencies.length * 0.95) - 1);
  return {
    backend: BACKEND,
    user_agent: navigator.userAgent,
    webgpu_available: Boolean(navigator.gpu),
    model_load_ms: loadMs,
    first_inference_ms: firstInferenceMs,
    warm_inference_ms: {
      runs: warmLatencies.length,
      median: warmLatencies[Math.floor(warmLatencies.length / 2)] ?? null,
      p95: warmLatencies[p95Index] ?? null,
    },
    comparisons,
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

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(pageHtml);
      return;
    }
    if (url.pathname === '/model.onnx') return serveFile(res, modelPath);
    if (url.pathname.startsWith('/fixtures/')) {
      const rel = decodeURIComponent(url.pathname.slice('/fixtures/'.length));
      return serveFile(res, path.join(fixtureDir, rel));
    }
    if (url.pathname.startsWith('/ort/')) {
      const rel = decodeURIComponent(url.pathname.slice('/ort/'.length));
      return serveFile(res, path.join(ortDir, rel));
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
    headless: true,
    args: backend === 'webgpu' ? ['--enable-unsafe-webgpu'] : [],
  });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__RESULT__ || window.__ERROR__, null, { timeout: 120000 });
    const result = await page.evaluate(() => ({ result: window.__RESULT__ ?? null, error: window.__ERROR__ ?? null }));
    if (outputPath) {
      await import('node:fs/promises').then((fs) =>
        fs.writeFile(outputPath, JSON.stringify(result, null, 2), 'utf8'),
      );
    }
    console.log(JSON.stringify(result, null, 2));
    if (result.error) process.exitCode = 1;
  } finally {
    await browser.close();
    server.close();
  }
});
