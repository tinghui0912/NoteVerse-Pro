import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
export const ROOT = path.resolve(import.meta.dirname, '../../..');
export const DIR = 'backend/research/step_next_acoustic_wave1_v14';
export const OUT = 'backend/research/reports/step_next_acoustic_wave1_v14';
export const WORK = 'backend/data/work/step_next_acoustic_wave1_v14';
export const LABEL = 'DEVELOPMENT_ONLY_NOT_QUALIFICATION';
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const load = async file => JSON.parse(await readFile(path.join(ROOT, file), 'utf8'));
export async function save(file, value) {
  await mkdir(path.dirname(path.join(ROOT, file)), { recursive: true });
  await writeFile(path.join(ROOT, file), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
}
export function moduleUrl(absolutePath) {
  if (!path.isAbsolute(absolutePath)) throw Error('ABSOLUTE_MODULE_PATH_REQUIRED');
  return pathToFileURL(absolutePath).href;
}
export function portable(file) {
  if (!file || file.includes('\\') || file.includes(':') || path.posix.isAbsolute(file)
    || file.split('/').some(p => !p || p === '.' || p === '..') || path.posix.normalize(file) !== file) throw Error('NONPORTABLE_PATH');
  return file;
}
export function assertGraph(inputs) {
  const bad = inputs.filter(p => /step-runtime|step-attempt|step-practice-controller|WaitingTopologyGate|selector|scorer|product-replay|scenario|midi-parser|evaluate\.ts/i.test(p));
  if (bad.length) throw Error('STAGE_A_TRUTH_IMPORT:' + bad);
}
export function classifyWorkers(urls) {
  const paths = urls.map(u => new URL(u).pathname);
  return { product: paths.filter(p => p === '/worker.js').length,
    ort: paths.filter(p => p === '/ort/ort-wasm-simd-threaded.jsep.mjs').length,
    unexpected: paths.filter(p => !['/worker.js', '/ort/ort-wasm-simd-threaded.jsep.mjs'].includes(p)) };
}
export function comparable(p) {
  return { sourceDomainId: p.sourceDomainId, sourceSampleRateHz: p.sourceSampleRateHz, window: p.window,
    observations: p.observations.map(o => ({ observationId: o.observationId, pitch: o.pitch, midiPitch: o.midiPitch,
      sourceDomainId: o.sourceDomainId, sourceSampleRateHz: o.sourceSampleRateHz,
      sourceEventSample: o.sourceEventSample, targetSample: o.targetSample, confidence: o.confidence })) };
}
