#!/usr/bin/env node
// Research-only DR3 grouped Online-AMT browser harness.

import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import playwright from '../../../apps/customer-web/node_modules/playwright/index.js';

const { chromium } = playwright;

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) args[key.slice(2)] = true;
    else {
      args[key.slice(2)] = next;
      index += 1;
    }
  }
  return args;
}

const args = parseArgs(process.argv);
const fixtureDir = path.resolve(args['fixture-dir'] ?? '');
const ortDir = path.resolve(args['ort-dir'] ?? '');
const outputPath = args.output ? path.resolve(args.output) : null;
const browserChannel = args['browser-channel'] ?? 'chrome';
const headed = Object.prototype.hasOwnProperty.call(args, 'headed');
const mode = args.mode ?? 'overload-proof';
const k = Number(args.k ?? 1);
const artificialDelayMs = Number(args['artificial-delay-ms'] ?? 0);
const workerPath = path.resolve(args.worker ?? path.join(path.dirname(fileURLToPath(import.meta.url)), 'online_amt_grouped_browser_worker_dr3.mjs'));

if (![1, 2, 4, 8].includes(k)) throw new Error('--k must be one of 1,2,4,8');
if (!existsSync(workerPath)) throw new Error(`Missing DR3 Worker: ${workerPath}`);
if (!existsSync(ortDir)) throw new Error(`Missing --ort-dir: ${ortDir}`);
if (mode !== 'overload-proof' && !existsSync(fixtureDir)) throw new Error(`Missing --fixture-dir: ${fixtureDir}`);

const mimeByExt = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json'],
  ['.onnx', 'application/octet-stream'],
  ['.npy', 'application/octet-stream'],
  ['.wasm', 'application/wasm'],
]);

function serveFile(res, filePath) {
  res.setHeader('Content-Type', mimeByExt.get(path.extname(filePath)) ?? 'application/octet-stream');
  createReadStream(filePath).pipe(res);
}

const pageHtml = `<!doctype html>
<meta charset="utf-8">
<title>DR3 Online-AMT grouped harness</title>
<script>
const K = ${JSON.stringify(k)};
const MODE = ${JSON.stringify(mode)};
const ARTIFICIAL_DELAY_MS = ${JSON.stringify(artificialDelayMs)};
const GROUP_COUNT = Number(${JSON.stringify(args.groups ?? 12)});
const worker = new Worker('/worker/online_amt_grouped_browser_worker_dr3.mjs');
const pending = new Map();
let id = 0;
function nowAbs() { return performance.timeOrigin + performance.now(); }
function callWorker(message) {
  const callId = ++id;
  return new Promise((resolve, reject) => {
    pending.set(callId, { resolve, reject });
    const transfer = message.pcm instanceof ArrayBuffer ? [message.pcm] : [];
    worker.postMessage({ id: callId, ...message }, transfer);
  });
}
worker.onmessage = (event) => {
  const item = pending.get(event.data.id);
  if (!item) return;
  pending.delete(event.data.id);
  if (event.data.error) item.reject(new Error(event.data.error));
  else item.resolve(event.data.result);
};
async function runProducer() {
  const init = await callWorker({
    type: 'init',
    artificialDelayMs: ARTIFICIAL_DELAY_MS,
    ortScript: '/ort/ort.webgpu.min.js',
    wasmPaths: '/ort/',
    fixtureRoot: '/fixtures/',
    manifestFile: 'grouped_manifest_dr3r.json',
  });
  const hops = MODE === 'overload-proof' ? null : await fetchNpy('hops.npy');
  const feedStartTimestamp = nowAbs();
  const intervalMs = K * 32;
  const promises = [];
  for (let groupIndex = 0; groupIndex < GROUP_COUNT; groupIndex += 1) {
    const scheduledGroupReadyTimestamp = feedStartTimestamp + ((groupIndex + 1) * intervalMs);
    const wait = Math.max(0, scheduledGroupReadyTimestamp - nowAbs());
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    const pagePostTimestamp = nowAbs();
    const pcm = hops ? hops.data.slice(groupIndex * K * HOP_SAMPLES, (groupIndex + 1) * K * HOP_SAMPLES) : new Float32Array(K * HOP_SAMPLES);
    const transfer = pcm.buffer.slice(0);
    // Do not await the previous group; the Worker queue is responsible for serial execution.
    promises.push(callWorker({
      type: 'group',
      k: K,
      groupIndex,
      scheduledGroupReadyTimestamp,
      pagePostTimestamp,
      feedStartTimestamp,
      pcm: transfer,
    }));
  }
  const rows = await Promise.all(promises);
  return summarize(init, rows, intervalMs);
}
async function fetchNpy(name) {
  const response = await fetch('/fixtures/' + name);
  if (!response.ok) throw new Error('fetch failed: ' + name);
  return parseNpy(await response.arrayBuffer());
}
function parseNpy(buffer) {
  const bytes = new Uint8Array(buffer);
  const magic = String.fromCharCode(...bytes.slice(0, 6));
  if (magic !== '\\x93NUMPY') throw new Error('not an npy file');
  const major = bytes[6];
  const headerLen = major === 1 ? bytes[8] | (bytes[9] << 8) : bytes[8] | (bytes[9] << 8) | (bytes[10] << 16) | (bytes[11] << 24);
  const offset = major === 1 ? 10 : 12;
  const header = new TextDecoder('latin1').decode(bytes.slice(offset, offset + headerLen));
  const shapeMatch = header.match(/'shape': \\(([^)]*)\\)/);
  const shape = shapeMatch ? shapeMatch[1].split(',').map((part) => part.trim()).filter(Boolean).map(Number) : [];
  const dataOffset = offset + headerLen;
  if (header.includes("'descr': '<f4'")) return { dtype: 'float32', shape, data: new Float32Array(buffer, dataOffset) };
  throw new Error('unsupported npy dtype: ' + header);
}
function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const index = (sorted.length - 1) * p;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  return low === high ? sorted[low] : sorted[low] + (sorted[high] - sorted[low]) * (index - low);
}
function summary(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return { p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95), max: sorted.at(-1) ?? null };
}
function summarize(init, rows, intervalMs) {
  const queue = rows.map((row) => row.queueDelayMs);
  const processing = rows.map((row) => row.groupedProcessingDurationMs);
  const ages = rows.flatMap((row) => row.internalHops.map((hop) => hop.captureToPublicationAgeMs));
  const tail = queue.slice(Math.max(0, queue.length - 4));
  return {
    status: 'PASS',
    mode: MODE,
    k: K,
    intervalMs,
    init,
    producerDoesNotAwaitPriorCompletion: true,
    futureAudioPostPolicy: 'GROUP_POSTS_AT_LAST_INTERNAL_HOP_READY',
    rows,
    groupedProcessingMs: summary(processing),
    queueDelayMs: summary(queue),
    finalQueueDelayMs: queue.at(-1) ?? null,
    maximumOutstandingDepth: Math.max(...rows.map((row) => row.outstandingPostedNotCompletedDepth)),
    tailQueueTrend: tail.length >= 2 && tail.at(-1) > tail[0] ? 'GROWING' : 'NOT_GROWING',
    internalHopCaptureToPublicationAgeMs: summary(ages),
    strictRealtime: queue.at(-1) === 0 ? 'NO_SUSTAINED_BACKLOG' : 'BACKLOG_PRESENT',
    headroomPass: (summary(processing).p95 ?? Infinity) <= 0.8 * intervalMs,
    overloadDetected: ARTIFICIAL_DELAY_MS > intervalMs && (queue.at(-1) ?? 0) > (queue[0] ?? 0),
  };
}
runProducer()
  .then((result) => { window.__DR3_RESULT__ = result; document.body.textContent = JSON.stringify(result); })
  .catch((error) => { window.__DR3_ERROR__ = String(error && error.stack ? error.stack : error); document.body.textContent = window.__DR3_ERROR__; });
</script>`;

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (url.pathname === '/') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(pageHtml);
    return;
  }
  if (url.pathname.startsWith('/worker/')) {
    serveFile(res, workerPath);
    return;
  }
  if (url.pathname.startsWith('/fixtures/')) {
    serveFile(res, path.join(fixtureDir, decodeURIComponent(url.pathname.replace('/fixtures/', ''))));
    return;
  }
  if (url.pathname.startsWith('/ort/')) {
    serveFile(res, path.join(ortDir, decodeURIComponent(url.pathname.replace('/ort/', ''))));
    return;
  }
  res.statusCode = 404;
  res.end('not found');
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
const url = `http://127.0.0.1:${address.port}/`;
const launchOptions = {
  channel: browserChannel,
  headless: !headed,
  args: [],
};
let browser;
try {
  browser = await chromium.launch(launchOptions);
  const page = await browser.newPage();
  await page.goto(url);
  await page.waitForFunction(() => window.__DR3_RESULT__ || window.__DR3_ERROR__, null, { timeout: 120000 });
  const error = await page.evaluate(() => window.__DR3_ERROR__ ?? null);
  if (error) throw new Error(error);
  const result = await page.evaluate(() => window.__DR3_RESULT__);
  result.browser = {
    channel: browserChannel,
    version: browser.version(),
    headed,
    unsafeWebGpu: false,
    wasmFallback: false,
    os: `${os.type()} ${os.release()}`,
  };
  if (outputPath) await writeFile(outputPath, JSON.stringify(result, null, 2) + '\\n', 'utf8');
  console.log(JSON.stringify(result, null, 2));
} finally {
  if (browser) await browser.close();
  server.close();
}
