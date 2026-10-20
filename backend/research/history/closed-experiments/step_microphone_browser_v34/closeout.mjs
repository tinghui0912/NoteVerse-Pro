import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { DIR, OUT, START, BRANCH, bytes, load, rawBytesSha256, now, save, git, scope, github, exists } from './io.mjs';
import { gitTree, gitObjectRecord, compareGitObjects, gitObjectContentRecord, verifyCommittedIndexRecord } from './git-identities.mjs';
import { verifyLocalRecord } from './identities.mjs';
import { immutable, textFormatting } from './manifest.mjs';
import { verify } from './control.mjs';
import { CloseoutMachine, serializedCloseout } from './closeout-machine.mjs';

// All Git network operations below block on execFileSync in io.git. No child is detached.
export function networkOperation(operation) {
  assert.ok(operation === 'push' || operation === 'fetch');
  const startedAt = now();
  const output = git(operation, 'origin', BRANCH);
  return { operation, exitCode: 0, startedAt, processExitedSuccessAt: now(), output, primitive: 'execFileSync', shell: false };
}
export function remoteSnapshot() {
  return { localHead: git('rev-parse', 'HEAD'), originTrackingHead: git('rev-parse', 'origin/' + BRANCH),
    lsRemoteHead: git('ls-remote', 'origin', 'refs/heads/' + BRANCH).split(/\s/)[0],
    aheadBehind: git('rev-list', '--left-right', '--count', 'HEAD...origin/' + BRANCH).split(/\s+/).map(Number),
    cleanWorktree: git('status', '--porcelain') === '', branch: git('branch', '--show-current') };
}

async function protectedEvidence(freeze, head) {
  const changed = scope(), tree = gitTree(head), protectedObjects = [];
  for (const start of freeze.startingGitObjects) protectedObjects.push(compareGitObjects(start, gitObjectRecord(start.path, head, tree)));
  const history = await exists(OUT + '/historical-identities.json') ? await load(OUT + '/historical-identities.json') : { files: [] };
  for (const f of history.files) await verifyLocalRecord(f);
  const frozenSourceChecks = freeze.indexIdentities.map(r => verifyCommittedIndexRecord(r, head));
  const committedResults = [];
  for (const p of changed) {
    const record = gitObjectContentRecord(p, head);
    assert.equal(rawBytesSha256(await bytes(p)), record.sha256, 'NEW_V34_RESULT_LOCAL_VS_COMMIT:' + p);
    committedResults.push(record);
  }
  const candidate = await immutable();
  return { at: now(), head, exactChangedFiles: changed, protectedObjects, frozenSourceChecks, committedResults,
    historicalLocalFilesVerified: history.files.length, immutableV26Artifacts: candidate.artifacts, coreDualIdentities: candidate.core,
    productionDiff: [], V3ThroughV33Diff: [], capabilities: freeze.contract.capabilities };
}

export async function closeout() {
  const machine = new CloseoutMachine(); let contract = null, browserPassed = false;
  try {
    contract = await load(DIR + '/contract.json');
    assert.equal(await exists(OUT + '/closeout-started.json'), false, 'NO_CLOSEOUT_RETRY');
    assert.equal(await exists(OUT + '/closeout-failure.json'), false, 'PERMANENT_CLOSEOUT_STOP');
    scope();
    // Failed browser/preflight campaigns may be sealed, but never promoted by closeout.
    const assessment = await load(OUT + '/assessment.json');
    browserPassed = assessment.browserAuditDisposition === contract.successDisposition && assessment.failure === null;
    const hasFreeze = await exists(OUT + '/browser-protocol-freeze.json');
    let freeze;
    if (hasFreeze && browserPassed) freeze = await verify();
    else if (hasFreeze) freeze = await load(OUT + '/browser-protocol-freeze.json');
    else freeze = { startingGitObjects: [...gitTree(START).keys()].map(p => gitObjectRecord(p, START)), indexIdentities: [], contract };
    await save('closeout-started.json', { at: now(), startingHead: START, browserPassed,
      campaignRetries: 0, closeoutRetries: 0, stateMachine: 'closeout-machine.mjs',
      finalProof: 'Result proof is committed once; final receipt verification is terminal external stdout only' });
    await textFormatting(); git('diff', '--check');
    let resultEvidence, resultIdentity, resultGitHub;
    const ports = {
      commitResult: async () => {
        machine.assertWriteAllowed(); scope();
        git('add', '-f', '--', DIR, OUT); git('diff', '--cached', '--check');
        const paths = git('diff', '--cached', '--name-only').split('\n').filter(Boolean);
        assert.ok(paths.length && paths.every(p => p.startsWith(DIR + '/') || p.startsWith(OUT + '/')));
        git('commit', '-m', 'research: seal prospective V34 browser evidence and serialized closeout');
        return git('rev-parse', 'HEAD');
      },
      push: () => networkOperation('push'),
      fetch: () => networkOperation('fetch'),
      verifyResult: async () => {
        resultEvidence = await protectedEvidence(freeze, machine.resultCommit);
        return remoteSnapshot();
      },
      github: head => github(head),
      writeResultProof: async proof => {
        machine.assertWriteAllowed(); ({ resultIdentity, resultGitHub } = proof);
        await save('remote-result-proof.json', { startingHead: START, resultCommit: machine.resultCommit, verifiedAt: now(),
          resultIdentity, github: resultGitHub, evidence: resultEvidence, serializedEventsThroughResultQuery: proof.events,
          browserAuditDisposition: assessment.browserAuditDisposition, browserPassed,
          finalDispositionAuthority: 'Terminal stdout only after RECEIPT_COMMIT remote verification and GitHub queries',
          noSelfReference: 'This proof describes RESULT_COMMIT. RECEIPT_COMMIT contains only this proof. No tracked file follows final verification.',
          productionDiff: [], V3ThroughV33Diff: [], capabilities: contract.capabilities });
      },
      commitReceipt: () => {
        machine.assertWriteAllowed();
        assert.deepEqual(git('ls-files', '--others', '--exclude-standard').split('\n').filter(Boolean), [OUT + '/remote-result-proof.json']);
        git('add', '-f', '--', OUT + '/remote-result-proof.json'); git('diff', '--cached', '--check');
        assert.deepEqual(git('diff', '--cached', '--name-only').split('\n').filter(Boolean), [OUT + '/remote-result-proof.json']);
        git('commit', '-m', 'research: record V34 RESULT_COMMIT proof in receipt-only commit');
        return git('rev-parse', 'HEAD');
      },
      verifyReceipt: async () => {
        // All protected/local identity checks finish before the terminal write barrier.
        await protectedEvidence(freeze, machine.receiptCommit);
        assert.deepEqual(git('diff', '--name-only', machine.resultCommit, machine.receiptCommit).split('\n').filter(Boolean), [OUT + '/remote-result-proof.json']);
        return remoteSnapshot();
      }
    };
    const completed = await serializedCloseout(machine, ports);
    // Terminal external output. No repository writes or commits are reachable below.
    const final = { phase: contract.phase, ...completed, ...completed.finalIdentity,
      finalGitHubStatuses: completed.finalGitHub.statuses, finalWorkflowRuns: completed.finalGitHub.workflow_runs,
      CI: completed.finalGitHub.ciInterpretation, browserPassed,
      disposition: browserPassed ? contract.successDisposition : assessment.browserAuditDisposition,
      productionDiff: [], V3ThroughV33Diff: [], capabilities: contract.capabilities, stop: 'STOP_FOR_INDEPENDENT_AUDIT' };
    console.log(JSON.stringify(final)); return final;
  } catch (error) {
    if (!machine.failure) machine.failure = { state: machine.state, at: now(), error: String(error.stack ?? error) };
    const failure = { phase: 'V34', disposition: contract?.integrityDisposition ?? 'STEP_V34_BROWSER_EXECUTION_INTEGRITY_BLOCKED',
      firstFailure: machine.failure, terminalBoundaryReached: machine.finalRemoteVerified, events: machine.events,
      noRepairOrRetry: true, noSecondPush: true, noBrowserRerun: true, browserPassed,
      note: 'Frozen failure path: before final verification preserve additive local evidence only; never retry a failed operation. After final verification stdout only.' };
    if (!machine.finalRemoteVerified && !await exists(OUT + '/closeout-failure.json')) await save('closeout-failure.json', failure);
    console.log(JSON.stringify(failure)); process.exitCode = 1; return failure;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await closeout();
