import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DIR, OUT, BRANCH, git, gitBytes, sha256, load, save, scope, scanFiles, github, remoteIdentity, BLOCKED, now } from './io.mjs';
import { CloseoutMachine } from './closeout-machine.mjs';
import { verifyFrozen } from './freeze.mjs';
import { setSensitiveValues } from './process-result.mjs';
import { evidence, safeError } from './evidence.mjs';
const input = JSON.parse(readFileSync(0, 'utf8') || '{}'), secrets = Object.values(input.auth ?? {}); setSensitiveValues(secrets);
const machine = new CloseoutMachine();
try {
  const assessment = load(OUT + '/assessment.json');
  const verified = verifyFrozen(); scope(); scanFiles([DIR, OUT], secrets); git('diff', '--check');
  git('add', '-f', '--', DIR, OUT); git('diff', '--cached', '--check');
  const staged = git('diff', '--cached', '--name-only').split('\n').filter(Boolean);
  assert.ok(staged.every(file => file === OUT + '/browser-result.json' || file === OUT + '/assessment.json' || file === OUT + '/remote-proof.json'));
  git('commit', '-m', 'research: seal V42 one-shot model delivery result'); const resultCommit = git('rev-parse', 'HEAD'); machine.move('RESULT_LOCAL_COMMITTED');
  await machine.push('RESULT', () => { git('push', 'origin', BRANCH); return 0; });
  await machine.fetch('RESULT', () => { git('fetch', 'origin', BRANCH); return 0; });
  const resultIdentity = remoteIdentity(resultCommit); machine.move('RESULT_REMOTE_VERIFIED');
  const resultGithub = await github(resultCommit); machine.move('RESULT_GITHUB_QUERIED'); machine.writeAllowed();
  save('remote-result-proof.json', evidence('REMOTE_RESULT_PROOF', { subjectCommit: resultCommit, identity: resultIdentity, github: resultGithub,
    checkedAt: now(), protectedGitObjectsVerified: verified.comparisons.length, secretScan: 'PASS', ...scope(),
    resultDisposition: assessment.disposition, serializedEvents: machine.events,
    selfReference: 'RESULT commit only; final RECEIPT commit is independently verified and emitted to stdout without another repository write' }));
  machine.move('RESULT_PROOF_WRITTEN'); scanFiles([DIR, OUT], secrets); git('add', '-f', '--', OUT + '/remote-result-proof.json');
  assert.equal(git('diff', '--cached', '--name-only'), OUT + '/remote-result-proof.json');
  git('commit', '-m', 'research: record V42 remote result receipt'); const receiptCommit = git('rev-parse', 'HEAD'); machine.move('RECEIPT_LOCAL_COMMITTED');
  await machine.push('RECEIPT', () => { git('push', 'origin', BRANCH); return 0; });
  await machine.fetch('RECEIPT', () => { git('fetch', 'origin', BRANCH); return 0; });
  const finalIdentity = remoteIdentity(receiptCommit); verifyFrozen(); const finalScope = scope(); scanFiles([DIR, OUT], secrets);
  for (const file of git('ls-tree', '-r', '--name-only', receiptCommit, '--', DIR, OUT).split('\n').filter(Boolean)) {
    assert.equal(sha256(gitBytes('show', receiptCommit + ':' + file)), sha256(readFileSync(file)));
  }
  machine.move('FINAL_REMOTE_VERIFIED'); const finalGithub = await github(receiptCommit); machine.move('FINAL_GITHUB_QUERIED'); machine.move('TERMINAL_COMPLETE');
  console.log(JSON.stringify({ state: machine.state, disposition: assessment.disposition, resultCommit, receiptCommit,
    ...finalIdentity, ...finalScope, finalGithub, secretScan: 'PASS', noTrackedWritesAfterFinalVerification: true, events: machine.events }));
} catch (error) {
  console.log(JSON.stringify({ state: 'PERMANENT_CLOSEOUT_FAILURE', disposition: BLOCKED, activeLocalGate: machine.state, orchestratorBoundary: 'NONE',
    ...safeError(error), processDiagnostic: error.processDiagnostic ?? null })); process.exitCode = 1;
}
