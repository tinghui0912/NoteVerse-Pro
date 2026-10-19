// backend/research/robust_geometry_v23/capture-worker.mjs
import * as ort from "/ort/ort.webgpu.min.mjs";

// backend/research/robust_geometry_v23/wire.mjs
var INPUT_SAMPLES = 29120;
var VALUES = 183 * 88;
var TENSOR_BYTES = VALUES * 4;
var PAIR_BYTES = TENSOR_BYTES * 2;
var CORPUS_BYTES = 228 * 2 * (1 * 183 * 88) * Float32Array.BYTES_PER_ELEMENT;
function encodeLE(values) {
  if (!(values instanceof Float32Array) || values.some((v) => !Number.isFinite(v))) throw Error("FINITE_FLOAT32_REQUIRED");
  const out = new Uint8Array(values.length * 4), view = new DataView(out.buffer);
  for (let i = 0; i < values.length; i++) view.setFloat32(i * 4, values[i], true);
  return out;
}
function decodeLE(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length % 4) throw Error("FLOAT32_BYTE_LENGTH");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), out = new Float32Array(bytes.length / 4);
  for (let i = 0; i < out.length; i++) out[i] = view.getFloat32(i * 4, true);
  if (out.some((v) => !Number.isFinite(v))) throw Error("NONFINITE_FLOAT32");
  return out;
}
function tensor(t) {
  if (t?.type !== "float32" || JSON.stringify(t.dims) !== "[1,183,88]" || !(t.data instanceof Float32Array) || t.data.length !== VALUES) throw Error("RAW_OUTPUT_DESCRIPTOR_MISMATCH");
  return encodeLE(t.data);
}
function pair(onset, frame) {
  const a = tensor(onset), b = tensor(frame), out = new Uint8Array(PAIR_BYTES);
  out.set(a);
  out.set(b, TENSOR_BYTES);
  return out;
}
async function sha(bytes) {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", copy))].map((x) => x.toString(16).padStart(2, "0")).join("");
}

// backend/research/robust_geometry_v23/capture-worker.mjs
var session = null;
var loads = 0;
var runs = 0;
var attempted = 0;
var successfulSessionRuns = 0;
var failedSessionRuns = 0;
var loadAttempts = 0;
var failed = false;
var busy = false;
var counts = () => ({ loads, loadAttempts, runs, attempted, successfulSessionRuns, failedSessionRuns });
self.onmessage = async (e) => {
  const { id, type, payload } = e.data;
  if (busy || failed) {
    self.postMessage({ id, error: "CAPTURE_WORKER_CLOSED_OR_BUSY", ...counts() });
    return;
  }
  busy = true;
  try {
    if (type === "LOAD") {
      if (session || loads || ort.env.versions.web !== "1.20.1" || !navigator.gpu) throw Error("PINNED_SINGLE_SESSION_WEBGPU_REQUIRED");
      const data = new Uint8Array(await (await fetch("/model.onnx")).arrayBuffer());
      if (data.length !== 98689283 || await sha(data) !== "4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3") throw Error("MODEL_IDENTITY");
      loadAttempts++;
      session = await ort.InferenceSession.create(data, { executionProviders: ["webgpu"], graphOptimizationLevel: "disabled" });
      loads++;
      if (JSON.stringify(session.inputNames) !== '["audio"]' || JSON.stringify([...session.outputNames].sort()) !== '["frame_output","reg_onset_output"]') throw Error("MODEL_NAMES");
      self.postMessage({ id, ...counts(), provider: "webgpu", ORT: ort.env.versions.web, automaticFallback: false, graphOptimizationLevel: "disabled" });
    } else if (type === "RUN") {
      if (!session || loads !== 1 || payload.runOrdinal !== runs || attempted !== runs || runs >= 228) throw Error("RUN_SEQUENCE");
      const pcm = decodeLE(new Uint8Array(payload.input));
      if (pcm.length !== INPUT_SAMPLES || await sha(encodeLE(pcm)) !== payload.inputSha256) throw Error("MODEL_INPUT_SHA");
      const audio = new ort.Tensor("float32", pcm, [1, INPUT_SAMPLES]);
      let outputs;
      try {
        attempted++;
        self.postMessage({ type: "RUN_STARTED", runOrdinal: payload.runOrdinal, ...counts() });
        const began = performance.now();
        try {
          outputs = await session.run({ audio }, ["reg_onset_output", "frame_output"]);
          successfulSessionRuns++;
        } catch (error) {
          failedSessionRuns++;
          throw error;
        }
        const elapsedMs = performance.now() - began;
        if (JSON.stringify(Object.keys(outputs).sort()) !== '["frame_output","reg_onset_output"]') throw Error("OUTPUT_NAMES");
        const raw = pair(outputs.reg_onset_output, outputs.frame_output);
        runs++;
        self.postMessage({ id, ...counts(), elapsedMs, raw: raw.buffer }, [raw.buffer]);
      } finally {
        audio.dispose();
        for (const t of Object.values(outputs ?? {})) t.dispose();
      }
    } else if (type === "DISPOSE") {
      if (!session || runs !== 228 || attempted !== runs) throw Error("INCOMPLETE_SESSION");
      await session.release();
      session = null;
      self.postMessage({ id, ...counts(), disposed: true });
    } else throw Error("CAPTURE_COMMAND_NOT_ALLOWED");
  } catch (error) {
    failed = true;
    self.postMessage({ id, error: String(error.stack ?? error), ...counts() });
  } finally {
    busy = false;
  }
};
