import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { DIR, OUT, START, BRANCH, git, gitBytes, sha256 } from './discovery.mjs';
import { scanText, scanFiles, filesUnder } from './security.mjs';
export { DIR, OUT, START, BRANCH, git, gitBytes, sha256, filesUnder, scanFiles };
export const now = () => new Date().toISOString();
export const load = file => JSON.parse(readFileSync(file));
export const BLOCKED = 'PRACTICE_ACOUSTIC_V38_MODEL_ASSET_DELIVERY_EXECUTION_INTEGRITY_BLOCKED';
export const SUCCESS = 'PRACTICE_ACOUSTIC_V38_AUTHENTICATED_MODEL_ASSET_DELIVERY_AND_OPFS_CACHE_ESTABLISHED_CAPABILITIES_CLOSED';
export function save(name, record) {
  assert.match(name, /^[a-z0-9.-]+$/);
  const text = JSON.stringify(record, null, 2) + '\n';
  assert.equal(scanText(text).length, 0, 'UNSAFE_REPORT_REJECTED');
  mkdirSync(OUT, { recursive: true }); writeFileSync(OUT + '/' + name, text, { flag: 'wx' });
}
export function scope() {
  assert.equal(git('branch', '--show-current'), BRANCH);
  assert.equal(git('merge-base', START, 'HEAD'), START);
  const changed = [...new Set([...git('diff', '--name-only', START).split('\n'),
    ...git('ls-files', '--others', '--exclude-standard').split('\n')].filter(Boolean))];
  assert.ok(changed.every(p => p.startsWith(DIR + '/') || p.startsWith(OUT + '/')), 'SCOPE_VIOLATION');
  return { changed, productionDiff: [], V3ThroughV37Diff: [], capabilitiesUnchanged: true };
}
export const execute = (file, args, options = {}) => execFileSync(file, args, {
  shell: false, maxBuffer: 128 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'], ...options });
export function remoteIdentity(expected) {
  const identity = { localHead: git('rev-parse', 'HEAD'), originHead: git('rev-parse', 'origin/' + BRANCH),
    lsRemoteHead: git('ls-remote', 'origin', 'refs/heads/' + BRANCH).split(/\s/)[0],
    aheadBehind: git('rev-list', '--left-right', '--count', 'HEAD...origin/' + BRANCH).split(/\s+/).map(Number),
    cleanWorktree: git('status', '--porcelain') === '' };
  assert.equal(identity.localHead, expected); assert.equal(identity.originHead, expected);
  assert.equal(identity.lsRemoteHead, expected); assert.deepEqual(identity.aheadBehind, [0, 0]);
  assert.equal(identity.cleanWorktree, true); return identity;
}
export async function github(head) {
  const raw = execute('git', ['credential', 'fill'], { input: 'protocol=https\nhost=github.com\n\n' }).toString();
  const token = raw.split(/\r?\n/).find(line => line.startsWith('password='))?.slice(9);
  assert.ok(token, 'GITHUB_AUTH_UNAVAILABLE');
  const get = async suffix => {
    const response = await fetch('https://api.github.com/repos/tinghui0912/NoteVerse-Pro/' + suffix, {
      headers: { Authorization: 'Bearer ' + token, 'User-Agent': 'NoteVerse-V38-audit', Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(60000) });
    assert.equal(response.ok, true, 'GITHUB_QUERY_FAILED'); return response.json();
  };
  const combined = await get('commits/' + head + '/status');
  const statuses = await get('commits/' + head + '/statuses?per_page=100');
  const workflows = await get('actions/runs?head_sha=' + head + '&per_page=100');
  return { head, queriedAt: now(), combinedState: combined.state,
    statuses: statuses.map(s => ({ state: s.state, context: s.context })),
    workflowRuns: workflows.workflow_runs.map(r => ({ id: r.id, status: r.status, conclusion: r.conclusion })),
    ciInterpretation: !statuses.length && !workflows.total_count ? 'NOT CI PASS' : 'ACTUAL_GITHUB_RESULTS_ONLY' };
}
export function fail(stage, error) {
  save('first-failure.json', { disposition: BLOCKED, firstFailedGate: stage, at: now(),
    safeCode: error.safeCode ?? 'MANDATORY_GATE_FAILED', errorClass: error.name,
    unsafeErrorTextOmitted: true, noRetry: true, productionDefectEstablished: false });
  console.log(JSON.stringify({ disposition: BLOCKED, firstFailedGate: stage }));
}
