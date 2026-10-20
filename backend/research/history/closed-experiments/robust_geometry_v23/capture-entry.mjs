import { assertInventory, sha, decodeLE, INPUT_SAMPLES, PAIR_BYTES } from './wire.mjs';

window.captureTrace = { phase: 'INPUT_VERIFY', workerConstructions: 0, loads: 0, loadAttempts: 0,
  runs: 0, attempted: 0, successfulSessionRuns: 0, failedSessionRuns: 0, completedUploads: 0, inferenceMs: [] };
window.captureRaw = async manifest => {
  assertInventory(manifest); const trace = window.captureTrace, prepared = new Map();
  // All 228 browser inputs are verified before the sole worker/session is constructed.
  for (const j of manifest.jobs) {
    const blob = new Uint8Array(await (await fetch('/input/' + j.jobId)).arrayBuffer());
    if (await sha(blob) !== j.inputBlobSha256) throw Error('INPUT_BLOB_SHA');
    for (const w of j.windows) {
      const b = blob.slice(w.inputByteOffset, w.inputByteOffset + w.inputBytes);
      if (decodeLE(b).length !== INPUT_SAMPLES || await sha(b) !== w.inputSha256) throw Error('INPUT_SHA_BEFORE_LOAD');
      prepared.set(w.runOrdinal, b);
    }
  }
  trace.browserInputsVerified = prepared.size;
  const worker = new Worker('/capture-worker.js', { type: 'module' }); trace.workerConstructions++;
  const pending = new Map(); let next = 0;
  worker.onmessage = e => {
    if (e.data.type === 'RUN_STARTED') { Object.assign(trace, { attempted: e.data.attempted,
      successfulSessionRuns: e.data.successfulSessionRuns, failedSessionRuns: e.data.failedSessionRuns }); return; }
    const p = pending.get(e.data.id); if (!p) { trace.unknownResponse = e.data; return; }
    pending.delete(e.data.id); Object.assign(trace, { loads: e.data.loads, loadAttempts: e.data.loadAttempts,
      runs: e.data.runs, attempted: e.data.attempted, successfulSessionRuns: e.data.successfulSessionRuns,
      failedSessionRuns: e.data.failedSessionRuns });
    if (e.data.error) p.reject(Error(e.data.error)); else p.resolve(e.data);
  };
  worker.onerror = e => { for (const p of pending.values()) p.reject(Error(e.message)); pending.clear(); };
  const call = (type, payload = {}, transfer = []) => new Promise((resolve, reject) => {
    const id = next++; pending.set(id, { resolve, reject }); worker.postMessage({ id, type, payload }, transfer);
  });
  try {
    trace.phase = 'MODEL_LOAD'; trace.modelReceipt = await call('LOAD');
    trace.phase = 'RAW_CAPTURE';
    for (const j of manifest.jobs) for (const w of j.windows) {
      const input = prepared.get(w.runOrdinal); prepared.delete(w.runOrdinal);
      const response = await call('RUN', { runOrdinal: w.runOrdinal, inputSha256: w.inputSha256, input: input.buffer }, [input.buffer]);
      trace.inferenceMs.push(response.elapsedMs);
      if (response.raw.byteLength !== PAIR_BYTES || response.runs !== w.runOrdinal + 1) throw Error('RAW_PAIR_ACCOUNTING');
      const uploaded = await fetch('/raw/' + w.runOrdinal, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: response.raw });
      if (!uploaded.ok) throw Error('RAW_READBACK_FAILED:' + await uploaded.text());
      const receipt = await uploaded.json();
      if (receipt.runOrdinal !== w.runOrdinal || receipt.pairSha256 !== await sha(new Uint8Array(response.raw))) throw Error('RAW_HOST_READBACK_SHA');
      trace.completedUploads++;
      await fetch('/progress', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...trace, lastInferenceMs: response.elapsedMs }) });
    }
    trace.disposal = await call('DISPOSE'); trace.phase = 'COMPLETE'; trace.unresolvedRequests = pending.size;
    if (trace.loads !== 1 || trace.loadAttempts !== 1 || trace.runs !== 228 || trace.successfulSessionRuns !== 228
      || trace.failedSessionRuns !== 0 || trace.completedUploads !== 228 || trace.unknownResponse || pending.size) throw Error('FINAL_CAPTURE_ACCOUNTING');
    return trace;
  } catch (error) { trace.failure = String(error.stack ?? error); trace.phase = 'FAILED'; trace.unresolvedRequests = pending.size; throw error; }
  finally { worker.terminate(); }
};
