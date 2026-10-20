export const INPUT_SAMPLES = 29120;
export const VALUES = 183 * 88;
export const TENSOR_BYTES = VALUES * 4;
export const PAIR_BYTES = TENSOR_BYTES * 2;
export const CORPUS_BYTES = 228 * 2 * (1 * 183 * 88) * Float32Array.BYTES_PER_ELEMENT;
export function encodeLE(values) {
  if (!(values instanceof Float32Array) || values.some(v => !Number.isFinite(v))) throw Error('FINITE_FLOAT32_REQUIRED');
  const out = new Uint8Array(values.length * 4), view = new DataView(out.buffer);
  for (let i = 0; i < values.length; i++) view.setFloat32(i * 4, values[i], true);
  return out;
}
export function decodeLE(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length % 4) throw Error('FLOAT32_BYTE_LENGTH');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), out = new Float32Array(bytes.length / 4);
  for (let i = 0; i < out.length; i++) out[i] = view.getFloat32(i * 4, true);
  if (out.some(v => !Number.isFinite(v))) throw Error('NONFINITE_FLOAT32');
  return out;
}
export function tensor(t) {
  if (t?.type !== 'float32' || JSON.stringify(t.dims) !== '[1,183,88]' || !(t.data instanceof Float32Array)
    || t.data.length !== VALUES) throw Error('RAW_OUTPUT_DESCRIPTOR_MISMATCH');
  return encodeLE(t.data);
}
export function pair(onset, frame) {
  const a = tensor(onset), b = tensor(frame), out = new Uint8Array(PAIR_BYTES);
  out.set(a); out.set(b, TENSOR_BYTES); return out;
}
export async function sha(bytes) {
  const copy = new Uint8Array(bytes.length); copy.set(bytes);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', copy))].map(x => x.toString(16).padStart(2, '0')).join('');
}
export function assertInventory(manifest) {
  if (manifest.schema !== 'V23_OPAQUE_FROZEN_MODEL_INPUTS_ONLY' || manifest.jobs.length !== 18) throw Error('JOB_INVENTORY');
  const fields = ['jobId','sourceCaseId','sourceDomainId','sourceRateHz','sourceOriginSample','inputBlobPath','inputBlobSha256','windows'];
  const ids = new Set(); let count = 0;
  for (const j of manifest.jobs) {
    if (JSON.stringify(Object.keys(j).sort()) !== JSON.stringify(fields.sort()) || ids.has(j.jobId)
      || !/^j-[a-f0-9]{24}$/.test(j.jobId) || ![44100,48000].includes(j.sourceRateHz)) throw Error('OPAQUE_JOB_FIELDS');
    ids.add(j.jobId);
    for (const w of j.windows) {
      if (w.runOrdinal !== count++ || w.samples !== INPUT_SAMPLES || w.inputBytes !== INPUT_SAMPLES * 4
        || w.runtimeWindow.endSample - w.runtimeWindow.startSample !== INPUT_SAMPLES
        || !/^[a-f0-9]{64}$/.test(w.inputSha256)) throw Error('INPUT_INVENTORY');
    }
  }
  if (count !== 228 || new Set(manifest.jobs.map(j => j.sourceCaseId)).size !== 9
    || manifest.jobs.filter(j => j.sourceRateHz === 44100).length !== 9 || manifest.jobs.filter(j => j.sourceRateHz === 48000).length !== 9) throw Error('CORPUS_INVENTORY');
}
