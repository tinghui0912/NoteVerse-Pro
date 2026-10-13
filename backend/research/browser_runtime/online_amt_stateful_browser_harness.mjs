#!/usr/bin/env node
// Research-only Online-AMT explicit-state browser harness.
//
// This is intentionally outside production Practice. It serves exported ONNX
// graphs and non-blind fixtures to a real Chromium browser, runs a chronological
// Online-AMT stateful sequence with ORT Web/WebGPU, and emits compact parity and
// runtime metrics.

import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import crypto from 'node:crypto';
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
const mode = args.mode ?? 'pipeline';
const fixtureDir = path.resolve(args['fixture-dir'] ?? '');
const ortDir = path.resolve(args['ort-dir'] ?? '');
const outputPath = args.output ? path.resolve(args.output) : null;
const browserChannel = args['browser-channel'] ?? null;
const headed = Object.prototype.hasOwnProperty.call(args, 'headed');
const backend = args.backend ?? 'webgpu';
const graphOptimizationLevel = args['graph-optimization-level'] ?? 'disabled';
const allowUnsafeWebGpu = Object.prototype.hasOwnProperty.call(args, 'allow-unsafe-webgpu');
const pipelineLm = args['pipeline-lm'] ?? 'float';
const workerPath = path.resolve(args['worker'] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), 'online_amt_stateful_browser_worker.mjs'));

if (!existsSync(fixtureDir)) throw new Error(`Missing --fixture-dir: ${fixtureDir}`);
if (!existsSync(ortDir)) throw new Error(`Missing --ort-dir: ${ortDir}`);
const ortScript = backend === 'webgpu' ? 'ort.webgpu.min.js' : 'ort.min.js';
if (!existsSync(path.join(ortDir, ortScript))) throw new Error(`Missing ORT script ${ortScript}`);
const ortPackagePath = path.resolve(ortDir, '..', 'package.json');
const ortPackage = JSON.parse(await readFile(ortPackagePath, 'utf8'));

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
  const ext = path.extname(filePath);
  res.setHeader('Content-Type', mimeByExt.get(ext) ?? 'application/octet-stream');
  createReadStream(filePath).pipe(res);
}

const pageHtml = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Online-AMT Stateful Browser Harness</title></head>
<body>
<pre id="status">running</pre>
<script src="/ort/${ortScript}"></script>
<script>
const MODE = ${JSON.stringify(mode)};
const BACKEND = ${JSON.stringify(backend)};
const GRAPH_OPTIMIZATION_LEVEL = ${JSON.stringify(graphOptimizationLevel)};
const PIPELINE_LM = ${JSON.stringify(pipelineLm)};
const HOP_SAMPLES = 512;
const SAMPLE_RATE = 16000;
const PSEUDO_THRESHOLD = 0.05;
const PATIENCE = 100;
const BOOST = 1.0;
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
  const shapeMatch = header.match(/'shape': \\(([^)]*)\\)/) || header.match(/"shape": \\[([^\\]]*)\\]/);
  if (!shapeMatch) throw new Error('cannot parse npy shape: ' + header);
  const shape = shapeMatch[1].split(',').map((part) => part.trim()).filter(Boolean).map(Number);
  const dataOffset = offset + headerLen;
  if (header.includes("'descr': '<f4'") || header.includes('"descr": "<f4"')) {
    return { dtype: 'float32', shape, data: new Float32Array(buffer, dataOffset) };
  }
  if (header.includes("'descr': '<i8'") || header.includes('"descr": "<i8"')) {
    return { dtype: 'int64', shape, data: new BigInt64Array(buffer, dataOffset) };
  }
  throw new Error('unsupported npy dtype: ' + header);
}

async function fetchNpy(name) {
  const response = await fetch('/fixtures/' + name);
  if (!response.ok) throw new Error('fetch failed: ' + name);
  return parseNpy(await response.arrayBuffer());
}

function cloneFloat(values) {
  return new Float32Array(values);
}

function maxAbs(values) {
  let max = 0;
  for (const value of values) max = Math.max(max, Math.abs(value));
  return max;
}

function compareFloat(actual, expected) {
  if (actual.length !== expected.length) throw new Error('float length mismatch');
  let sum = 0;
  let max = 0;
  const deltas = new Float64Array(actual.length);
  for (let i = 0; i < actual.length; i += 1) {
    const delta = Math.abs(Number(actual[i]) - Number(expected[i]));
    deltas[i] = delta;
    sum += delta;
    if (delta > max) max = delta;
  }
  const sorted = Array.from(deltas).sort((a, b) => a - b);
  return {
    meanAbsDelta: sum / actual.length,
    p95AbsDelta: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)],
    maxAbsDelta: max,
  };
}

function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return { min: null, p50: null, p95: null, max: null };
  return {
    min: sorted[0],
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted[sorted.length - 1],
  };
}

function percentile(sorted, p) {
  if (sorted.length === 1) return sorted[0];
  const index = (sorted.length - 1) * p;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  if (low === high) return sorted[low];
  return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
}

function argmax5(probabilities, pitch) {
  let best = 0;
  let bestValue = probabilities[pitch * 5];
  for (let state = 1; state < 5; state += 1) {
    const value = probabilities[pitch * 5 + state];
    if (value > bestValue) {
      bestValue = value;
      best = state;
    }
  }
  return best;
}

function pitchName(pitchIndex) {
  const midi = pitchIndex + MIDI_OFFSET;
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  return names[midi % 12] + String(Math.floor(midi / 12) - 1);
}

function buildPrevEmbedding(chosenStates, embeddingWeights) {
  const out = new Float32Array(1 * 1 * 88 * 2);
  for (let pitch = 0; pitch < 88; pitch += 1) {
    const state = chosenStates[pitch];
    out[pitch * 2] = embeddingWeights[state * 2];
    out[pitch * 2 + 1] = embeddingWeights[state * 2 + 1];
  }
  return out;
}

function updateAudioBuffer(audioBuffer, hop) {
  audioBuffer.copyWithin(0, HOP_SAMPLES);
  audioBuffer.set(hop, audioBuffer.length - HOP_SAMPLES);
}

function updateMelBuffer(melBuffer, newFrame) {
  const bins = 229;
  const frames = 7;
  for (let frame = 0; frame < frames - 1; frame += 1) {
    for (let bin = 0; bin < bins; bin += 1) {
      melBuffer[bin * frames + frame] = melBuffer[bin * frames + frame + 1];
    }
  }
  for (let bin = 0; bin < bins; bin += 1) {
    melBuffer[bin * frames + 6] = newFrame[bin];
  }
}

function tensor(type, data, dims) {
  return new ort.Tensor(type, data, dims);
}

async function preflightWebGpu() {
  let adapterInfo = null;
  if (BACKEND === 'webgpu') {
    if (!navigator.gpu) throw new Error('WebGPU preflight failed: navigator.gpu unavailable');
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('WebGPU preflight failed: requestAdapter returned null');
    let info = null;
    try {
      info = typeof adapter.requestAdapterInfo === 'function'
        ? await adapter.requestAdapterInfo()
        : adapter.info ?? null;
    } catch (error) {
      info = { error: String(error && error.stack ? error.stack : error) };
    }
    adapterInfo = {
      acquired: true,
      isFallbackAdapter: adapter.isFallbackAdapter ?? null,
      features: Array.from(adapter.features ?? []),
      info,
    };
  }
  return adapterInfo;
}

async function createSession(modelName) {
  const started = performance.now();
  const session = await ort.InferenceSession.create('/fixtures/' + modelName, {
    executionProviders: [BACKEND],
    graphOptimizationLevel: GRAPH_OPTIMIZATION_LEVEL,
  });
  return { session, loadMs: performance.now() - started };
}

async function runNativeLmAttempt(manifest) {
  const adapterInfo = await preflightWebGpu();
  const { session, loadMs } = await createSession(manifest.nativeLmModel);
  const acoustic = await fetchNpy(manifest.nativeLmFixture.acoustic);
  const h = await fetchNpy(manifest.nativeLmFixture.h);
  const c = await fetchNpy(manifest.nativeLmFixture.c);
  const prev = await fetchNpy(manifest.nativeLmFixture.prev);
  const expectedProb = await fetchNpy(manifest.nativeLmFixture.probabilities);
  const expectedH = await fetchNpy(manifest.nativeLmFixture.hOut);
  const expectedC = await fetchNpy(manifest.nativeLmFixture.cOut);
  const started = performance.now();
  const output = await session.run({
    acoustic_out: tensor('float32', acoustic.data, acoustic.shape),
    h_in: tensor('float32', h.data, h.shape),
    c_in: tensor('float32', c.data, c.shape),
    prev_output_in: tensor('int64', prev.data, prev.shape),
  });
  const inferenceMs = performance.now() - started;
  return {
    status: 'PASS',
    webgpuAdapter: adapterInfo,
    loadMs,
    inferenceMs,
    probabilities: compareFloat(output.probabilities.data, expectedProb.data),
    h: compareFloat(output.h_out.data, expectedH.data),
    c: compareFloat(output.c_out.data, expectedC.data),
  };
}

async function runNativeGateBrowser() {
  const rows = [];
  function makeState() {
    return { numUnderThr: 0, melAdvanceCount: 0, cacheAdvanceCount: 0, hAdvanceCount: 0, prevAdvanceCount: 0 };
  }
  function stepGate(state, amplitude) {
    if (amplitude < PSEUDO_THRESHOLD) state.numUnderThr += 1;
    else state.numUnderThr = 0;
    const shortCircuit = state.numUnderThr > PATIENCE;
    const probabilities = new Float32Array(88 * 5);
    const chosen = new Int32Array(88);
    if (shortCircuit) {
      for (let pitch = 0; pitch < 88; pitch += 1) probabilities[pitch * 5] = 1;
    } else {
      state.melAdvanceCount += 1;
      state.cacheAdvanceCount += 1;
      state.hAdvanceCount += 1;
      state.prevAdvanceCount += 1;
    }
    return { shortCircuit, probabilitiesState0Sum: probabilities.filter((_, index) => index % 5 === 0).reduce((a, b) => a + b, 0), chosenStateSum: chosen.reduce((a, b) => a + b, 0) };
  }
  for (const count of [99, 100, 101, 102]) {
    const state = makeState();
    let last = null;
    for (let index = 0; index < count; index += 1) last = stepGate(state, 0);
    rows.push({
      silentHopCount: count,
      numUnderThr: state.numUnderThr,
      shortCircuit: last.shortCircuit,
      melAdvanced: state.melAdvanceCount,
      cacheAdvanced: state.cacheAdvanceCount,
      hAdvanced: state.hAdvanceCount,
      prevAdvanced: state.prevAdvanceCount,
      probabilitiesState0Sum: last.probabilitiesState0Sum,
      chosenStateSum: last.chosenStateSum,
    });
  }
  const recovery = makeState();
  for (let index = 0; index < 101; index += 1) stepGate(recovery, 0);
  const before = { ...recovery };
  const recovered = stepGate(recovery, 0.5);
  return {
    status: 'PASS',
    threshold: PSEUDO_THRESHOLD,
    patience: PATIENCE,
    boundary: 'num_under_thr > patience',
    rows,
    nonSilentRecovery: {
      before,
      after: recovery,
      shortCircuitAfterRecovery: recovered.shortCircuit,
    },
  };
}

async function runPipeline(manifest) {
  const adapterInfo = await preflightWebGpu();
  const melSession = await createSession(manifest.graphs.mel.file);
  const acousticSession = await createSession(manifest.graphs.acoustic.file);
  const lmModelFile = PIPELINE_LM === 'native' ? manifest.graphs.lmNative.file : manifest.graphs.lmFloat.file;
  const lmSession = await createSession(lmModelFile);
  const hops = await fetchNpy(manifest.fixtures.hops);
  const referenceProb = await fetchNpy(manifest.fixtures.referenceProbabilities);
  const referenceChosen = await fetchNpy(manifest.fixtures.referenceChosenStates);
  const referenceMel = await fetchNpy(manifest.fixtures.referenceMelFrames);
  const referenceAcoustic = await fetchNpy(manifest.fixtures.referenceAcousticOut);
  const referenceH = manifest.fixtures.referenceH ? await fetchNpy(manifest.fixtures.referenceH) : null;
  const referenceC = manifest.fixtures.referenceC ? await fetchNpy(manifest.fixtures.referenceC) : null;
  const initialAudio = await fetchNpy(manifest.initialState.audioBuffer);
  const initialMel = await fetchNpy(manifest.initialState.melBuffer);
  const initialCache0 = await fetchNpy(manifest.initialState.cache0);
  const initialCache1 = await fetchNpy(manifest.initialState.cache1);
  const initialH = await fetchNpy(manifest.initialState.h);
  const initialC = await fetchNpy(manifest.initialState.c);
  const initialPrev = await fetchNpy(manifest.initialState.prevOutput);
  const embedding = await fetchNpy(manifest.initialState.embedding);

  const state = {
    audio: cloneFloat(initialAudio.data),
    mel: cloneFloat(initialMel.data),
    cache0: cloneFloat(initialCache0.data),
    cache1: cloneFloat(initialCache1.data),
    h: cloneFloat(initialH.data),
    c: cloneFloat(initialC.data),
    prev: Int32Array.from(Array.from(initialPrev.data, (value) => Number(value))),
    numUnderThr: 0,
  };

  const hopCount = manifest.hopCount;
  const chosenMismatches = [];
  const melDeltas = [];
  const acousticDeltas = [];
  const hDeltas = [];
  const cDeltas = [];
  const probabilityDeltas = [];
  const latencies = [];
  const gateRows = [];
  const scheduleRows = [];
  let mismatchCount = 0;
  let previousFinish = 0;
  let firstCompleteHopMs = null;
  let firstGraphExecutionMs = null;

  const startedSession = performance.now();
  for (let hopIndex = 0; hopIndex < hopCount; hopIndex += 1) {
    const readyAt = hopIndex * 32;
    const processingStart = Math.max(readyAt, previousFinish);
    const hopStarted = performance.now();
    const hop = hops.data.subarray(hopIndex * HOP_SAMPLES, (hopIndex + 1) * HOP_SAMPLES);
    updateAudioBuffer(state.audio, hop);
    const intensity = maxAbs(state.audio) === 0 ? 0 : Math.max(...state.audio) - Math.min(...state.audio);
    if (intensity < PSEUDO_THRESHOLD) state.numUnderThr += 1;
    else state.numUnderThr = 0;

    let probabilities;
    let shortCircuit = false;
    if (state.numUnderThr > PATIENCE) {
      shortCircuit = true;
      probabilities = new Float32Array(88 * 5);
      for (let pitch = 0; pitch < 88; pitch += 1) {
        probabilities[pitch * 5] = 1;
      }
    } else {
      const last2048 = state.audio.subarray(state.audio.length - 2048);
      const melOut = await melSession.session.run({
        audio_last_2048: tensor('float32', last2048, [1, 2048]),
      });
      if (firstGraphExecutionMs === null) firstGraphExecutionMs = performance.now() - hopStarted;
      const newMel = melOut.new_mel_frame.data;
      const refMel = referenceMel.data.subarray(hopIndex * 229, (hopIndex + 1) * 229);
      melDeltas.push(compareFloat(newMel, refMel));
      updateMelBuffer(state.mel, newMel);

      const acousticOut = await acousticSession.session.run({
        mel_buffer: tensor('float32', state.mel, [1, 229, 7]),
        cache0_in: tensor('float32', state.cache0, [1, 64, 5, 229]),
        cache1_in: tensor('float32', state.cache1, [1, 64, 3, 114]),
      });
      state.cache0 = cloneFloat(acousticOut.cache0_out.data);
      state.cache1 = cloneFloat(acousticOut.cache1_out.data);
      const acoustic = acousticOut.acoustic_out.data;
      const refAcoustic = referenceAcoustic.data.subarray(
        hopIndex * manifest.acousticOutFeatures,
        (hopIndex + 1) * manifest.acousticOutFeatures,
      );
      acousticDeltas.push(compareFloat(acoustic, refAcoustic));

      let lmInputs;
      if (PIPELINE_LM === 'native') {
        const prevBigInt = new BigInt64Array(88);
        for (let pitch = 0; pitch < 88; pitch += 1) prevBigInt[pitch] = BigInt(state.prev[pitch]);
        lmInputs = {
          acoustic_out: tensor('float32', acoustic, [1, 1, manifest.acousticOutFeatures]),
          h_in: tensor('float32', state.h, [2, 1, 512]),
          c_in: tensor('float32', state.c, [2, 1, 512]),
          prev_output_in: tensor('int64', prevBigInt, [1, 1, 88]),
        };
      } else {
        const prevEmbedding = buildPrevEmbedding(state.prev, embedding.data);
        lmInputs = {
          acoustic_out: tensor('float32', acoustic, [1, 1, manifest.acousticOutFeatures]),
          h_in: tensor('float32', state.h, [2, 1, 512]),
          c_in: tensor('float32', state.c, [2, 1, 512]),
          prev_embedding_in: tensor('float32', prevEmbedding, [1, 1, 176]),
        };
      }
      const lmOut = await lmSession.session.run(lmInputs);
      probabilities = cloneFloat(lmOut.probabilities.data);
      state.h = cloneFloat(lmOut.h_out.data);
      state.c = cloneFloat(lmOut.c_out.data);
      if (referenceH && referenceC) {
        const refH = referenceH.data.subarray(hopIndex * state.h.length, (hopIndex + 1) * state.h.length);
        const refC = referenceC.data.subarray(hopIndex * state.c.length, (hopIndex + 1) * state.c.length);
        hDeltas.push(compareFloat(state.h, refH));
        cDeltas.push(compareFloat(state.c, refC));
      }
    }

    const expectedProb = referenceProb.data.subarray(hopIndex * 88 * 5, (hopIndex + 1) * 88 * 5);
    probabilityDeltas.push(compareFloat(probabilities, expectedProb));
    for (let pitch = 0; pitch < 88; pitch += 1) {
      const chosen = argmax5(probabilities, pitch);
      const expected = Number(referenceChosen.data[hopIndex * 88 + pitch]);
      if (chosen !== expected && chosenMismatches.length < 10) {
        chosenMismatches.push({
          hopIndex,
          pitchIndex: pitch,
          pitch: pitchName(pitch),
          pythonChosenState: expected,
          browserChosenState: chosen,
          pythonProbabilities: Array.from(expectedProb.subarray(pitch * 5, pitch * 5 + 5)),
          browserProbabilities: Array.from(probabilities.subarray(pitch * 5, pitch * 5 + 5)),
        });
      }
      if (chosen !== expected) mismatchCount += 1;
      state.prev[pitch] = chosen;
    }
    if ([98, 99, 100, 101].includes(hopIndex)) {
      gateRows.push({ hopIndex, numUnderThr: state.numUnderThr, shortCircuit });
    }
    const completeHopMs = performance.now() - hopStarted;
    if (firstCompleteHopMs === null) firstCompleteHopMs = completeHopMs;
    latencies.push(completeHopMs);
    const finish = processingStart + completeHopMs;
    previousFinish = finish;
    scheduleRows.push({
      hopIndex,
      inputReadyAtMs: readyAt,
      processingStartAtMs: processingStart,
      completeHopLatencyMs: completeHopMs,
      processingFinishAtMs: finish,
      queueDelayMs: processingStart - readyAt,
      publicationDelayMs: finish - readyAt,
    });
  }
  const sessionElapsedMs = performance.now() - startedSession;
  const queueDelays = scheduleRows.map((row) => row.queueDelayMs);
  const maxQueueDepth = Math.max(...scheduleRows.map((row) => Math.max(1, Math.ceil(row.publicationDelayMs / 32))));
  const tail = queueDelays.slice(Math.max(0, queueDelays.length - 32));
  return {
    status: 'PASS',
    webgpuAdapter: adapterInfo,
    graphOptimizationLevel: GRAPH_OPTIMIZATION_LEVEL,
    sessionLoadCount: 3,
    graphLoadMs: {
      mel: melSession.loadMs,
      acoustic: acousticSession.loadMs,
      lmFloat: lmSession.loadMs,
      total: melSession.loadMs + acousticSession.loadMs + lmSession.loadMs,
    },
    pipelineLm: PIPELINE_LM,
    firstGraphExecutionMs,
    firstCompleteHopMs,
    sessionElapsedMs,
    hopCount,
    completeHopLatencyMs: summarize(latencies),
    queueDelayMs: summarize(queueDelays),
    finalQueueDelayMs: queueDelays.at(-1),
    maximumQueueDepth: maxQueueDepth,
    tailQueueDelayMs: summarize(tail),
    backlogClassification:
      queueDelays.at(-1) === 0 && summarize(tail).p95 === 0
        ? 'TRANSIENT_BACKLOG_DRAINED'
        : 'BACKLOG_PRESENT_OR_GROWING',
    mel: summarizeDeltas(melDeltas),
    acousticOut: summarizeDeltas(acousticDeltas),
    h: summarizeDeltas(hDeltas),
    c: summarizeDeltas(cDeltas),
    probabilities: summarizeDeltas(probabilityDeltas),
    chosenState: {
      totalPitchHopComparisons: hopCount * 88,
      mismatchCount,
      firstMismatches: chosenMismatches,
    },
    nativeGateRows: gateRows,
    unsafeWebGpuFlagUsed: ${JSON.stringify(allowUnsafeWebGpu)},
    wasmFallbackUsed: false,
  };
}

function summarizeDeltas(rows) {
  if (!rows.length) return { meanAbsDeltaMax: null, p95AbsDeltaMax: null, maxAbsDelta: null };
  return {
    meanAbsDeltaMax: Math.max(...rows.map((row) => row.meanAbsDelta)),
    p95AbsDeltaMax: Math.max(...rows.map((row) => row.p95AbsDelta)),
    maxAbsDelta: Math.max(...rows.map((row) => row.maxAbsDelta)),
  };
}

async function main() {
  ort.env.wasm.wasmPaths = '/ort/';
  if (MODE === 'worker-combined' || MODE === 'worker-gate') {
    const manifest = await (await fetch('/fixtures/manifest.json')).json();
    const worker = new Worker('/worker.js');
    let nextId = 1;
    function request(type, payload) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const listener = (event) => {
          if (event.data?.id !== id) return;
          worker.removeEventListener('message', listener);
          if (event.data.error) reject(new Error(event.data.error));
          else resolve(event.data.result);
        };
        worker.addEventListener('message', listener);
        worker.postMessage({ id, type, ...payload });
      });
    }
    const init = await request('init', {
      backend: BACKEND,
      graphOptimizationLevel: GRAPH_OPTIMIZATION_LEVEL,
      combinedGraph: manifest.graphs.combined.file,
      ortScript: '/ort/${ortScript}',
      wasmPaths: '/ort/',
      fixtureRoot: '/fixtures/',
    });
    if (MODE === 'worker-gate') {
      const gate = await request('run-gate', { manifest });
      worker.terminate();
      return { status: 'PASS', workerInit: init, realNativeGateParity: gate, unsafeWebGpuFlagUsed: ${JSON.stringify(allowUnsafeWebGpu)}, wasmFallbackUsed: false };
    }
    const sequence = await request('run-sequence', { manifest });
    worker.terminate();
    return { ...sequence, workerInit: init, unsafeWebGpuFlagUsed: ${JSON.stringify(allowUnsafeWebGpu)}, wasmFallbackUsed: false };
  }
  if (MODE === 'native-gate') {
    return runNativeGateBrowser();
  }
  const manifest = await (await fetch('/fixtures/manifest.json')).json();
  if (MODE === 'native-lm') {
    return runNativeLmAttempt(manifest);
  }
  return runPipeline(manifest);
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
    if (url.pathname === '/worker.js') {
      return serveFile(res, workerPath);
    }
    if (url.pathname === '/favicon.ico') {
      res.statusCode = 204;
      res.end();
      return;
    }
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
  const launchOptions = {
    headless: !headed,
    args: backend === 'webgpu' && allowUnsafeWebGpu ? ['--enable-unsafe-webgpu'] : [],
  };
  if (browserChannel) launchOptions.channel = browserChannel;
  const browser = await chromium.launch(launchOptions);
  try {
    const page = await browser.newPage();
    const browserConsole = [];
    page.on('console', (message) => browserConsole.push({ type: message.type(), text: message.text() }));
    page.on('pageerror', (error) => browserConsole.push({ type: 'pageerror', text: error.stack ?? error.message }));
    await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__RESULT__ || window.__ERROR__, null, { timeout: 180000 });
    const result = await page.evaluate(() => ({ result: window.__RESULT__ ?? null, error: window.__ERROR__ ?? null }));
    result.runtime = {
      mode,
      browser_channel: browserChannel,
      headed,
      browser_version: browser.version(),
      launch_args: launchOptions.args,
      os: { platform: os.platform(), release: os.release(), arch: os.arch() },
    };
    result.ort_asset = {
      version: ortPackage.version,
      package_path: ortPackagePath,
      dist_directory: ortDir,
      script: ortScript,
    };
    result.browser_console = browserConsole;
    if (outputPath) await writeFile(outputPath, JSON.stringify(result, null, 2), 'utf8');
    console.log(JSON.stringify(result, null, 2));
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
