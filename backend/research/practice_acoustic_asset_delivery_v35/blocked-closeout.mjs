import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { ROOT, DIR, OUT, START, BRANCH, bytes, load, rawBytesSha256, now, save, git, scope, github, exists } from './io.mjs';
import { gitTree, gitObjectRecord, compareGitObjects, gitObjectContentRecord } from './git-identities.mjs';
import { verifyWorktreeMaterialization, verifyLocalRecord } from './identities.mjs';
import { CloseoutMachine, serializedCloseout } from './closeout-machine.mjs';
import { securitySelfTests, scanNewFiles } from './security.mjs';

const BLOCKED = 'PRACTICE_ACOUSTIC_V35_MODEL_ASSET_DELIVERY_EXECUTION_INTEGRITY_BLOCKED';
const machine = new CloseoutMachine();
const dirs = [DIR, OUT];
const network = operation => {
  assert.ok(operation === 'push' || operation === 'fetch'); const startedAt = now();
  const output = git(operation, 'origin', BRANCH);
  return { operation, exitCode: 0, startedAt, processExitedSuccessAt: now(), primitive: 'execFileSync', shell: false, output };
};
const remote = () => ({ localHead: git('rev-parse', 'HEAD'), originTrackingHead: git('rev-parse', 'origin/' + BRANCH),
  lsRemoteHead: git('ls-remote', 'origin', 'refs/heads/' + BRANCH).split(/\s/)[0],
  aheadBehind: git('rev-list', '--left-right', '--count', 'HEAD...origin/' + BRANCH).split(/\s+/).map(Number), cleanWorktree: git('status', '--porcelain') === '' });
async function safeScan() {
  const result = await scanNewFiles(ROOT, dirs);
  assert.equal(result.result, 'PASS', 'SECRET_SCAN_BLOCKED_DO_NOT_COMMIT_UNSAFE_OUTPUT'); return result;
}
async function formatting() {
  for (const dir of dirs) for (const name of await readdir(dir)) {
    const text = (await bytes(dir + '/' + name)).toString();
    assert.ok(!text.includes('\r') && text.endsWith('\n') && !text.endsWith('\n\n'), 'V35_DETERMINISTIC_TEXT');
    assert.ok(text.split('\n').every(line => !/[\t ]+$/.test(line)), 'V35_TRAILING_WHITESPACE');
  }
}

try {
  assert.equal(await exists(OUT + '/blocked-closeout-started.json'), false, 'NO_CLOSEOUT_RETRY');
  assert.equal(git('rev-parse', 'HEAD'), START);
  const environment = await load(OUT + '/environment-availability.json');
  assert.equal(environment.disposition, BLOCKED, 'THIS_HELPER_ONLY_SEALS_THE_ALREADY_TERMINATED_ENVIRONMENT_CHECK');
  scope();
  await save('blocked-closeout-started.json', { at: now(), qualificationPermanentlyStopped: true, closeoutOnly: true,
    deliveryCampaignRetries: 0, endpointRequestsAuthorized: false, subsequentOperations: 'Sanitized evidence and serialized Git closure only' });
  const securityTests = securitySelfTests();
  const tree = gitTree(START), protectedObjects = [...tree.keys()].sort().map(p => gitObjectRecord(p, START, tree));
  const history = [];
  for (const p of tree.keys()) if (p.startsWith('backend/research/')) history.push(await verifyWorktreeMaterialization(p));
  const sources = [];
  for (const p of environment.requiredPaths) {
    assert.ok(tree.has(p));
    sources.push({ git: gitObjectRecord(p, START, tree), localMaterialization: await verifyWorktreeMaterialization(p) });
  }
  await save('source-and-history-identities.json', { startingHead: START, requiredSourceIdentities: sources,
    protectedGitObjects: protectedObjects, historicalLocalMaterializations: history, productionDiff: [], V3ThroughV34Diff: [] });
  const assessment = {
    phase: 'V35', objective: 'PRODUCTION PRACTICE ACOUSTIC MODEL ASSET DELIVERY — AUTHENTICATED ACCESS, REAL OSS SIGNED GET, BROWSER OPFS VERIFICATION AND CACHE REUSE',
    disposition: BLOCKED, stoppedAt: environment.observedAt, firstFailure: 'REQUIRED_REAL_DELIVERY_ENVIRONMENT_NOT_ESTABLISHED',
    firstFailureArtifact: 'environment-availability.json',
    cause: 'No supplied legitimate test-account login/browser-session material and no explicitly identified backend/customer-web origins were available to the prospective tooling. A local credential pair was nonempty, but no credential, backend, user session, origin, OSS authority or production environment was validated by network execution.',
    startingHead: START, exactStartingGateVerified: true,
    historicalStatements: ['V34 BROWSER CORE QUALIFICATION IS ESTABLISHED', 'V35 IS A NEW PROSPECTIVE ASSET-DELIVERY PHASE', 'V34 WAS NOT RERUN OR REINTERPRETED'],
    acceptedHistoricalV34Disposition: 'STEP_V34_BROWSER_CORE_GRAPH_CONTEXT_INTERRUPTION_AND_INFERENCE_LIFECYCLE_ACCOUNTING_ESTABLISHED_ROOT_LOSS_NOT_EVALUATED_CAPABILITY_CLOSED',
    historicalV26ThroughV33DispositionsUnchanged: true, historicalBrowserReceiptsUsedAsDeliveryEvidence: false,
    productionDefectEstablished: false,
    descriptor: { schemaVersion: 1, assetId: 'practice-acoustic-robust-browser', assetVersion: 'v1', expectedByteSize: 98689283,
      sha256: '4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3', mediaType: 'application/octet-stream' },
    objectStorageIdentity: 'models/continuous/robust-browser-v1/4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3/model.onnx',
    cells: [{ id: 'authenticated-cold-network-delivery', status: 'NOT_STARTED' }, { id: 'authenticated-warm-opfs-cache', status: 'NOT_STARTED' }],
    counts: { authenticatedAccessRequests: 0, signedUrlsCreated: 0, ossModelGets: 0, modelDownloadBytes: 0, browserCampaigns: 0,
      browserLaunches: 0, modelSessions: 0, inferenceRuns: 0, decoderRuns: 0, microphoneCaptureRuns: 0, productVerdictRuns: 0, freshHoldoutAccess: 0 },
    protocolFreezeCreated: false, remoteDeliveryAuthorizationCreated: false,
    deliveryQualificationTests: 'NOT_RUN_AFTER_EARLY_PERMANENT_ENVIRONMENT_STOP',
    securityTests, localTestsAreNotGitHubCI: true,
    securityPolicy: 'All secrets remain in memory; evidence contains only booleans, public source/storage identities and sanitized metadata. Mandatory full new-file scans before both commits.',
    deliveryBoundaryQualified: false, coldDownloadQualified: false, warmCacheQualified: false, sessionAcceptanceQualified: false,
    noDependencyOverrides: true, noSyntheticDescriptors: true, noFallbackModelSource: true, noAuthenticationBypass: true,
    productionDiff: [], V3ThroughV34Diff: [],
    capabilities: { Continuous: 'MODEL_NOT_VALIDATED', STEP: 'ATTEMPT_ANALYZER_NOT_VALIDATED', productionMicrophone: false, D4: false },
    disclaimers: ['REAL_PHYSICAL_MICROPHONE_DEVICE_NOT_QUALIFIED', 'MICROPHONE_PERMISSION_UX_NOT_QUALIFIED',
      'PHYSICAL_MICROPHONE_UX_LATENCY_NOT_QUALIFIED', 'FRESH_ACOUSTIC_RECOGNITION_QUALIFICATION_NOT_PERFORMED', 'ROOT_SOURCE_LOSS_NOT_EVALUATED'],
    noRepairOrRetry: true, noProductionOrHistoricalModification: true, stop: 'STOP_FOR_INDEPENDENT_AUDIT'
  };
  await save('assessment.json', assessment);
  await save('assessment.md', '# V35 Asset Delivery\n\n' + BLOCKED + '\n\n' +
    'V34 BROWSER CORE QUALIFICATION IS ESTABLISHED\n\n' +
    'V35 stopped pre-freeze at real-environment availability. No legitimate test login/browser session or explicitly identified backend/customer-web origins were supplied. Local OSS credential material was nonempty but unvalidated; no values were logged. This is not a production defect.\n\n' +
    'Both delivery cells are NOT_STARTED. No backend signed-access request, signing operation, OSS GET, browser campaign, session creation, inference, decoder, microphone capture or fresh holdout access occurred. No protocol freeze or delivery authorization exists. No qualification tests were executed after the permanent stop.\n\n' +
    'Production and V3-V34 history are unchanged. Capabilities remain closed. The unchanged production code was read as source only; static inspection is not delivery qualification. V34 browser evidence was not reused as V35 evidence.\n\n' +
    'The additive failure evidence is secret-scanned before result and receipt commits. Closeout uses synchronous push completion barriers. Final remote verification and GitHub queries emit terminal stdout only, with no tracked write afterward. Local checks are not CI. STOP for independent audit.\n');
  await save('precommit-security-scan.json', { at: now(), ...await safeScan(), securityTests });
  await formatting(); git('diff', '--check');
  let resultScan, receiptScan;
  const protectedChecks = async head => {
    scope(); const currentTree = gitTree(head);
    const comparisons = protectedObjects.map(p => compareGitObjects(p, gitObjectRecord(p.path, head, currentTree)));
    for (const f of history) await verifyLocalRecord(f);
    const newFiles = [];
    for (const p of scope()) {
      const record = gitObjectContentRecord(p, head); assert.equal(record.sha256, rawBytesSha256(await bytes(p))); newFiles.push(record);
    }
    return { comparisons, newFiles, productionDiff: [], V3ThroughV34Diff: [], capabilities: assessment.capabilities };
  };
  let resultEvidence;
  const completed = await serializedCloseout(machine, {
    commitResult: async () => {
      machine.assertWriteAllowed(); resultScan = await safeScan(); scope();
      git('add', '-f', '--', DIR, OUT); git('diff', '--cached', '--check');
      assert.ok(git('diff', '--cached', '--name-only').split('\n').every(p => p.startsWith(DIR + '/') || p.startsWith(OUT + '/')));
      git('commit', '-m', 'research: seal V35 pre-freeze delivery environment integrity block'); return git('rev-parse', 'HEAD');
    },
    push: () => network('push'), fetch: () => network('fetch'),
    verifyResult: async () => { resultEvidence = await protectedChecks(machine.resultCommit); return remote(); },
    github,
    writeResultProof: async proof => {
      machine.assertWriteAllowed();
      await save('remote-result-proof.json', { at: now(), startingHead: START, resultCommit: machine.resultCommit, ...proof,
        resultEvidence, resultSecretScan: resultScan, disposition: BLOCKED, finalAuthority: 'Terminal receipt-commit stdout only; no self-reference commit',
        productionDiff: [], V3ThroughV34Diff: [], capabilities: assessment.capabilities });
    },
    commitReceipt: async () => {
      machine.assertWriteAllowed(); receiptScan = await safeScan();
      assert.deepEqual(git('ls-files', '--others', '--exclude-standard').split('\n').filter(Boolean), [OUT + '/remote-result-proof.json']);
      git('add', '-f', '--', OUT + '/remote-result-proof.json'); git('diff', '--cached', '--check');
      assert.deepEqual(git('diff', '--cached', '--name-only').split('\n').filter(Boolean), [OUT + '/remote-result-proof.json']);
      git('commit', '-m', 'research: record V35 blocked result remote proof'); return git('rev-parse', 'HEAD');
    },
    verifyReceipt: async () => {
      await protectedChecks(machine.receiptCommit); await safeScan();
      assert.deepEqual(git('diff', '--name-only', machine.resultCommit, machine.receiptCommit).split('\n').filter(Boolean), [OUT + '/remote-result-proof.json']);
      return remote();
    }
  });
  console.log(JSON.stringify({ phase: 'V35', disposition: BLOCKED, ...completed, ...completed.finalIdentity,
    counts: assessment.counts, securityTests, resultSecretScan: resultScan.result, receiptSecretScan: receiptScan.result,
    CI: completed.finalGitHub.ciInterpretation, productionDiff: [], V3ThroughV34Diff: [], capabilities: assessment.capabilities,
    historicalStatement: 'V34 BROWSER CORE QUALIFICATION IS ESTABLISHED', stop: 'STOP_FOR_INDEPENDENT_AUDIT' }));
} catch (error) {
  const safe = { disposition: BLOCKED, closeoutFailure: { state: machine.state, at: now(), errorClass: error?.name ?? 'Error',
    messageOmittedToPreventSecretExposure: true }, noRepairOrRetry: true, terminalBoundaryReached: machine.finalRemoteVerified };
  if (!machine.finalRemoteVerified && !await exists(OUT + '/closeout-failure.json')) await save('closeout-failure.json', safe);
  console.log(JSON.stringify(safe)); process.exitCode = 1;
}
