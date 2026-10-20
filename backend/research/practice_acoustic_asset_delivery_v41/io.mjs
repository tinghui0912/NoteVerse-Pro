import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { DIR, OUT, START, BRANCH, git, gitBytes, sha256 } from './discovery.mjs';
import { captureProcess, requireProcessSuccess, reportSensitiveValues } from './process-result.mjs';
import { scanText, scanFiles, filesUnder } from './security.mjs';
export { DIR, OUT, START, BRANCH, git, gitBytes, sha256, scanFiles, filesUnder };
export const now = () => new Date().toISOString();
export const load = file => JSON.parse(readFileSync(file));
export const BLOCKED = 'PRACTICE_ACOUSTIC_V41_MODEL_ASSET_DELIVERY_EXECUTION_INTEGRITY_BLOCKED';
export const SUCCESS = 'PRACTICE_ACOUSTIC_V41_AUTHENTICATED_MODEL_ASSET_DELIVERY_AND_OPFS_CACHE_ESTABLISHED_CAPABILITIES_CLOSED';
export function save(name, value, mutableEngineering = false) {
  assert.match(name, /^[a-z0-9.-]+$/);
  const text = JSON.stringify(value, null, 2) + '\n';
  assert.equal(scanText(text, reportSensitiveValues()).length, 0, 'UNSAFE_REPORT_REFUSED'); mkdirSync(OUT, { recursive: true });
  writeFileSync(OUT + '/' + name, text, { flag: mutableEngineering ? 'w' : 'wx' });
}
export function scope() {
  assert.equal(git('branch', '--show-current'), BRANCH); assert.equal(git('merge-base', START, 'HEAD'), START);
  const changed = [...new Set([...git('diff', '--name-only', START).split('\n'), ...git('ls-files', '--others', '--exclude-standard').split('\n')].filter(Boolean))];
  assert.ok(changed.every(p => p.startsWith(DIR + '/') || p.startsWith(OUT + '/')), 'PROTECTED_SCOPE_MUTATION');
  return { productionDiff: [], V3ThroughV40Diff: [], capabilitiesUnchanged: true };
}
export const execute = (file, argv, options = {}) => requireProcessSuccess(captureProcess(file, argv, options), 'DIRECT_ARGV_' + file);
export function remoteIdentity(expected, requireClean = true) {
  const value = { localHead: git('rev-parse', 'HEAD'), originHead: git('rev-parse', 'origin/' + BRANCH),
    liveRemoteHead: git('ls-remote', 'origin', 'refs/heads/' + BRANCH).split(/\s/)[0],
    aheadBehind: git('rev-list', '--left-right', '--count', 'HEAD...origin/' + BRANCH).split(/\s+/).map(Number), cleanWorktree: git('status', '--porcelain') === '' };
  assert.equal(value.localHead, expected); assert.equal(value.originHead, expected); assert.equal(value.liveRemoteHead, expected);
  assert.deepEqual(value.aheadBehind, [0, 0]); if (requireClean) assert.equal(value.cleanWorktree, true); return value;
}
export async function github(head) {
  const raw = execute('git', ['credential', 'fill'], { input: 'protocol=https\nhost=github.com\n\n' }).toString();
  const token = raw.split(/\r?\n/).find(line => line.startsWith('password='))?.slice(9); assert.ok(token);
  const get = async suffix => {
    const response = await fetch('https://api.github.com/repos/tinghui0912/NoteVerse-Pro/' + suffix, {
      headers: { Authorization: 'Bearer ' + token, 'User-Agent': 'NoteVerse-V41-audit', Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(45000) });
    assert.ok(response.ok, 'GITHUB_QUERY_FAILED'); return response.json();
  };
  const combined = await get('commits/' + head + '/status'), statuses = await get('commits/' + head + '/statuses?per_page=100');
  const workflows = await get('actions/runs?head_sha=' + head + '&per_page=100');
  return { head, queriedAt: now(), combinedState: combined.state, statuses: statuses.map(s => ({ state: s.state, context: s.context })),
    workflowRuns: workflows.workflow_runs.map(r => ({ id: r.id, status: r.status, conclusion: r.conclusion })),
    ciInterpretation: !statuses.length && !workflows.total_count ? 'NOT CI PASS' : 'ACTUAL_GITHUB_RESULTS_ONLY' };
}
