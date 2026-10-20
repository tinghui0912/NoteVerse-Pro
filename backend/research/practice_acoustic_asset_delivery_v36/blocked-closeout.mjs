import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { ROOT, DIR, OUT, START, BRANCH, bytes, load, rawBytesSha256, now, save, git, scope, github, exists } from './io.mjs';
import { gitTree, gitObjectRecord, compareGitObjects, gitObjectContentRecord } from './git-identities.mjs';
import { verifyWorktreeMaterialization, verifyLocalRecord } from './identities.mjs';
import { CloseoutMachine, serializedCloseout } from './closeout-machine.mjs';
import { securitySelfTests, scanNewFiles } from './security.mjs';

const BLOCKED = 'PRACTICE_ACOUSTIC_V36_MODEL_ASSET_DELIVERY_EXECUTION_INTEGRITY_BLOCKED';
const machine = new CloseoutMachine(), dirs = [DIR, OUT];
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
    assert.ok(!text.includes('\r') && text.endsWith('\n') && !text.endsWith('\n\n'), 'V36_DETERMINISTIC_TEXT');
    assert.ok(text.split('\n').every(line => !/[\t ]+$/.test(line)), 'V36_TRAILING_WHITESPACE');
  }
}

try {
  assert.equal(await exists(OUT + '/blocked-closeout-started.json'), false, 'NO_CLOSEOUT_RETRY');
  assert.equal(git('rev-parse', 'HEAD'), START);
  const failure = await load(OUT + '/first-failure.json');
  assert.equal(failure.disposition, BLOCKED, 'ONLY_SEALS_ALREADY_TERMINATED_SOURCE_DISCOVERY');
  scope();
  await save('blocked-closeout-started.json', { at: now(), qualificationPermanentlyStopped: true, closeoutOnly: true,
    retries: 0, deliveryEndpointRequestsAuthorized: false, subsequentOperations: 'Sanitized immutable failure evidence and serialized Git closure only' });
  const securityTests = securitySelfTests();
  // Git plumbing here establishes closeout immutability only. It does not retry the failed source-discovery gate,
  // validate its missing-path assertion, read production source contents, or authorize any qualification.
  const tree = gitTree(START), protectedObjects = [...tree.keys()].sort().map(p => gitObjectRecord(p, START, tree));
  const history = [];
  for (const p of tree.keys()) if (p.startsWith('backend/research/')) history.push(await verifyWorktreeMaterialization(p));
  await save('closeout-history-identities.json', { startingHead: START, purpose: 'Closeout immutability only; qualification source discovery not retried',
    protectedGitObjects: protectedObjects, historicalLocalMaterializations: history, productionDiff: [], V3ThroughV35Diff: [] });
  const assessment = {
    phase: 'V36', objective: 'PRODUCTION PRACTICE ACOUSTIC MODEL ASSET DELIVERY — AUTHENTICATED SAME-ORIGIN ACCESS, REAL OSS SIGNED GET, OPFS INTEGRITY, WARM CACHE REUSE',
    disposition: BLOCKED, firstFailure: failure, firstFailureArtifact: 'first-failure.json', startingHead: START,
    exactStartingGateVerified: true,
    historicalStatements: ['V34 BROWSER CORE QUALIFICATION REMAINS ESTABLISHED', 'V35 WAS NOT REPAIRED', 'V35 WAS NOT RETRIED',
      'V35 DELIVERY QUALIFICATION WAS NOT ESTABLISHED', 'V36 IS A NEW PROSPECTIVE ASSET-DELIVERY PHASE'],
    historicalV34Disposition: 'STEP_V34_BROWSER_CORE_GRAPH_CONTEXT_INTERRUPTION_AND_INFERENCE_LIFECYCLE_ACCOUNTING_ESTABLISHED_ROOT_LOSS_NOT_EVALUATED_CAPABILITY_CLOSED',
    historicalV35Disposition: 'PRACTICE_ACOUSTIC_V35_MODEL_ASSET_DELIVERY_EXECUTION_INTEGRITY_BLOCKED',
    historicalReceiptsUsedAsDeliveryEvidence: false,
    sourceDiscovery: 'FAILED_TOOLING_COMPLETENESS_GATE_NOT_RETRIED', productionSourceAbsenceEstablished: false, productionDefectEstablished: false,
    originProtocol: { authority: 'USER_SUPPLIED_V36_PROTOCOL_NOT_EXECUTED_SOURCE_PROOF', apiBase: '/api/v1', browserAuthority: 'CUSTOMER_WEB_ORIGIN',
      backendOrigin: 'Server-side rewrite infrastructure only; not required as a browser-visible endpoint', dualBrowserOriginRequirement: false,
      targetMustBeExplicitlySupplied: true, noTargetDiscoveryPerformed: true },
    suppliedOriginAndAuthValidation: 'NOT_REACHED_AFTER_PERMANENT_SOURCE_DISCOVERY_STOP',
    noCredentialFilesRead: true, noEnvironmentFilesModified: true,
    descriptor: { schemaVersion: 1, assetId: 'practice-acoustic-robust-browser', assetVersion: 'v1', expectedByteSize: 98689283,
      sha256: '4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3', mediaType: 'application/octet-stream' },
    objectStorageIdentity: 'models/continuous/robust-browser-v1/4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3/model.onnx',
    cells: [{ id: 'authenticated-cold-network-delivery', status: 'NOT_STARTED' }, { id: 'authenticated-warm-opfs-cache', status: 'NOT_STARTED' }],
    counts: { authenticatedAccessRequests: 0, unauthenticatedAccessRequests: 0, signedUrlsCreated: 0, ossModelGets: 0, modelDownloadBytes: 0,
      browserCampaigns: 0, browserLaunches: 0, modelSessions: 0, inferenceRuns: 0, decoderRuns: 0, microphoneCaptureRuns: 0, productVerdictRuns: 0, freshHoldoutAccess: 0 },
    protocolFreezeCreated: false, remoteDeliveryAuthorizationCreated: false,
    deliveryQualificationTests: 'NOT_RUN_AFTER_EARLY_PERMANENT_TOOLING_STOP', securityTests,
    securityPolicy: 'All new sources/reports scanned before every commit. No auth, signed URL, email, cookie or credential value in evidence. Security-only process-environment inspection is not qualification input validation.',
    noDependencyOverrides: true, noSyntheticDescriptors: true, noFallbackSource: true, noAuthenticationBypass: true,
    deliveryBoundaryQualified: false, coldDownloadQualified: false, warmCacheQualified: false, sessionAcceptanceQualified: false,
    productionDiff: [], V3ThroughV35Diff: [],
    capabilities: { Continuous: 'MODEL_NOT_VALIDATED', STEP: 'ATTEMPT_ANALYZER_NOT_VALIDATED', productionMicrophone: false, D4: false },
    disclaimers: ['REAL_PHYSICAL_MICROPHONE_DEVICE_NOT_QUALIFIED', 'MICROPHONE_PERMISSION_UX_NOT_QUALIFIED',
      'PHYSICAL_MICROPHONE_UX_LATENCY_NOT_QUALIFIED', 'FRESH_ACOUSTIC_RECOGNITION_QUALIFICATION_NOT_PERFORMED', 'ROOT_SOURCE_LOSS_NOT_EVALUATED'],
    noRepairOrRetry: true, localChecksAreNotGitHubCI: true, stop: 'STOP_FOR_INDEPENDENT_AUDIT'
  };
  await save('assessment.json', assessment);
  await save('assessment.md', '# V36 Asset Delivery\n\n' + BLOCKED + '\n\n' + assessment.historicalStatements.join('\n\n') + '\n\n' +
    'V36 stopped pre-freeze at source-discovery tooling. The outer helper treated a terminal response capped at 30,000 tokens as a complete Git tree. The retained response reports 64,240 original tokens, 34,240 omitted, and only 2,116 returned lines. Three required paths were missing from that incomplete representation, causing REQUIRED_SOURCE_ABSENT. Actual production-file absence was not established. This is research tooling failure, not a production defect.\n\n' +
    'The failed inventory was not retried. No production source content, credential file, auth session, target origin, endpoint, signed URL or OSS object was inspected/executed for qualification after the stop. Both delivery cells remain NOT_STARTED. All browser/model/delivery execution counters are zero; no freeze or delivery authorization exists.\n\n' +
    'The V36 same-origin protocol does not require a separate browser backend origin. Origin/auth validation was never reached and is not asserted missing. Production, V3-V35, current model defaults and capabilities remain unchanged. V34 qualification remains accepted; V35 remains blocked.\n\n' +
    'Only additive failure evidence, secret scans and synchronous serialized Git closeout followed. Final receipt verification emits stdout only; no tracked write follows terminal verification. Local checks are not GitHub CI. STOP for independent audit.\n');
  await save('precommit-security-scan.json', { at: now(), ...await safeScan(), securityTests });
  await formatting(); git('diff', '--check');
  let resultScan, receiptScan, resultEvidence;
  const protectedChecks = async head => {
    scope(); const currentTree = gitTree(head);
    const comparisons = protectedObjects.map(p => compareGitObjects(p, gitObjectRecord(p.path, head, currentTree)));
    for (const f of history) await verifyLocalRecord(f);
    const newFiles = [];
    for (const p of scope()) {
      const record = gitObjectContentRecord(p, head); assert.equal(record.sha256, rawBytesSha256(await bytes(p))); newFiles.push(record);
    }
    return { comparisons, newFiles, productionDiff: [], V3ThroughV35Diff: [], capabilities: assessment.capabilities };
  };
  const completed = await serializedCloseout(machine, {
    commitResult: async () => {
      machine.assertWriteAllowed(); resultScan = await safeScan(); scope();
      git('add', '-f', '--', DIR, OUT); git('diff', '--cached', '--check');
      assert.ok(git('diff', '--cached', '--name-only').split('\n').every(p => p.startsWith(DIR + '/') || p.startsWith(OUT + '/')));
      git('commit', '-m', 'research: seal V36 pre-freeze source-discovery integrity block'); return git('rev-parse', 'HEAD');
    },
    push: () => network('push'), fetch: () => network('fetch'),
    verifyResult: async () => { resultEvidence = await protectedChecks(machine.resultCommit); return remote(); },
    github,
    writeResultProof: async proof => {
      machine.assertWriteAllowed();
      await save('remote-result-proof.json', { at: now(), startingHead: START, resultCommit: machine.resultCommit, ...proof,
        resultEvidence, resultSecretScan: resultScan, disposition: BLOCKED, finalAuthority: 'Terminal receipt-commit stdout only; no self-reference commit',
        productionDiff: [], V3ThroughV35Diff: [], capabilities: assessment.capabilities });
    },
    commitReceipt: async () => {
      machine.assertWriteAllowed(); receiptScan = await safeScan();
      assert.deepEqual(git('ls-files', '--others', '--exclude-standard').split('\n').filter(Boolean), [OUT + '/remote-result-proof.json']);
      git('add', '-f', '--', OUT + '/remote-result-proof.json'); git('diff', '--cached', '--check');
      assert.deepEqual(git('diff', '--cached', '--name-only').split('\n').filter(Boolean), [OUT + '/remote-result-proof.json']);
      git('commit', '-m', 'research: record V36 blocked result remote proof'); return git('rev-parse', 'HEAD');
    },
    verifyReceipt: async () => {
      await protectedChecks(machine.receiptCommit); await safeScan();
      assert.deepEqual(git('diff', '--name-only', machine.resultCommit, machine.receiptCommit).split('\n').filter(Boolean), [OUT + '/remote-result-proof.json']);
      return remote();
    }
  });
  console.log(JSON.stringify({ phase: 'V36', disposition: BLOCKED, ...completed, ...completed.finalIdentity,
    counts: assessment.counts, resultSecretScan: resultScan.result, receiptSecretScan: receiptScan.result,
    CI: completed.finalGitHub.ciInterpretation, productionDiff: [], V3ThroughV35Diff: [], capabilities: assessment.capabilities,
    historicalStatements: assessment.historicalStatements, stop: 'STOP_FOR_INDEPENDENT_AUDIT' }));
} catch (error) {
  const safe = { disposition: BLOCKED, closeoutFailure: { state: machine.state, at: now(), errorClass: error?.name ?? 'Error',
    messageOmittedToPreventSecretExposure: true }, noRepairOrRetry: true, terminalBoundaryReached: machine.finalRemoteVerified };
  if (!machine.finalRemoteVerified && !await exists(OUT + '/closeout-failure.json')) await save('closeout-failure.json', safe);
  console.log(JSON.stringify(safe)); process.exitCode = 1;
}
