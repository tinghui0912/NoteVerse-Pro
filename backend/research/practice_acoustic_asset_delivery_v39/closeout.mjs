import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { DIR, OUT, START, BRANCH, git, load, save, scope, scanFiles, github, remoteIdentity, BLOCKED, now } from './io.mjs';
import { CloseoutMachine } from './closeout-machine.mjs';
import { verifyGitIdentities } from './identities.mjs';
import { setSensitiveValues } from './process-result.mjs';
const secrets = JSON.parse(readFileSync(0, 'utf8') || '{}').sensitive ?? [];
setSensitiveValues(secrets);
const machine = new CloseoutMachine();
try {
  const blocked = existsSync(OUT + '/first-failure.json');
  let assessment;
  if (existsSync(OUT + '/assessment.json')) assessment = load(OUT + '/assessment.json');
  else {
    assert.equal(blocked, true, 'NO_TERMINAL_RESULT');
    const contract = load(DIR + '/contract.json');
    assessment = { disposition: BLOCKED, firstFailure: load(OUT + '/first-failure.json'),
      historicalStatements: contract.historicalStatements, capabilities: contract.capabilities, disclaimers: contract.disclaimers,
      browserLaunches: 0, authenticatedModelAccessRequests: 0, ossGets: 0, modelSessions: 0, inferenceRuns: 0,
      protocolFreezeCreated: existsSync(OUT + '/delivery-protocol-freeze.json'),
      remoteAuthorizationCreated: existsSync(OUT + '/remote-delivery-authorization.json'),
      noRetry: true, productionDefectEstablished: false, ...scope() };
    save('assessment.json', assessment);
  }
  const finalScope = scope();
  if (existsSync(OUT + '/delivery-protocol-freeze.json')) {
    const freeze = load(OUT + '/delivery-protocol-freeze.json'); verifyGitIdentities(freeze.protectedGitObjects, 'HEAD');
    for (const record of freeze.indexIdentities) assert.equal(git('rev-parse', 'HEAD:' + record.subject), git('rev-parse', ':' + record.subject));
  }
  save('closeout-precommit.json', { at: now(), startingHead: START, ...finalScope,
    security: scanFiles([DIR, OUT], secrets), capabilitiesUnchanged: true });
  scanFiles([DIR, OUT], secrets); git('diff', '--check'); git('add', '-f', '--', DIR, OUT); git('diff', '--cached', '--check');
  git('commit', '-m', 'research: seal prospective V39 model asset delivery result');
  const resultCommit = git('rev-parse', 'HEAD'); machine.move('RESULT_LOCAL_COMMITTED');
  await machine.push('RESULT', () => { git('push', 'origin', BRANCH); return 0; });
  await machine.fetch('RESULT', () => { git('fetch', 'origin', BRANCH); return 0; });
  const resultRemote = remoteIdentity(resultCommit); scope(); machine.move('RESULT_REMOTE_VERIFIED');
  const resultGithub = await github(resultCommit); machine.move('RESULT_GITHUB_QUERIED');
  machine.writeAllowed();
  save('remote-result-proof.json', { resultCommit, remotelyVerifiedAt: now(), resultRemote, resultGithub,
    serializedEvents: machine.events, productionDiff: [], V3ThroughV38Diff: [], disposition: assessment.disposition,
    selfReference: 'This proof describes RESULT_COMMIT only; final RECEIPT verification is terminal stdout only' });
  machine.move('RESULT_PROOF_WRITTEN'); scanFiles([DIR, OUT], secrets);
  git('add', '-f', '--', OUT + '/remote-result-proof.json');
  assert.equal(git('diff', '--cached', '--name-only'), OUT + '/remote-result-proof.json');
  git('commit', '-m', 'research: record V39 serialized remote result receipt');
  const receiptCommit = git('rev-parse', 'HEAD'); machine.move('RECEIPT_LOCAL_COMMITTED');
  await machine.push('RECEIPT', () => { git('push', 'origin', BRANCH); return 0; });
  await machine.fetch('RECEIPT', () => { git('fetch', 'origin', BRANCH); return 0; });
  const finalRemote = remoteIdentity(receiptCommit); scope(); scanFiles([DIR, OUT], secrets);
  if (existsSync(OUT + '/delivery-protocol-freeze.json')) verifyGitIdentities(load(OUT + '/delivery-protocol-freeze.json').protectedGitObjects, receiptCommit);
  machine.move('FINAL_REMOTE_VERIFIED');
  const finalGithub = await github(receiptCommit); machine.move('FINAL_GITHUB_QUERIED'); machine.move('TERMINAL_COMPLETE');
  console.log(JSON.stringify({ state: machine.state, disposition: assessment.disposition, resultCommit, receiptCommit,
    ...finalRemote, productionDiff: [], V3ThroughV38Diff: [], capabilitiesUnchanged: true,
    secretScan: 'PASS', finalGithub, serializedEvents: machine.events, noTrackedWritesAfterFinalVerification: true }));
} catch (error) {
  console.log(JSON.stringify({ state: 'PERMANENT_CLOSEOUT_FAILURE', disposition: BLOCKED, at: now(),
    firstFailedState: machine.state, errorClass: error.name, processDiagnostic: error.processDiagnostic ?? null,
    unsafeErrorOmitted: true, noRetry: true }));
  process.exitCode = 1;
}
