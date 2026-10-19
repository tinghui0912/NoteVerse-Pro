import path from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

export const ROOT = path.resolve(import.meta.dirname, '../../..');
export const DIR = 'backend/research/robust_signed_zero_v22';
export const OUT = 'backend/research/reports/robust_signed_zero_v22';
export const V21 = 'backend/research/reports/robust_threshold_v21';
export const V20 = 'backend/research/reports/robust_raw_tensor_v20';
export const START = 'ebd1220d3f342ea67a49be5b9b964ad01156ff51';
export const BRANCH = 'codex/customer-web-delivery-boundary';
export const hash = b => createHash('sha256').update(b).digest('hex');
export const now = () => new Date().toISOString();
export const bytes = p => readFile(path.join(ROOT, p));
export const json = async p => JSON.parse(await bytes(p));
export async function save(p, value) {
  if (!p.startsWith(OUT + '/')) throw Error('WRITE_OUTSIDE_V22_REPORT_NAMESPACE');
  await mkdir(path.dirname(path.join(ROOT, p)), { recursive: true });
  await writeFile(path.join(ROOT, p), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
}
export const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
export const committedBytes = p => execFileSync('git', ['show', START + ':' + p], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
export const execution = Object.freeze({ neuralRuns: 0, modelSessionLoads: 0, acousticWorkerConstructions: 0,
  pcmDecodeRuns: 0, resamplingRuns: 0, decoderACalls: 0, decoderBCalls: 0, decoderCCalls: 0,
  H50ReplayRuns: 0, StepPracticeRuntimeConstructions: 0, productVerdictRuns: 0, ContinuousAcousticRuns: 0,
  freshHoldoutAccess: 0, warmups: 0, unknownExecution: 0 });
