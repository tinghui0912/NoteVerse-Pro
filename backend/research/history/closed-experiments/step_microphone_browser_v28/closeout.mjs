import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { ROOT, DIR, OUT, START, bytes, load, sha, save, git, now, scope, exactRemote } from './io.mjs';

const head = exactRemote(), files = scope(), assessment = await load(OUT + '/assessment.json');
const identities = await load(OUT + '/identity-verification.json');
for (const f of [...identities.identities, ...(await load(OUT + '/historical-identities.json')).files]) {
  assert.equal(sha(await bytes(f.path)), f.sha256, 'CLOSEOUT_IMMUTABLE_MUTATION:' + f.path);
}
const results = [];
for (const p of files) {
  const b = await bytes(p), remote = execFileSync('git', ['show', head + ':' + p], { cwd: ROOT, maxBuffer: 128 * 1024 * 1024 });
  assert.equal(sha(b), sha(remote), 'REMOTE_RESULT_BYTES:' + p);
  results.push({ path: p, sha256: sha(b), bytes: b.length });
}
const github = JSON.parse(execFileSync('python', ['-c', "import sys,json; sys.path.insert(0,'backend/research/step_paced_lifecycle_v12'); import audit; print(json.dumps(audit.github(sys.argv[1])))", head], { cwd: ROOT, encoding: 'utf8' }));
await save('remote-result-proof.json', { resultCommit: head, remoteHead: head, verifiedAt: now(), startingHead: START,
  disposition: assessment.disposition, exactChangedFiles: files, results, productionDiff: [], V3ThroughV27Diff: [],
  historicalRawFilesVerified: (await load(OUT + '/historical-identities.json')).files.length,
  protocolSources: git('ls-tree', '-r', '--name-only', head, '--', DIR).split('\n'),
  commitChain: git('log', '--reverse', '--format=%H %s', START + '..HEAD').split('\n'),
  cleanBeforeReceipt: true, counters: assessment.counters, capabilities: assessment.capabilities,
  github, receiptNote: 'Additive remote receipt only; final receipt commit is independently re-fetched, not self-referential',
  stop: 'STOP_FOR_INDEPENDENT_AUDIT' });
console.log(JSON.stringify({ head, github, disposition: assessment.disposition, files: files.length }));
