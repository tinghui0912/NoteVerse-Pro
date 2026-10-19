// backend/research/robust_geometry_v23/wire.mjs
var INPUT_SAMPLES = 29120;
var VALUES = 183 * 88;
var TENSOR_BYTES = VALUES * 4;
var PAIR_BYTES = TENSOR_BYTES * 2;
var CORPUS_BYTES = 228 * 2 * (1 * 183 * 88) * Float32Array.BYTES_PER_ELEMENT;
function decodeLE(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length % 4) throw Error("FLOAT32_BYTE_LENGTH");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), out = new Float32Array(bytes.length / 4);
  for (let i = 0; i < out.length; i++) out[i] = view.getFloat32(i * 4, true);
  if (out.some((v) => !Number.isFinite(v))) throw Error("NONFINITE_FLOAT32");
  return out;
}
async function sha(bytes) {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", copy))].map((x) => x.toString(16).padStart(2, "0")).join("");
}
function assertInventory(manifest) {
  if (manifest.schema !== "V23_OPAQUE_FROZEN_MODEL_INPUTS_ONLY" || manifest.jobs.length !== 18) throw Error("JOB_INVENTORY");
  const fields = ["jobId", "sourceCaseId", "sourceDomainId", "sourceRateHz", "sourceOriginSample", "inputBlobPath", "inputBlobSha256", "windows"];
  const ids = /* @__PURE__ */ new Set();
  let count = 0;
  for (const j of manifest.jobs) {
    if (JSON.stringify(Object.keys(j).sort()) !== JSON.stringify(fields.sort()) || ids.has(j.jobId) || !/^j-[a-f0-9]{24}$/.test(j.jobId) || ![44100, 48e3].includes(j.sourceRateHz)) throw Error("OPAQUE_JOB_FIELDS");
    ids.add(j.jobId);
    for (const w of j.windows) {
      if (w.runOrdinal !== count++ || w.samples !== INPUT_SAMPLES || w.inputBytes !== INPUT_SAMPLES * 4 || w.runtimeWindow.endSample - w.runtimeWindow.startSample !== INPUT_SAMPLES || !/^[a-f0-9]{64}$/.test(w.inputSha256)) throw Error("INPUT_INVENTORY");
    }
  }
  if (count !== 228 || new Set(manifest.jobs.map((j) => j.sourceCaseId)).size !== 9 || manifest.jobs.filter((j) => j.sourceRateHz === 44100).length !== 9 || manifest.jobs.filter((j) => j.sourceRateHz === 48e3).length !== 9) throw Error("CORPUS_INVENTORY");
}

// backend/research/robust_geometry_v23/capture-entry.mjs
window.captureTrace = {
  phase: "INPUT_VERIFY",
  workerConstructions: 0,
  loads: 0,
  loadAttempts: 0,
  runs: 0,
  attempted: 0,
  successfulSessionRuns: 0,
  failedSessionRuns: 0,
  completedUploads: 0,
  inferenceMs: []
};
window.captureRaw = async (manifest) => {
  assertInventory(manifest);
  const trace = window.captureTrace, prepared = /* @__PURE__ */ new Map();
  for (const j of manifest.jobs) {
    const blob = new Uint8Array(await (await fetch("/input/" + j.jobId)).arrayBuffer());
    if (await sha(blob) !== j.inputBlobSha256) throw Error("INPUT_BLOB_SHA");
    for (const w of j.windows) {
      const b = blob.slice(w.inputByteOffset, w.inputByteOffset + w.inputBytes);
      if (decodeLE(b).length !== INPUT_SAMPLES || await sha(b) !== w.inputSha256) throw Error("INPUT_SHA_BEFORE_LOAD");
      prepared.set(w.runOrdinal, b);
    }
  }
  trace.browserInputsVerified = prepared.size;
  const worker = new Worker("/capture-worker.js", { type: "module" });
  trace.workerConstructions++;
  const pending = /* @__PURE__ */ new Map();
  let next = 0;
  worker.onmessage = (e) => {
    if (e.data.type === "RUN_STARTED") {
      Object.assign(trace, {
        attempted: e.data.attempted,
        successfulSessionRuns: e.data.successfulSessionRuns,
        failedSessionRuns: e.data.failedSessionRuns
      });
      return;
    }
    const p = pending.get(e.data.id);
    if (!p) {
      trace.unknownResponse = e.data;
      return;
    }
    pending.delete(e.data.id);
    Object.assign(trace, {
      loads: e.data.loads,
      loadAttempts: e.data.loadAttempts,
      runs: e.data.runs,
      attempted: e.data.attempted,
      successfulSessionRuns: e.data.successfulSessionRuns,
      failedSessionRuns: e.data.failedSessionRuns
    });
    if (e.data.error) p.reject(Error(e.data.error));
    else p.resolve(e.data);
  };
  worker.onerror = (e) => {
    for (const p of pending.values()) p.reject(Error(e.message));
    pending.clear();
  };
  const call = (type, payload = {}, transfer = []) => new Promise((resolve, reject) => {
    const id = next++;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, type, payload }, transfer);
  });
  try {
    trace.phase = "MODEL_LOAD";
    trace.modelReceipt = await call("LOAD");
    trace.phase = "RAW_CAPTURE";
    for (const j of manifest.jobs) for (const w of j.windows) {
      const input = prepared.get(w.runOrdinal);
      prepared.delete(w.runOrdinal);
      const response = await call("RUN", { runOrdinal: w.runOrdinal, inputSha256: w.inputSha256, input: input.buffer }, [input.buffer]);
      trace.inferenceMs.push(response.elapsedMs);
      if (response.raw.byteLength !== PAIR_BYTES || response.runs !== w.runOrdinal + 1) throw Error("RAW_PAIR_ACCOUNTING");
      const uploaded = await fetch("/raw/" + w.runOrdinal, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: response.raw });
      if (!uploaded.ok) throw Error("RAW_READBACK_FAILED:" + await uploaded.text());
      const receipt = await uploaded.json();
      if (receipt.runOrdinal !== w.runOrdinal || receipt.pairSha256 !== await sha(new Uint8Array(response.raw))) throw Error("RAW_HOST_READBACK_SHA");
      trace.completedUploads++;
      await fetch("/progress", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...trace, lastInferenceMs: response.elapsedMs }) });
    }
    trace.disposal = await call("DISPOSE");
    trace.phase = "COMPLETE";
    trace.unresolvedRequests = pending.size;
    if (trace.loads !== 1 || trace.loadAttempts !== 1 || trace.runs !== 228 || trace.successfulSessionRuns !== 228 || trace.failedSessionRuns !== 0 || trace.completedUploads !== 228 || trace.unknownResponse || pending.size) throw Error("FINAL_CAPTURE_ACCOUNTING");
    return trace;
  } catch (error) {
    trace.failure = String(error.stack ?? error);
    trace.phase = "FAILED";
    trace.unresolvedRequests = pending.size;
    throw error;
  } finally {
    worker.terminate();
  }
};
