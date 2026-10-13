// Research-only DR3R Online-AMT grouped browser Worker.
// Owns recurrent state, ONNX Runtime sessions, and serializes all jobs through
// an explicit queue.

/* global self, performance, setTimeout, importScripts, ort */

let chain = Promise.resolve();
let outstanding = 0;
let artificialDelayMs = 0;
let manifest = null;
let sessions = new Map();
let k1Session = null;
let state = null;
let fixtureRoot = '/fixtures/';
let ortReady = false;

function nowAbs() {
  return performance.timeOrigin + performance.now();
}

async function delay(ms) {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function processGroup(message) {
  const workerReceiveTimestamp = message.workerReceiveTimestamp ?? nowAbs();
  const queueEnterTimestamp = message.workerQueueEnterTimestamp ?? workerReceiveTimestamp;
  const k = Number(message.k);
  const groupIndex = Number(message.groupIndex);
  const startHopIndex = Number(message.startHopIndex ?? groupIndex * k);
  const hopCountInMessage = Number(message.hopCountInMessage ?? k);
  const processingStartTimestamp = nowAbs();
  const groupPcm = message.pcm ? new Float32Array(message.pcm) : new Float32Array(hopCountInMessage * 512);
  const ortInferenceStartTimestamp = nowAbs();
  let probabilities = [];
  let chosenStates = [];
  let usedSyntheticDelay = false;
  if (artificialDelayMs > 0) {
    usedSyntheticDelay = true;
    await delay(artificialDelayMs);
  } else if (ortReady && sessions.has(k)) {
    const result = await runModelGroup(k, hopCountInMessage, groupPcm);
    probabilities = result.probabilities;
    chosenStates = result.chosenStates;
  } else if (ortReady) {
    throw new Error(`No grouped ORT session for K=${k}`);
  }
  const ortInferenceFinishTimestamp = nowAbs();
  const publicationFinishTimestamp = nowAbs();
  const hopRows = [];
  for (let offset = 0; offset < hopCountInMessage; offset += 1) {
    const hopIndex = startHopIndex + offset;
    const hopAudioReadyTimestamp = Number(message.feedStartTimestamp) + (hopIndex + 1) * 32;
    hopRows.push({
      hopIndex,
      hopAudioReadyTimestamp,
      groupPublicationTimestamp: publicationFinishTimestamp,
      captureToPublicationAgeMs: publicationFinishTimestamp - hopAudioReadyTimestamp,
    });
  }
  return {
    type: 'group-result',
    groupIndex,
    k,
    startHopIndex,
    hopCountInMessage,
    scheduledGroupReadyTimestamp: message.scheduledGroupReadyTimestamp,
    pagePostTimestamp: message.pagePostTimestamp,
    workerReceiveTimestamp,
    workerQueueEnterTimestamp: queueEnterTimestamp,
    workerProcessingStartTimestamp: processingStartTimestamp,
    ortInferenceStartTimestamp,
    ortInferenceFinishTimestamp,
    publicationFinishTimestamp,
    outstandingPostedNotCompletedDepth: outstanding,
    groupedProcessingDurationMs: publicationFinishTimestamp - processingStartTimestamp,
    queueDelayMs: processingStartTimestamp - workerReceiveTimestamp,
    receiveToStartQueueDelayMs: processingStartTimestamp - workerReceiveTimestamp,
    enqueueToStartQueueDelayMs: processingStartTimestamp - queueEnterTimestamp,
    evidenceClass: usedSyntheticDelay ? 'SYNTHETIC_QUEUE_INSTRUMENTATION_PROOF_ONLY' : 'REAL_GROUPED_MODEL_RUNTIME',
    probabilities,
    chosenStates,
    internalHops: hopRows,
  };
}

async function runModelGroup(k, hopCountInMessage, groupPcm) {
  const probe = cloneState(state);
  const windows = [];
  let active = hopCountInMessage === k;
  for (let offset = 0; offset < hopCountInMessage; offset += 1) {
    const hop = groupPcm.subarray(offset * 512, (offset + 1) * 512);
    updateAudioBuffer(probe.audio, hop);
    if (pseudoIntensity(probe.audio) < 0.05) probe.numUnderThr += 1;
    else probe.numUnderThr = 0;
    windows.push(probe.audio.slice(probe.audio.length - 2048));
    if (probe.numUnderThr > 100) active = false;
  }
  if (!active) return runSequentialFallback(hopCountInMessage, groupPcm);
  const session = sessions.get(k);
  const output = await session.run({
    audio_last_2048_sequence: new ort.Tensor('float32', concatFloat(windows), [k, 1, 2048]),
    mel_buffer_in: new ort.Tensor('float32', state.mel, [1, 229, 7]),
    cache0_in: new ort.Tensor('float32', state.cache0, [1, 64, 5, 229]),
    cache1_in: new ort.Tensor('float32', state.cache1, [1, 64, 3, 114]),
    h_in: new ort.Tensor('float32', state.h, [2, 1, 512]),
    c_in: new ort.Tensor('float32', state.c, [2, 1, 512]),
    prev_output_in: new ort.Tensor('int64', toBigInt64(state.prev), [1, 1, 88]),
  });
  state.audio = probe.audio;
  state.numUnderThr = probe.numUnderThr;
  state.mel = new Float32Array(output.mel_buffer_out.data);
  state.cache0 = new Float32Array(output.cache0_out.data);
  state.cache1 = new Float32Array(output.cache1_out.data);
  state.h = new Float32Array(output.h_out.data);
  state.c = new Float32Array(output.c_out.data);
  const probabilities = Array.from(output.probabilities_sequence.data);
  const chosen = Array.from(output.chosen_state_sequence.data, Number);
  state.prev = Int32Array.from(chosen.slice((k - 1) * 88, k * 88));
  return { probabilities, chosenStates: chosen };
}

async function runSequentialFallback(hopCountInMessage, groupPcm) {
  const probabilities = [];
  const chosen = [];
  for (let offset = 0; offset < hopCountInMessage; offset += 1) {
    const hop = groupPcm.subarray(offset * 512, (offset + 1) * 512);
    updateAudioBuffer(state.audio, hop);
    if (pseudoIntensity(state.audio) < 0.05) state.numUnderThr += 1;
    else state.numUnderThr = 0;
    if (state.numUnderThr > 100) {
      for (let pitch = 0; pitch < 88; pitch += 1) {
        probabilities.push(1, 0, 0, 0, 0);
        chosen.push(0);
      }
      continue;
    }
    const output = await k1Session.run({
      audio_last_2048_sequence: new ort.Tensor('float32', state.audio.slice(state.audio.length - 2048), [1, 1, 2048]),
      mel_buffer_in: new ort.Tensor('float32', state.mel, [1, 229, 7]),
      cache0_in: new ort.Tensor('float32', state.cache0, [1, 64, 5, 229]),
      cache1_in: new ort.Tensor('float32', state.cache1, [1, 64, 3, 114]),
      h_in: new ort.Tensor('float32', state.h, [2, 1, 512]),
      c_in: new ort.Tensor('float32', state.c, [2, 1, 512]),
      prev_output_in: new ort.Tensor('int64', toBigInt64(state.prev), [1, 1, 88]),
    });
    state.mel = new Float32Array(output.mel_buffer_out.data);
    state.cache0 = new Float32Array(output.cache0_out.data);
    state.cache1 = new Float32Array(output.cache1_out.data);
    state.h = new Float32Array(output.h_out.data);
    state.c = new Float32Array(output.c_out.data);
    const probs = Array.from(output.probabilities_sequence.data);
    const states = Array.from(output.chosen_state_sequence.data, Number);
    probabilities.push(...probs);
    chosen.push(...states);
    state.prev = Int32Array.from(states);
  }
  return { probabilities, chosenStates: chosen };
}

async function initRuntime(message) {
  fixtureRoot = message.fixtureRoot || '/fixtures/';
  importScripts(message.ortScript || '/ort/ort.webgpu.min.js');
  ort.env.wasm.wasmPaths = message.wasmPaths || '/ort/';
  if (!self.navigator?.gpu) throw new Error('CONTAINER_BROWSER_WEBGPU_UNAVAILABLE:navigator.gpu missing');
  const adapter = await self.navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('CONTAINER_BROWSER_WEBGPU_UNAVAILABLE:adapter unavailable');
  manifest = await fetchJson(message.manifestFile || 'grouped_manifest_dr3r.json');
  const targetK = Number(message.targetK ?? 1);
  const initial = await loadInitial(manifest.fixtures.initialState);
  state = {
    audio: initial.audio,
    mel: initial.mel,
    cache0: initial.cache0,
    cache1: initial.cache1,
    h: initial.h,
    c: initial.c,
    prev: initial.prev,
    numUnderThr: 0,
  };
  const requiredKeys = targetK === 1 ? ['1'] : ['1', String(targetK)];
  for (const key of requiredKeys) {
    const graph = manifest.graphs.grouped[key];
    if (!graph) throw new Error(`DR3R manifest missing graph K=${key}`);
    const session = await ort.InferenceSession.create(fixtureRoot + graph.file, {
      executionProviders: ['webgpu'],
      graphOptimizationLevel: 'disabled',
    });
    sessions.set(Number(key), session);
  }
  k1Session = sessions.get(1);
  ortReady = true;
  return { status: 'PASS', sessionCount: sessions.size, adapterInfoAvailable: Boolean(adapter.info), graphKeys: [...sessions.keys()] };
}

self.onmessage = (event) => {
  const receivedAt = nowAbs();
  const queueEnterTimestamp = receivedAt;
  const message = event.data;
  if (message.type === 'init') {
    artificialDelayMs = Number(message.artificialDelayMs ?? 0);
    const init = artificialDelayMs > 0 ? Promise.resolve({ status: 'PASS', explicitQueue: true, artificialDelayMs }) : initRuntime(message);
    init.then((result) => self.postMessage({ id: message.id, result })).catch((error) => {
      self.postMessage({ id: message.id, error: String(error && error.stack ? error.stack : error) });
    });
    return;
  }
  if (message.type !== 'group') {
    self.postMessage({ id: message.id, error: `unknown DR3 worker message: ${message.type}` });
    return;
  }
  outstanding += 1;
  chain = chain
    .then(() => processGroup({ ...message, workerReceiveTimestamp: receivedAt, workerQueueEnterTimestamp: queueEnterTimestamp }))
    .then((result) => {
      outstanding -= 1;
      self.postMessage({ id: message.id, result });
    })
    .catch((error) => {
      outstanding -= 1;
      self.postMessage({ id: message.id, error: String(error && error.stack ? error.stack : error) });
    });
};

async function fetchJson(name) {
  const response = await fetch(fixtureRoot + name);
  if (!response.ok) throw new Error(`fetch failed: ${name}`);
  return response.json();
}

async function fetchNpy(name) {
  const response = await fetch(fixtureRoot + name);
  if (!response.ok) throw new Error(`fetch failed: ${name}`);
  return parseNpy(await response.arrayBuffer());
}

async function loadInitial(paths) {
  return {
    audio: (await fetchNpy(paths.audioBuffer)).data,
    mel: (await fetchNpy(paths.melBuffer)).data,
    cache0: (await fetchNpy(paths.cache0)).data,
    cache1: (await fetchNpy(paths.cache1)).data,
    h: (await fetchNpy(paths.h)).data,
    c: (await fetchNpy(paths.c)).data,
    prev: Int32Array.from(Array.from((await fetchNpy(paths.prevOutput)).data, Number)),
  };
}

function parseNpy(buffer) {
  const bytes = new Uint8Array(buffer);
  const magic = String.fromCharCode(...bytes.slice(0, 6));
  if (magic !== '\x93NUMPY') throw new Error('not an npy file');
  const major = bytes[6];
  const headerLen = major === 1 ? bytes[8] | (bytes[9] << 8) : bytes[8] | (bytes[9] << 8) | (bytes[10] << 16) | (bytes[11] << 24);
  const offset = major === 1 ? 10 : 12;
  const header = new TextDecoder('latin1').decode(bytes.slice(offset, offset + headerLen));
  const shapeMatch = header.match(/'shape': \(([^)]*)\)/);
  const shape = shapeMatch ? shapeMatch[1].split(',').map((part) => part.trim()).filter(Boolean).map(Number) : [];
  const dataOffset = offset + headerLen;
  if (header.includes("'descr': '<f4'")) return { dtype: 'float32', shape, data: new Float32Array(buffer, dataOffset) };
  if (header.includes("'descr': '<i8'")) return { dtype: 'int64', shape, data: new BigInt64Array(buffer, dataOffset) };
  throw new Error(`unsupported npy dtype: ${header}`);
}

function updateAudioBuffer(audio, hop) {
  audio.copyWithin(0, 512);
  audio.set(hop, audio.length - 512);
}

function pseudoIntensity(audio) {
  let min = Infinity;
  let max = -Infinity;
  for (const value of audio) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return max - min;
}

function cloneState(input) {
  return {
    audio: new Float32Array(input.audio),
    mel: new Float32Array(input.mel),
    cache0: new Float32Array(input.cache0),
    cache1: new Float32Array(input.cache1),
    h: new Float32Array(input.h),
    c: new Float32Array(input.c),
    prev: new Int32Array(input.prev),
    numUnderThr: input.numUnderThr,
  };
}

function concatFloat(rows) {
  const total = rows.reduce((sum, row) => sum + row.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const row of rows) {
    out.set(row, offset);
    offset += row.length;
  }
  return out;
}

function toBigInt64(values) {
  const out = new BigInt64Array(values.length);
  for (let index = 0; index < values.length; index += 1) out[index] = BigInt(values[index]);
  return out;
}
