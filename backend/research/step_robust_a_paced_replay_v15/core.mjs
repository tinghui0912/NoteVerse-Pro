import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
export const ROOT = path.resolve(import.meta.dirname, '../../..');
export const DIR = 'backend/research/step_robust_a_paced_replay_v15';
export const OUT = 'backend/research/reports/step_robust_a_paced_replay_v15';
export const WORK = 'backend/data/work/step_robust_a_paced_replay_v15';
export const START = 'a7a49041b88af250272cdec710e0108d6f9bdd63';
export const BRANCH = 'codex/customer-web-delivery-boundary';
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
export const now = () => new Date().toISOString();
export const load = async file => JSON.parse(await readFile(path.join(ROOT, file), 'utf8'));
export async function save(name, value) {
  const file = path.join(ROOT, OUT, name);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
}
export const FIXED = {
  acoustic: ['backend/research/reports/step_waiting_h50_holdout_v7/stage-a/acoustic.json', '61411716e8f42bf70b235946bc89da9b5e408a3a0e58970f254314f3fdcfa2b1'],
  acousticSeal: ['backend/research/reports/step_waiting_h50_holdout_v7/stage-a/acoustic-seal.json', '5ffdb33b8f34791249f40e8c7b6c778b6d93a5f362b305b77120269ceb933f85'],
  eligibility: ['backend/research/reports/step_waiting_h50_holdout_v8/downstream-eligibility-seal.json', '7256b87d1716cc4eab27e90e0b7746cff138d10acad281dc90ad574d43cc798c'],
  cases: ['backend/research/reports/step_waiting_h50_holdout_v6/audio-bound-cases.json', '745152c3cd7b7fc746a427398914b3eebcc19c9d99d768ac530199293c141b8e'],
  scenarios: ['backend/research/reports/step_waiting_h50_holdout_v6/scenario-manifest.json', 'fe91b48802b3c1d27e412e90dd27a4e20ebc90e8ef011a0ccee90838434c2d55'],
  mapping: ['backend/research/reports/step_waiting_h50_holdout_v6/input-preservation.json', '27d80f956f207366f3739d8277f559f98b7ba85f4f51df7a75b7dd57da2e2c51'],
  scorer: ['backend/research/step_waiting_h50_holdout_v3/scorer-contract.json', 'b0691e5b8b03a550fd7a869328ffba83107587753a5951d8ae48aa89d9860ddd'],
  historicalBSource: ['backend/research/browser_runtime/xc2_decoders.mjs', '4a81ac847b62485ff1ed13e865736b418c798515abd886b0fdef7dfdd992efbf'],
  modelBytes: ['backend/data/work/phase9gd1_robust_browser_onnx/robust_bytedance_fixed_1820_opset18.onnx', '4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3']
};
export const COUNTS = Object.freeze({ newNeuralRuns: 0, modelSessionLoads: 0, acousticWorkerConstructions: 0,
  decoderARuns: 0, decoderBRuns: 0, selectedPcmDecodeRuns: 0, hiddenWarmupRuns: 0, unknownRuns: 0,
  freshHoldoutAccess: 0, StageAReruns: 0, ContinuousAcousticReruns: 0 });
export const historicalPaths = [...Array.from({ length: 8 }, (_, i) => `step_waiting_h50_holdout_v${i + 3}`),
  'step_next_acoustic_wave1_v11', 'step_paced_lifecycle_v12', 'step_local_ownership_v13', 'step_next_acoustic_wave1_v14']
  .flatMap(p => [`backend/research/${p}`, `backend/research/reports/${p}`]);
export async function integrity() {
  if (git('merge-base', START, 'HEAD') !== START) throw Error('START_NOT_ANCESTOR');
  const productionDiff = git('diff', '--name-only', START, '--', 'apps/customer-web/src', 'apps/customer-web/public', 'backend/app');
  const historicalDiff = git('diff', '--name-only', START, '--', ...historicalPaths);
  const untracked = git('ls-files', '--others', '--exclude-standard').split('\n').filter(Boolean);
  if (productionDiff || historicalDiff || untracked.some(p => historicalPaths.some(h => p.startsWith(h + '/')))) throw Error('PROTECTED_MUTATION');
  const fixed = [];
  for (const [identity, [file, expected]] of Object.entries(FIXED)) {
    const bytes = await readFile(path.join(ROOT, file));
    if (hash(bytes) !== expected || (identity === 'modelBytes' && bytes.length !== 98689283)) throw Error('FIXED_IDENTITY_MISMATCH:' + identity);
    fixed.push({ identity, path: file, bytes: bytes.length, sha256: expected, method: 'RAW_BYTES_ONLY' });
  }
  const eligibility = await load(FIXED.eligibility[0]);
  if (eligibility.status !== 'SEALED_BLIND_STAGE_A_OUTPUT_ELIGIBLE_FOR_FROZEN_STAGE_B_AFTER_ACCOUNTING_ADJUDICATION') throw Error('DOWNSTREAM_SEAL_STATUS');
  const files = git('ls-files', '--', ...historicalPaths).split('\n').filter(Boolean);
  const historicalFiles = [];
  for (const file of files) {
    const bytes = await readFile(path.join(ROOT, file));
    const original = execFileSync('git', ['show', `${START}:${file}`], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
    const originalSha256 = hash(original), checkoutSha256 = hash(bytes);
    // Clean Windows text checkouts can have CRLF while the unchanged Git blob has LF.
    // Fixed accepted raw-SHA identities above never use this Git text-filter comparison.
    const expectedBlob = git('rev-parse', `${START}:${file}`);
    if (originalSha256 !== checkoutSha256 && git('hash-object', '--path=' + file, file) !== expectedBlob) throw Error('HISTORICAL_MUTATION:' + file);
    historicalFiles.push({ path: file, sha256: checkoutSha256, gitBlob: expectedBlob, gitContentSha256: originalSha256,
      checkoutBytesEqualGitBytes: originalSha256 === checkoutSha256 });
  }
  return { productionDiff: [], historicalDiff: [], historicalFiles, fixed };
}
export function assertImportGraph(inputs) {
  const allowed = [DIR + '/replay.ts', 'backend/research/step_waiting_topology_v3/assembly.ts'];
  for (const file of inputs.map(f => f.replaceAll('\\', '/'))) {
    if (!allowed.includes(file) && !file.startsWith('apps/customer-web/src/lib/practice/local-core/')) throw Error('FORBIDDEN_EXECUTABLE_IMPORT:' + file);
  }
}
export async function bundle() {
  const esbuild = await import(pathToFileURL(path.join(ROOT, 'backend/data/work/basic_pitch_browser_feasibility/node_modules/esbuild/lib/main.js')).href);
  const outfile = path.join(ROOT, WORK, 'replay.mjs');
  const result = await esbuild.build({ entryPoints: [DIR + '/replay.ts'], absWorkingDir: ROOT,
    outfile, bundle: true, platform: 'node', format: 'esm', metafile: true, logLevel: 'silent' });
  const inputs = Object.keys(result.metafile.inputs); assertImportGraph(inputs);
  return { module: await import(pathToFileURL(outfile).href), inputs };
}
export function extractMetrics(report) {
  return ['LINEAR_A_600_220', 'LINEAR_B_600_220', 'BAND_LIMITED_A_600_220', 'BAND_LIMITED_B_600_220'].map(id => {
    const rows = report.candidates.filter(c => c.id === id);
    if (rows.length !== 1) throw Error('HISTORICAL_METRIC_IDENTITY');
    const c = rows[0];
    return { id, extrasPredicted: c.counts.extrasPredicted, extraPrecision: c.rates.extraPrecision,
      chordExactCompleteness: c.rates.chordExactCompleteness, overallVerdictAgreement: c.rates.overallVerdictAgreement };
  });
}
