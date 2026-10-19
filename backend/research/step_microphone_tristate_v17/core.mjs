import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
export const ROOT = path.resolve(import.meta.dirname, '../../..');
export const DIR = 'backend/research/step_microphone_tristate_v17';
export const OUT = 'backend/research/reports/step_microphone_tristate_v17';
export const WORK = 'backend/data/work/step_microphone_tristate_v17';
export const START = 'e7b98f302431e61b19f3b6886b51ce4f50bb01e7';
export const BRANCH = 'codex/customer-web-delivery-boundary';
export const now = () => new Date().toISOString();
export const hash = b => createHash('sha256').update(b).digest('hex');
export const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trim();
export const bytes = file => readFile(path.join(ROOT, file));
export const load = async file => JSON.parse(await bytes(file));
export async function save(name, value) {
  const file = path.join(ROOT, OUT, name); await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
}
export const execution = Object.freeze({ newNeuralRuns: 0, modelSessionLoads: 0, acousticWorkerConstructions: 0,
  decoderARuns: 0, decoderBRuns: 0, PcmDecodeRuns: 0, StepAcousticReruns: 0, ContinuousAcousticReruns: 0,
  ContinuousProjectionReruns: 0, freshHoldoutAccess: 0, warmups: 0, unknownRuns: 0 });
export const inputs = {
  v15: 'backend/research/reports/step_robust_a_paced_replay_v15/paced-replay-results.json',
  v16: 'backend/research/reports/microphone_product_policy_v16/step-policy-results.json',
  v16Assessment: 'backend/research/reports/microphone_product_policy_v16/assessment.json',
  v16Freeze: 'backend/research/reports/microphone_product_policy_v16/policy-research-freeze.json',
  continuousInventory: 'backend/research/reports/microphone_product_policy_v16/continuous-code-inventory.json',
  cases: 'backend/research/reports/step_waiting_h50_holdout_v6/audio-bound-cases.json',
  scenarios: 'backend/research/reports/step_waiting_h50_holdout_v6/scenario-manifest.json'
};
export const accepted = {
  [inputs.v15]: '290c41185e488bfb6d08fd50b193d175ba5941ed37171ba2db73e969339e8b8a',
  [inputs.v16]: 'fa08a97eb24af34b0d3fcb41e94be44cb04fc771614690ebc43ba816ead8d858',
  [inputs.v16Assessment]: '2889f94c67ceed7be16469876a22c13eab6cbe0e76e1d4240768b58ae9fa086f',
  [inputs.v16Freeze]: 'af44e96cfc087341a2173fc8a29b9e95e890f09046af311e2d13e25e607100cc',
  [inputs.cases]: '745152c3cd7b7fc746a427398914b3eebcc19c9d99d768ac530199293c141b8e',
  [inputs.scenarios]: 'fe91b48802b3c1d27e412e90dd27a4e20ebc90e8ef011a0ccee90838434c2d55'
};
export const productionSources = ['apps/customer-web/src/lib/practice/local-core/step-runtime.ts',
  'apps/customer-web/src/lib/practice/local-core/step-attempt.ts',
  'apps/customer-web/src/lib/practice/step/step-practice-controller.ts',
  'apps/customer-web/src/lib/practice/step/step-retirement-policy.ts',
  'apps/customer-web/src/hooks/practice/use-step-local-practice.ts',
  'apps/customer-web/src/components/practice/practice-status.tsx',
  'apps/customer-web/src/components/practice/practice-skip-control.tsx',
  'apps/customer-web/src/app/[locale]/(workspace)/score/[id]/practice/page.tsx',
  'apps/customer-web/messages/en/practice.json', 'apps/customer-web/messages/zh/practice.json',
  'apps/customer-web/src/lib/practice/acoustic/model/model-contract.ts',
  'apps/customer-web/src/lib/practice/acoustic/model/acoustic-core-identity.json'];
export async function checkScope() {
  if (git('merge-base', START, 'HEAD') !== START) throw Error('START_NOT_ANCESTOR');
  const changed = [...new Set([...git('diff', '--name-only', START).split('\n'), ...git('ls-files', '--others', '--exclude-standard').split('\n')].filter(Boolean))];
  if (changed.some(p => !p.startsWith(DIR + '/') && !p.startsWith(OUT + '/'))) throw Error('OUT_OF_SCOPE_MUTATION');
  for (const [file, expected] of Object.entries(accepted)) if (hash(await bytes(file)) !== expected) throw Error('ACCEPTED_IDENTITY_MISMATCH:' + file);
  return changed;
}
export async function continuousUnchanged() {
  const inventory = await load(inputs.continuousInventory);
  for (const r of inventory.rows) if (hash(await bytes(r.path)) !== r.sha256) throw Error('V16_CONTINUOUS_INVENTORY_DRIFT:' + r.path);
  return { status: 'CONTINUOUS_SOURCE_SENSITIVE_PRESENTATION_READY_FOR_SEPARATE_PRODUCT_REFACTOR',
    interpretation: 'DESIGN_NOTE_ONLY_NOT_IMPLEMENTED_NOT_PRODUCTION_QUALIFICATION', sourceRowsVerified: inventory.rows.length,
    ContinuousProjectionReruns: 0, internalOwnershipChanged: false };
}
export async function historicalSnapshot() {
  const paths = git('ls-tree', '-r', '--name-only', START, '--', 'backend/research').split('\n').filter(Boolean), files = [];
  for (const file of paths) files.push({ path: file, sha256: hash(await bytes(file)) });
  return files;
}
export async function verifyFrozen() {
  await checkScope(); const freeze = await load(OUT + '/tristate-policy-freeze.json');
  for (const f of freeze.files) if (hash(await bytes(f.path)) !== f.sha256) throw Error('FROZEN_MUTATION:' + f.path);
  const history = await load(OUT + '/historical-raw-identities.json');
  for (const f of history.files) if (hash(await bytes(f.path)) !== f.sha256) throw Error('HISTORICAL_MUTATION:' + f.path);
  await continuousUnchanged(); return freeze;
}
export function assertGraph(graph) {
  for (const p of graph) if (p !== DIR + '/domain.ts' && !p.startsWith('apps/customer-web/src/lib/practice/local-core/')) throw Error('ACOUSTIC_OR_EXTERNAL_EXECUTABLE_IMPORT:' + p);
}
export async function bundleDomain() {
  const builder = await import(pathToFileURL(path.join(ROOT, 'backend/data/work/basic_pitch_browser_feasibility/node_modules/esbuild/lib/main.js')).href);
  const file = path.join(ROOT, WORK, 'domain.mjs');
  const b = await builder.build({ absWorkingDir: ROOT, entryPoints: [DIR + '/domain.ts'], outfile: file, bundle: true,
    platform: 'node', format: 'esm', metafile: true, logLevel: 'silent' });
  const graph = Object.keys(b.metafile.inputs); assertGraph(graph);
  return { graph, module: await import(pathToFileURL(file).href) };
}
