// Research-only Online-AMT browser worker for Phase 9G-D.2R.1.
//
// The worker owns all recurrent model state. The page sends fixture metadata and
// 512-sample hops; the worker returns parity/runtime summaries and a real
// OnlineAmtPythonHopArtifact-compatible hop artifact. This is not production
// Practice code.

/* global importScripts, ort, self, performance */

const HOP_SAMPLES = 512;
const SAMPLE_RATE = 16000;
const PSEUDO_THRESHOLD = 0.05;
const PATIENCE = 100;
const MIDI_OFFSET = 21;

let backend = 'webgpu';
let graphOptimizationLevel = 'disabled';
let combinedSession = null;
let combinedLoadMs = null;
let combinedFirstExecutionMs = null;
let fixtureRoot = '/fixtures/';
let ortReady = false;

function parseNpy(buffer) {
  const bytes = new Uint8Array(buffer);
  const magic = String.fromCharCode(...bytes.slice(0, 6));
  if (magic !== '\x93NUMPY') throw new Error('not an npy file');
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
  const shapeMatch = header.match(/'shape': \(([^)]*)\)/) || header.match(/"shape": \[([^\]]*)\]/);
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
  const response = await fetch(fixtureRoot + name);
  if (!response.ok) throw new Error('fetch failed: ' + name);
  return parseNpy(await response.arrayBuffer());
}

function tensor(type, data, dims) {
  return new ort.Tensor(type, data, dims);
}

function cloneFloat(values) {
  return new Float32Array(values);
}

function cloneInt(values) {
  return Int32Array.from(Array.from(values, (value) => Number(value)));
}

function updateAudioBuffer(audioBuffer, hop) {
  audioBuffer.copyWithin(0, HOP_SAMPLES);
  audioBuffer.set(hop, audioBuffer.length - HOP_SAMPLES);
}

function maxAbs(values) {
  let max = 0;
  for (const value of values) max = Math.max(max, Math.abs(value));
  return max;
}

function pseudoIntensity(audio) {
  let min = Infinity;
  let max = -Infinity;
  for (const value of audio) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (!Number.isFinite(min) || maxAbs(audio) === 0) return 0;
  return max - min;
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

function compareFloat(actual, expected) {
  if (actual.length !== expected.length) throw new Error(`float length mismatch ${actual.length} != ${expected.length}`);
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
    p95AbsDelta: percentile(sorted, 0.95),
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
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const index = (sorted.length - 1) * p;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  if (low === high) return sorted[low];
  return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
}

function summarizeDeltas(rows) {
  if (!rows.length) return { meanAbsDeltaMax: null, p95AbsDeltaMax: null, maxAbsDelta: null };
  return {
    meanAbsDeltaMax: Math.max(...rows.map((row) => row.meanAbsDelta)),
    p95AbsDeltaMax: Math.max(...rows.map((row) => row.p95AbsDelta)),
    maxAbsDelta: Math.max(...rows.map((row) => row.maxAbsDelta)),
  };
}

function createSilentProbabilities() {
  const probabilities = new Float32Array(88 * 5);
  for (let pitch = 0; pitch < 88; pitch += 1) probabilities[pitch * 5] = 1;
  return probabilities;
}

function createState(initial) {
  return {
    audio: cloneFloat(initial.audio.data),
    mel: cloneFloat(initial.mel.data),
    cache0: cloneFloat(initial.cache0.data),
    cache1: cloneFloat(initial.cache1.data),
    h: cloneFloat(initial.h.data),
    c: cloneFloat(initial.c.data),
    prev: cloneInt(initial.prev.data),
    numUnderThr: 0,
  };
}

function snapshotHashes(state) {
  // Cheap deterministic FNV-1a-like summaries. Full cryptographic identities are
  // produced by the Node/Python orchestrator; these are for browser state-freeze
  // comparisons inside the worker report.
  return {
    audio: rollingHash(state.audio),
    mel: rollingHash(state.mel),
    cache0: rollingHash(state.cache0),
    cache1: rollingHash(state.cache1),
    h: rollingHash(state.h),
    c: rollingHash(state.c),
    prev: rollingHash(state.prev),
    numUnderThr: state.numUnderThr,
  };
}

function rollingHash(values) {
  let hash = 2166136261;
  for (let index = 0; index < values.length; index += Math.max(1, Math.floor(values.length / 1024))) {
    const value = Number(values[index]);
    hash ^= Math.round(value * 1e6) | 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

async function loadInitial(manifest) {
  return {
    audio: await fetchNpy(manifest.initialState.audioBuffer),
    mel: await fetchNpy(manifest.initialState.melBuffer),
    cache0: await fetchNpy(manifest.initialState.cache0),
    cache1: await fetchNpy(manifest.initialState.cache1),
    h: await fetchNpy(manifest.initialState.h),
    c: await fetchNpy(manifest.initialState.c),
    prev: await fetchNpy(manifest.initialState.prevOutput),
  };
}

async function init(message) {
  fixtureRoot = message.fixtureRoot || '/fixtures/';
  backend = message.backend || 'webgpu';
  graphOptimizationLevel = message.graphOptimizationLevel || 'disabled';
  importScripts(message.ortScript || '/ort/ort.webgpu.min.js');
  ort.env.wasm.wasmPaths = message.wasmPaths || '/ort/';
  ortReady = true;
  if (backend === 'webgpu') {
    if (!self.navigator?.gpu) throw new Error('WebGPU unavailable in worker');
    const adapter = await self.navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('WebGPU adapter unavailable in worker');
  }
  const started = performance.now();
  combinedSession = await ort.InferenceSession.create(fixtureRoot + message.combinedGraph, {
    executionProviders: [backend],
    graphOptimizationLevel,
  });
  combinedLoadMs = performance.now() - started;
  return { status: 'PASS', combinedLoadMs, ortReady };
}

async function runActiveStep(state, hop) {
  updateAudioBuffer(state.audio, hop);
  const intensity = pseudoIntensity(state.audio);
  if (intensity < PSEUDO_THRESHOLD) state.numUnderThr += 1;
  else state.numUnderThr = 0;
  if (state.numUnderThr > PATIENCE) {
    return {
      shortCircuit: true,
      probabilities: createSilentProbabilities(),
      runMs: 0,
      sessionRunMs: 0,
      stateUpdateMs: 0,
      argmaxMs: 0,
    };
  }

  const prevBigInt = new BigInt64Array(88);
  for (let pitch = 0; pitch < 88; pitch += 1) prevBigInt[pitch] = BigInt(state.prev[pitch]);
  const last2048 = state.audio.subarray(state.audio.length - 2048);
  const beforeRun = performance.now();
  const output = await combinedSession.run({
    audio_last_2048: tensor('float32', last2048, [1, 2048]),
    mel_buffer_in: tensor('float32', state.mel, [1, 229, 7]),
    cache0_in: tensor('float32', state.cache0, [1, 64, 5, 229]),
    cache1_in: tensor('float32', state.cache1, [1, 64, 3, 114]),
    h_in: tensor('float32', state.h, [2, 1, 512]),
    c_in: tensor('float32', state.c, [2, 1, 512]),
    prev_output_in: tensor('int64', prevBigInt, [1, 1, 88]),
  });
  const afterRun = performance.now();
  if (combinedFirstExecutionMs === null) combinedFirstExecutionMs = afterRun - beforeRun;
  const beforeUpdate = performance.now();
  state.mel = cloneFloat(output.mel_buffer_out.data);
  state.cache0 = cloneFloat(output.cache0_out.data);
  state.cache1 = cloneFloat(output.cache1_out.data);
  state.h = cloneFloat(output.h_out.data);
  state.c = cloneFloat(output.c_out.data);
  const probabilities = cloneFloat(output.probabilities.data);
  const beforeArgmax = performance.now();
  for (let pitch = 0; pitch < 88; pitch += 1) {
    state.prev[pitch] = argmax5(probabilities, pitch);
  }
  const afterArgmax = performance.now();
  return {
    shortCircuit: false,
    probabilities,
    runMs: afterArgmax - beforeRun,
    sessionRunMs: afterRun - beforeRun,
    stateUpdateMs: beforeArgmax - beforeUpdate,
    argmaxMs: afterArgmax - beforeArgmax,
  };
}

function pitchStatesFromProbabilities(probabilities) {
  const states = [];
  for (let pitch = 0; pitch < 88; pitch += 1) {
    const values = Array.from(probabilities.subarray(pitch * 5, pitch * 5 + 5));
    states.push({ pitch: pitchName(pitch), probabilities: values, chosenState: argmax5(probabilities, pitch) });
  }
  return states;
}

async function runSequence(message) {
  if (!combinedSession || !ortReady) throw new Error('worker not initialized');
  const manifest = message.manifest;
  const initial = await loadInitial(manifest);
  const state = createState(initial);
  const hops = await fetchNpy(manifest.fixtures.hops);
  const referenceProb = await fetchNpy(manifest.fixtures.referenceProbabilities);
  const referenceChosen = await fetchNpy(manifest.fixtures.referenceChosenStates);
  const referenceH = await fetchNpy(manifest.fixtures.referenceH);
  const referenceC = await fetchNpy(manifest.fixtures.referenceC);
  const referenceMel = await fetchNpy(manifest.fixtures.referenceMelBuffer);
  const referenceCache0 = await fetchNpy(manifest.fixtures.referenceCache0);
  const referenceCache1 = await fetchNpy(manifest.fixtures.referenceCache1);

  const hopCount = manifest.hopCount;
  const latencies = [];
  const sessionRunLatencies = [];
  const jsLatencies = [];
  const queueRows = [];
  const feederRows = [];
  const probabilityDeltas = [];
  const hDeltas = [];
  const cDeltas = [];
  const melDeltas = [];
  const cache0Deltas = [];
  const cache1Deltas = [];
  const mismatches = [];
  const artifactHops = [];
  let mismatchCount = 0;
  let previousFinish = 0;
  let simulatedNow = 0;
  const feedStart = performance.now();

  for (let hopIndex = 0; hopIndex < hopCount; hopIndex += 1) {
    const scheduledAt = feedStart + hopIndex * 32;
    const postedAt = performance.now();
    const readyAt = hopIndex * 32;
    const processingStart = Math.max(readyAt, previousFinish);
    const hop = hops.data.subarray(hopIndex * HOP_SAMPLES, (hopIndex + 1) * HOP_SAMPLES);
    const before = performance.now();
    const step = await runActiveStep(state, hop);
    const finishedAt = performance.now();
    const latency = finishedAt - before;
    latencies.push(latency);
    sessionRunLatencies.push(step.sessionRunMs);
    jsLatencies.push(Math.max(0, latency - step.sessionRunMs));
    const finish = processingStart + latency;
    previousFinish = finish;
    queueRows.push({
      hopIndex,
      inputReadyAtMs: readyAt,
      processingStartAtMs: processingStart,
      completeHopLatencyMs: latency,
      processingFinishAtMs: finish,
      queueDelayMs: processingStart - readyAt,
      publicationDelayMs: finish - readyAt,
    });
    feederRows.push({
      hopIndex,
      scheduledAtMs: scheduledAt - feedStart,
      postedAtMs: postedAt - feedStart,
      workerStartedAtMs: simulatedNow,
      workerFinishedAtMs: simulatedNow + latency,
      feederTimerJitterMs: (postedAt - scheduledAt),
    });
    simulatedNow += latency;

    const expectedProb = referenceProb.data.subarray(hopIndex * 88 * 5, (hopIndex + 1) * 88 * 5);
    probabilityDeltas.push(compareFloat(step.probabilities, expectedProb));
    const refH = referenceH.data.subarray(hopIndex * state.h.length, (hopIndex + 1) * state.h.length);
    const refC = referenceC.data.subarray(hopIndex * state.c.length, (hopIndex + 1) * state.c.length);
    const refMel = referenceMel.data.subarray(hopIndex * state.mel.length, (hopIndex + 1) * state.mel.length);
    const refCache0 = referenceCache0.data.subarray(hopIndex * state.cache0.length, (hopIndex + 1) * state.cache0.length);
    const refCache1 = referenceCache1.data.subarray(hopIndex * state.cache1.length, (hopIndex + 1) * state.cache1.length);
    hDeltas.push(compareFloat(state.h, refH));
    cDeltas.push(compareFloat(state.c, refC));
    melDeltas.push(compareFloat(state.mel, refMel));
    cache0Deltas.push(compareFloat(state.cache0, refCache0));
    cache1Deltas.push(compareFloat(state.cache1, refCache1));

    for (let pitch = 0; pitch < 88; pitch += 1) {
      const chosen = argmax5(step.probabilities, pitch);
      const expected = Number(referenceChosen.data[hopIndex * 88 + pitch]);
      if (chosen !== expected) {
        mismatchCount += 1;
        if (mismatches.length < 10) {
          mismatches.push({
            hopIndex,
            pitchIndex: pitch,
            pitch: pitchName(pitch),
            pythonChosenState: expected,
            browserChosenState: chosen,
            pythonProbabilities: Array.from(expectedProb.subarray(pitch * 5, pitch * 5 + 5)),
            browserProbabilities: Array.from(step.probabilities.subarray(pitch * 5, pitch * 5 + 5)),
          });
        }
      }
    }
    artifactHops.push({
      hopIndex,
      localDecisionSample: (hopIndex + 1) * HOP_SAMPLES,
      processingLatencyMs: latency,
      pitchStates: pitchStatesFromProbabilities(step.probabilities),
    });
  }
  const queueDelays = queueRows.map((row) => row.queueDelayMs);
  const maxQueueDepth = Math.max(...queueRows.map((row) => Math.max(1, Math.ceil(row.publicationDelayMs / 32))));
  const tail = queueDelays.slice(Math.max(0, queueDelays.length - 64));
  return {
    status: 'PASS',
    combinedLoadMs,
    firstCombinedExecutionMs: combinedFirstExecutionMs,
    hopCount,
    sessionLoadCount: 1,
    completeHopLatencyMs: summarize(latencies),
    combinedSessionRunMs: summarize(sessionRunLatencies),
    nonOrtJsMs: summarize(jsLatencies),
    queueDelayMs: summarize(queueDelays),
    finalQueueDelayMs: queueDelays.at(-1),
    maximumQueueDepth: maxQueueDepth,
    tail64QueueDelayMs: summarize(tail),
    backlogClassification:
      queueDelays.at(-1) === 0 && summarize(tail).p95 === 0
        ? 'TRANSIENT_BACKLOG_DRAINED'
        : 'BACKLOG_PRESENT_OR_GROWING',
    probability: summarizeDeltas(probabilityDeltas),
    h: summarizeDeltas(hDeltas),
    c: summarizeDeltas(cDeltas),
    melBuffer: summarizeDeltas(melDeltas),
    cache0: summarizeDeltas(cache0Deltas),
    cache1: summarizeDeltas(cache1Deltas),
    chosenState: {
      totalPitchHopComparisons: hopCount * 88,
      mismatchCount,
      firstMismatches: mismatches,
    },
    queueRowsSample: queueRows.slice(0, 6).concat(queueRows.slice(-3)),
    feederRowsSample: feederRows.slice(0, 6).concat(feederRows.slice(-3)),
    artifact: {
      schemaVersion: 1,
      artifact: 'online_amt_real_hop_output',
      segments: [{
        segmentId: 'phase9gd2r1-p07-segment',
        performanceStartMs: 0,
        performanceOwnedSamples: manifest.performanceOwnedSamples,
        contextTailSamples: manifest.contextTailSamples,
        hops: artifactHops,
      }],
    },
  };
}

async function runGate(message) {
  const manifest = message.manifest;
  const initial = await loadInitial(manifest);
  const active = await fetchNpy(manifest.fixtures.hops);
  const state = createState(initial);
  // Prime with a few real p07 hops so prev_output is an actual model state.
  for (let index = 0; index < 8; index += 1) {
    await runActiveStep(state, active.data.subarray(index * HOP_SAMPLES, (index + 1) * HOP_SAMPLES));
  }
  // The fixture starts the boundary count from a real primed recurrent state.
  // Only the NATIVE silence counter is reset so that 99/100/101/102 exercise
  // the exact `num_under_thr > patience` boundary.
  state.numUnderThr = 0;
  const beforeSilence = snapshotHashes(state);
  const rows = [];
  for (let index = 1; index <= 102; index += 1) {
    const silent = new Float32Array(HOP_SAMPLES);
    silent[index % HOP_SAMPLES] = 0.001;
    const before = snapshotHashes(state);
    const result = await runActiveStep(state, silent);
    const after = snapshotHashes(state);
    if ([99, 100, 101, 102].includes(index)) {
      rows.push({
        silentHopCount: index,
        shortCircuit: result.shortCircuit,
        before,
        after,
        audioChanged: before.audio !== after.audio,
        melFrozen: before.mel === after.mel,
        cache0Frozen: before.cache0 === after.cache0,
        cache1Frozen: before.cache1 === after.cache1,
        hFrozen: before.h === after.h,
        cFrozen: before.c === after.c,
        prevOutputFrozen: before.prev === after.prev,
        numUnderThr: state.numUnderThr,
      });
    }
  }
  const beforeRecovery = snapshotHashes(state);
  const recoveryHop = new Float32Array(HOP_SAMPLES);
  for (let index = 0; index < HOP_SAMPLES; index += 1) {
    recoveryHop[index] = Math.sin((index / HOP_SAMPLES) * Math.PI * 8) * 0.5;
  }
  const recovery = await runActiveStep(state, recoveryHop);
  const afterRecovery = snapshotHashes(state);
  return {
    status: 'PASS',
    primedState: beforeSilence,
    rows,
    recovery: {
      before: beforeRecovery,
      after: afterRecovery,
      shortCircuit: recovery.shortCircuit,
      numUnderThrAfterRecovery: state.numUnderThr,
      prevOutputBeforeRecovery: beforeRecovery.prev,
      prevOutputAfterRecovery: afterRecovery.prev,
      normalNeuralProgressionResumed: !recovery.shortCircuit && beforeRecovery.h !== afterRecovery.h,
    },
  };
}

self.onmessage = async (event) => {
  try {
    const { id, type, ...message } = event.data;
    let result;
    if (type === 'init') result = await init(message);
    else if (type === 'run-sequence') result = await runSequence(message);
    else if (type === 'run-gate') result = await runGate(message);
    else throw new Error(`unknown worker message: ${type}`);
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id: event.data?.id, error: String(error && error.stack ? error.stack : error) });
  }
};
