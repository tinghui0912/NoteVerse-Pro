import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { evidencePaths } from './inventory.mjs';
export const ROOT = path.resolve(import.meta.dirname, '../../..');
export const DIR = 'backend/research/microphone_product_policy_v16';
export const OUT = 'backend/research/reports/microphone_product_policy_v16';
export const WORK = 'backend/data/work/microphone_product_policy_v16';
export const START = '2384dbb79895c23c7aaf4725fcadac8a6ebb4649';
export const BRANCH = 'codex/customer-web-delivery-boundary';
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trim();
export const now = () => new Date().toISOString();
export const bytes = file => readFile(path.join(ROOT, file));
export const load = async file => JSON.parse(await bytes(file));
export async function save(name, value) {
  const file = path.join(ROOT, OUT, name); await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
}
export async function saveIdenticalInventory(name, value) {
  try {
    const existing = await bytes(OUT + '/' + name);
    if (existing.toString() !== JSON.stringify(value, null, 2) + '\n') throw Error('PREEXISTING_INVENTORY_CONFLICT:' + name);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await save(name, value);
  }
}
export const execution = Object.freeze({ newNeuralRuns: 0, modelSessionLoads: 0, acousticWorkerConstructions: 0,
  decoderARuns: 0, decoderBRuns: 0, selectedPcmDecodeRuns: 0, ContinuousAcousticReruns: 0, StepAcousticReruns: 0,
  freshHoldoutAccess: 0, hiddenWarmupRuns: 0, unknownRuns: 0 });
export const accepted = {
  [evidencePaths.v15]: '290c41185e488bfb6d08fd50b193d175ba5941ed37171ba2db73e969339e8b8a',
  [evidencePaths.v15Assessment]: '739e71cbb863789103ee4230c4e777fe82c8d28e70ffe65affd06c3f9c9d0f83',
  [evidencePaths.v15Freeze]: '5707123068bc2faa7e7286d37f0dbd4a79860f21abf480034c963ac371759e7b',
  [evidencePaths.musical]: '71a120574760a7dde5ab4956a6a0918d1199bb3f7afc788f9c1b67052944bc1e',
  [evidencePaths.scenarios]: 'fe91b48802b3c1d27e412e90dd27a4e20ebc90e8ef011a0ccee90838434c2d55',
  [evidencePaths.truth]: '745152c3cd7b7fc746a427398914b3eebcc19c9d99d768ac530199293c141b8e'
};
export async function checkScope() {
  if (git('merge-base', START, 'HEAD') !== START) throw Error('START_NOT_ANCESTOR');
  const changed = [...new Set([...git('diff', '--name-only', START).split('\n'),
    ...git('ls-files', '--others', '--exclude-standard').split('\n')].filter(Boolean))];
  if (changed.some(p => !p.startsWith(DIR + '/') && !p.startsWith(OUT + '/'))) throw Error('PRODUCTION_OR_HISTORY_MUTATION:' + changed);
  for (const [file, expected] of Object.entries(accepted)) if (hash(await bytes(file)) !== expected) throw Error('ACCEPTED_IDENTITY_MISMATCH:' + file);
  return changed;
}
export async function historicalSnapshot() {
  const files = git('ls-tree', '-r', '--name-only', START, '--', 'backend/research').split('\n').filter(Boolean);
  const rows = [];
  for (const file of files) rows.push({ path: file, sha256: hash(await bytes(file)) });
  return rows;
}
export async function verifyFrozen() {
  await checkScope(); const frozen = await load(OUT + '/policy-research-freeze.json');
  for (const file of frozen.files) if (hash(await bytes(file.path)) !== file.sha256) throw Error('FROZEN_FILE_MUTATED:' + file.path);
  const baseline = await load(OUT + '/historical-raw-identities.json');
  for (const file of baseline.files) if (hash(await bytes(file.path)) !== file.sha256) throw Error('HISTORICAL_BYTES_MUTATED:' + file.path);
  return frozen;
}
export function assertGraph(inputs) {
  for (const p of inputs.map(s => s.replaceAll('\\', '/'))) {
    if (p !== DIR + '/isolation.ts' && !p.startsWith('apps/customer-web/src/lib/practice/local-core/')) throw Error('FORBIDDEN_EXECUTABLE_IMPORT:' + p);
  }
}
export async function isolationBundle() {
  const builder = await import(pathToFileURL(path.join(ROOT, 'backend/data/work/basic_pitch_browser_feasibility/node_modules/esbuild/lib/main.js')).href);
  const outfile = path.join(ROOT, WORK, 'isolation.mjs');
  const result = await builder.build({ absWorkingDir: ROOT, entryPoints: [DIR + '/isolation.ts'], outfile,
    bundle: true, platform: 'node', format: 'esm', metafile: true, logLevel: 'silent' });
  const inputs = Object.keys(result.metafile.inputs); assertGraph(inputs);
  return { inputGraph: inputs, module: await import(pathToFileURL(outfile).href) };
}
export function freezeValue(value) {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freezeValue(child); Object.freeze(value); }
  return value;
}
export function validateCompleted(evaluation, publications) {
  if (evaluation.status !== 'COMPLETE' || !evaluation.completion) throw Error('COMPLETE_EVIDENCE_MISSING');
  const declared = evaluation.groups.flatMap(g => {
    if (!g.finality || g.verdict === 'PENDING') throw Error('FINALITY_MISSING');
    return [...g.strikes.flatMap(s => {
      if (!s.finality || s.state === 'PENDING') throw Error('STRIKE_FINALITY_MISSING');
      return s.state === 'MATCHED' ? [{ observation: s.match.observation, disposition: 'MATCHED', ownerId: s.strikeId }] : [];
    }), ...g.wrongObservations.map(o => ({ observation: o, disposition: 'WRONG', ownerId: g.groupId }))];
  }).concat(evaluation.extras.map(e => {
    if (!e.finality) throw Error('EXTRA_FINALITY_MISSING');
    return { observation: e.observation, disposition: 'EXTRA', ownerId: e.observation.observationId };
  }));
  const byId = new Map(publications.flatMap(p => p.observations).map(o => [o.observationId, o]));
  if (new Set(declared.map(d => d.observation.observationId)).size !== declared.length
    || declared.length !== evaluation.observationOwnership.length || byId.size !== declared.length) throw Error('INCOMPLETE_OR_DUPLICATE_OWNERSHIP');
  for (const d of declared) {
    const o = d.observation, p = o.provenance;
    if (o.source !== 'ACOUSTIC' || !p?.sourceDomainId || ![44100, 48000].includes(p.sourceSampleRateHz)
      || !Number.isFinite(p.sourceEventSample) || JSON.stringify(byId.get(o.observationId)) !== JSON.stringify(o)
      || !evaluation.observationOwnership.some(owner => owner.observationId === o.observationId && owner.disposition === d.disposition && owner.ownerId === d.ownerId)) throw Error('SOURCE_PROVENANCE_OR_OWNERSHIP_MISMATCH');
  }
  return { status: 'COMPLETE_ACOUSTIC_EVIDENCE_LINKED', observationsLinked: declared.length, ownershipComplete: true };
}
export function completedRecords(parity, musical) {
  const records = [];
  for (const c of parity.cells) {
    const raw = musical.results.find(r => r.id === c.id && r.rate === c.rate);
    if (!raw) throw Error('MUSICAL_CELL_MISSING');
    for (const scenario of c.scenarios) records.push({ id: `${c.id}:${c.rate}:${scenario.family}`, physicalClipId: c.id,
      rate: c.rate, role: 'EXPOSED_COUNTERFACTUAL_COMPLETED_LEDGER_NOT_INDEPENDENT_RECORDING', family: scenario.family,
      evaluation: scenario.completed, publications: raw.publications });
  }
  return records;
}
