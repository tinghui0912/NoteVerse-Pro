import path from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
export const ROOT = path.resolve(import.meta.dirname, '../../..');
export const DIR = 'backend/research/robust_threshold_v21';
export const OUT = 'backend/research/reports/robust_threshold_v21';
export const V20 = 'backend/research/reports/robust_raw_tensor_v20';
export const START = '40ec4029ac3f730c848e107ca0adebc0fa8ed40b';
export const BRANCH = 'codex/customer-web-delivery-boundary';
export const hash = b => createHash('sha256').update(b).digest('hex');
export const now = () => new Date().toISOString();
export const bytes = p => readFile(path.join(ROOT, p));
export const load = async p => JSON.parse(await bytes(p));
export async function save(p, value) {
  await mkdir(path.dirname(path.join(ROOT, p)), { recursive: true });
  await writeFile(path.join(ROOT, p), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
}
export const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
export const canonical = v => v === null || typeof v !== 'object' ? JSON.stringify(v) : Array.isArray(v)
  ? '[' + v.map(canonical).join(',') + ']' : '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
export const zero = Object.freeze({ neuralRuns: 0, modelSessionLoads: 0, acousticWorkerConstructions: 0,
  pcmDecodeRuns: 0, resamplingRuns: 0, freshHoldoutAccess: 0, modelWarmupRuns: 0, unknownNeuralExecutions: 0,
  decoderBRuns: 0, decoderCRuns: 0, ContinuousAcousticReruns: 0 });
export function decodeLE(b) {
  if (b.length !== 64416) throw Error('TENSOR_BYTE_LENGTH');
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength), out = new Float32Array(16104);
  for (let i = 0; i < out.length; i++) out[i] = view.getFloat32(i * 4, true);
  if (out.some(v => !Number.isFinite(v))) throw Error('NONFINITE_TENSOR');
  return out;
}
