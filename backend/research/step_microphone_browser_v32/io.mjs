import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const DIR = 'backend/research/step_microphone_browser_v32', OUT = 'backend/research/reports/step_microphone_browser_v32';
export const V26 = 'backend/research/reports/step_microphone_browser_v26', V26SRC = 'backend/research/step_microphone_browser_v26';
export const V27 = 'backend/research/reports/step_microphone_browser_v27';
export const START = 'd87299715789803129b88999f56967197b5fbbe3', BRANCH = 'codex/customer-web-delivery-boundary';
export const rawBytesSha256 = b => createHash('sha256').update(b).digest('hex');
export const bytes = p => readFile(path.resolve(ROOT, p)), load = async p => JSON.parse(await bytes(p));
export const now = () => new Date().toISOString();
export const exists = p => access(path.resolve(ROOT, p)).then(() => true, e => { if (e.code === 'ENOENT') return false; throw e; });
export const gitBytes = (...a) => execFileSync('git', a, { cwd: ROOT, shell: false, maxBuffer: 128 * 1024 * 1024 });
export const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', shell: false, maxBuffer: 128 * 1024 * 1024 }).trim();
export async function save(name, v) {
  assert.equal(path.basename(name), name);
  await mkdir(path.resolve(ROOT, OUT), { recursive: true });
  const text = typeof v === 'string' ? v.replaceAll('\r\n', '\n').trimEnd() : JSON.stringify(v, null, 2);
  await writeFile(path.resolve(ROOT, OUT, name), (text ? text + '\n' : ''), { flag: 'wx' });
}
export function scope() {
  assert.equal(git('branch', '--show-current'), BRANCH); assert.equal(git('merge-base', START, 'HEAD'), START);
  const files = [...new Set([...git('diff', '--name-only', START).split('\n'), ...git('ls-files', '--others', '--exclude-standard').split('\n')].filter(Boolean))].sort();
  assert.ok(files.every(p => p.startsWith(DIR + '/') || p.startsWith(OUT + '/')), 'PRODUCTION_OR_HISTORY_MUTATION'); return files;
}
export function remote(clean = true) {
  const head = git('rev-parse', 'HEAD'); assert.equal(git('rev-parse', 'origin/' + BRANCH), head);
  assert.equal(git('ls-remote', 'origin', 'refs/heads/' + BRANCH).split(/\s/)[0], head);
  assert.equal(git('rev-list', '--left-right', '--count', 'HEAD...origin/' + BRANCH), '0\t0');
  if (clean) assert.equal(git('status', '--porcelain'), ''); return head;
}
export const zero = () => ({ chromeLaunches: 0, modelSessionLoads: 0, neuralRuns: 0, decoderRuns: 0, browserProductVerdictRuns: 0,
  hiddenWarmups: 0, unknownExecutions: 0, freshHoldoutAccess: 0, bundleRebuilds: 0 });
export async function github(head) {
  const c = execFileSync('git', ['credential', 'fill'], { cwd: ROOT, input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8', shell: false });
  const token = c.split(/\r?\n/).find(l => l.startsWith('password='))?.slice(9);
  assert.ok(token, 'GITHUB_CREDENTIAL_UNAVAILABLE');
  const get = async suffix => {
    const r = await fetch('https://api.github.com/repos/tinghui0912/NoteVerse-Pro/' + suffix,
      { headers: { 'User-Agent': 'NoteVerse-V32-closeout', Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(60000) });
    assert.ok(r.ok, 'GITHUB_HTTP_' + r.status); return r.json();
  };
  const combined = await get('commits/' + head + '/status'), statuses = await get('commits/' + head + '/statuses?per_page=100');
  const runs = await get('actions/runs?head_sha=' + head + '&per_page=100');
  return { head, queriedAt: now(), combinedState: combined.state, statuses, workflow_runs: runs.workflow_runs,
    workflowRunTotalCount: runs.total_count, ciInterpretation: !statuses.length && !runs.total_count ? 'NOT CI PASS' : 'ACTUAL_GITHUB_RESULTS_ONLY_LOCAL_TESTS_ARE_NOT_CI' };
}
