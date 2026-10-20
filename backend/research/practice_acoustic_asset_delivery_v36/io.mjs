import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { scanText } from './security.mjs';
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const DIR = 'backend/research/practice_acoustic_asset_delivery_v36', OUT = 'backend/research/reports/practice_acoustic_asset_delivery_v36';
export const START = '922c80263633b1b8afd7d2dec83c78f296635c45', BRANCH = 'codex/customer-web-delivery-boundary';
export const rawBytesSha256 = b => createHash('sha256').update(b).digest('hex');
export const bytes = p => readFile(path.resolve(ROOT, p)), load = async p => JSON.parse(await bytes(p));
export const now = () => new Date().toISOString();
export const exists = p => access(path.resolve(ROOT, p)).then(() => true, e => { if (e.code === 'ENOENT') return false; throw e; });
export const gitBytes = (...args) => execFileSync('git', args, { cwd: ROOT, shell: false, maxBuffer: 128 * 1024 * 1024 });
export const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', shell: false, maxBuffer: 128 * 1024 * 1024 }).trim();
export async function save(name, value) {
  assert.equal(path.basename(name), name);
  const text = typeof value === 'string' ? value.replaceAll('\r\n', '\n').trimEnd() + '\n' : JSON.stringify(value, null, 2) + '\n';
  assert.equal(scanText(text).length, 0, 'UNSAFE_OUTPUT_REFUSED_WITHOUT_LOGGING_VALUE');
  await mkdir(path.resolve(ROOT, OUT), { recursive: true });
  await writeFile(path.resolve(ROOT, OUT, name), text, { flag: 'wx' });
}
export function scope() {
  assert.equal(git('branch', '--show-current'), BRANCH); assert.equal(git('merge-base', START, 'HEAD'), START);
  const changed = [...new Set([...git('diff', '--name-only', START).split('\n'), ...git('ls-files', '--others', '--exclude-standard').split('\n')].filter(Boolean))].sort();
  assert.ok(changed.every(p => p.startsWith(DIR + '/') || p.startsWith(OUT + '/')), 'PRODUCTION_OR_HISTORY_MUTATION'); return changed;
}
export async function github(head) {
  const credential = execFileSync('git', ['credential', 'fill'], { cwd: ROOT, input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8', shell: false });
  const token = credential.split(/\r?\n/).find(l => l.startsWith('password='))?.slice(9);
  assert.ok(token, 'GITHUB_CREDENTIAL_UNAVAILABLE');
  const get = async suffix => {
    const r = await fetch('https://api.github.com/repos/tinghui0912/NoteVerse-Pro/' + suffix,
      { headers: { 'User-Agent': 'NoteVerse-V36-closeout', Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(60000) });
    assert.ok(r.ok, 'GITHUB_HTTP_' + r.status); return r.json();
  };
  const combined = await get('commits/' + head + '/status'), statuses = await get('commits/' + head + '/statuses?per_page=100');
  const runs = await get('actions/runs?head_sha=' + head + '&per_page=100');
  return { head, queriedAt: now(), combinedState: combined.state, statuses, workflow_runs: runs.workflow_runs,
    workflowRunTotalCount: runs.total_count, ciInterpretation: !statuses.length && !runs.total_count ? 'NOT CI PASS' : 'ACTUAL_GITHUB_RESULTS_ONLY_LOCAL_TESTS_ARE_NOT_CI' };
}
