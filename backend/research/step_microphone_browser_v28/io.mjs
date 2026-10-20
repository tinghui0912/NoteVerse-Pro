import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const DIR = 'backend/research/step_microphone_browser_v28';
export const OUT = 'backend/research/reports/step_microphone_browser_v28';
export const V26 = 'backend/research/reports/step_microphone_browser_v26';
export const V26SRC = 'backend/research/step_microphone_browser_v26';
export const V27 = 'backend/research/reports/step_microphone_browser_v27';
export const START = 'e8a2d040cbf45eff24ecf6c44bd6ba4430bec9f2';
export const BRANCH = 'codex/customer-web-delivery-boundary';
export const bytes = p => readFile(path.join(ROOT, p));
export const load = async p => JSON.parse(await bytes(p));
export const sha = b => createHash('sha256').update(b).digest('hex');
export const now = () => new Date().toISOString();
export const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 }).trim();
export const exists = p => access(path.join(ROOT, p)).then(() => true, e => { if (e.code === 'ENOENT') return false; throw e; });
export async function save(name, value) {
  assert.equal(path.basename(name), name);
  await mkdir(path.join(ROOT, OUT), { recursive: true });
  await writeFile(path.join(ROOT, OUT, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
}
export function scope() {
  assert.equal(git('branch', '--show-current'), BRANCH);
  assert.equal(git('merge-base', START, 'HEAD'), START);
  const files = [...new Set([...git('diff', '--name-only', START).split('\n'), ...git('ls-files', '--others', '--exclude-standard').split('\n')].filter(Boolean))];
  assert.ok(files.every(p => p.startsWith(DIR + '/') || p.startsWith(OUT + '/')), 'UNAUTHORIZED_SCOPE');
  return files;
}
export function exactRemote() {
  const head = git('rev-parse', 'HEAD');
  assert.equal(git('rev-parse', 'origin/' + BRANCH), head);
  assert.equal(git('ls-remote', 'origin', 'refs/heads/' + BRANCH).split(/\s/)[0], head);
  assert.equal(git('rev-list', '--left-right', '--count', 'HEAD...origin/' + BRANCH), '0\t0');
  assert.equal(git('status', '--porcelain'), '');
  return head;
}
export const zeroCounters = () => ({ browserCampaigns: 0, chromeLaunches: 0, audioContexts: 0, captureGraphs: 0,
  productWorkers: 0, modelSessionLoads: 0, neuralRunAttempts: 0, neuralRunSuccesses: 0, decoderRuns: 0,
  productRuntimeConstructions: 0, productVerdictRuns: 0, hiddenWarmups: 0, unknownExecutions: 0,
  freshHoldoutAccess: 0, bundleRebuilds: 0, rootLossStimuli: 0 });
