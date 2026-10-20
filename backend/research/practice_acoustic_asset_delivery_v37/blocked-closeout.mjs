import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { ROOT, DIR, OUT, START, BRANCH, bytes, load, rawBytesSha256, now, save, git, scope, github, exists } from './io.mjs';
import { gitTree, gitObjectRecord, compareGitObjects, gitObjectContentRecord } from './git-identities.mjs';
import { verifyWorktreeMaterialization, verifyLocalRecord } from './identities.mjs';
import { CloseoutMachine, serializedCloseout } from './closeout-machine.mjs';
import { securitySelfTests, scanNewFiles } from './security.mjs';

const BLOCKED = 'PRACTICE_ACOUSTIC_V37_MODEL_ASSET_DELIVERY_EXECUTION_INTEGRITY_BLOCKED';
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
    assert.ok(!text.includes('\r') && text.endsWith('\n') && !text.endsWith('\n\n'), 'V37_DETERMINISTIC_TEXT');
    assert.ok(text.split('\n').every(line => !/[\t ]+$/.test(line)), 'V37_TRAILING_WHITESPACE');
  }
}
const digestRecords = records => rawBytesSha256(Buffer.from(JSON.stringify(records)));

try {
  assert.equal(await exists(OUT + '/blocked-closeout-started.json'), false, 'NO_CLOSEOUT_RETRY');
  assert.equal(git('rev-parse', 'HEAD'), START);
  const failure = await load(OUT + '/first-failure.json');
  assert.equal(failure.disposition, BLOCKED, 'ONLY_SEALS_ALREADY_TERMINATED_PREFLIGHT'); scope();
  await save('blocked-closeout-started.json', { at: now(), qualificationPermanentlyStopped: true, closeoutOnly: true,
    retries: 0, deliveryEndpointRequestsAuthorized: false, subsequentOperations: 'Sanitized immutable failure evidence and serialized Git closure only' });
  const securityTests = securitySelfTests();
  // Full tree and local history are consumed internally from raw process/file bytes for closeout immutability.
  // Only compact digests/counts and required-path records are persisted, never a full rendered inventory.
  const tree = gitTree(START), protectedObjects = [...tree.keys()].sort().map(p => gitObjectRecord(p, START, tree));
  const protectedIdentity = protectedObjects.map(p => [p.path, p.gitObject, p.mode]);
  const history = [];
  for (const p of [...tree.keys()].sort()) if (p.startsWith('backend/research/')) history.push(await verifyWorktreeMaterialization(p));
  const historyIdentity = history.map(r => [r.path, r.sha256, r.bytes]);
  const compactStart = { startingHead: START, protectedObjectCount: protectedObjects.length,
    protectedGitIdentityListSha256: digestRecords(protectedIdentity), historicalLocalFileCount: history.length,
    historicalMaterializationIdentityListSha256: digestRecords(historyIdentity),
    inputAuthority: 'DIRECT_CHILD_PROCESS_BYTES_AND_EXACT_LOCAL_FILE_BYTES', completePathListsPersisted: false,
    productionDiff: [], V3ThroughV36Diff: [] };
  await save('closeout-immutability-summary.json', compactStart);
  const discovery = await load(OUT + '/required-path-identities.json');
  const discoveryUnitTests = await load(OUT + '/discovery-unit-tests.json');
  const assessment = {
    phase: 'V37', objective: 'PRODUCTION PRACTICE ACOUSTIC MODEL ASSET DELIVERY — AUTHENTICATED SAME-ORIGIN ACCESS, REAL OSS SIGNED GET, OPFS INTEGRITY, WARM CACHE REUSE',
    disposition: BLOCKED, firstFailure: failure, firstFailureArtifact: 'first-failure.json', startingHead: START,
    exactStartingGateVerified: true,
    historicalStatements: ['V34 BROWSER CORE QUALIFICATION REMAINS ESTABLISHED', 'V35 WAS NOT REPAIRED', 'V35 WAS NOT RETRIED',
      'V35 DELIVERY QUALIFICATION WAS NOT ESTABLISHED', 'V36 WAS NOT REPAIRED', 'V36 WAS NOT RETRIED',
      'V36 DELIVERY QUALIFICATION WAS NOT ESTABLISHED', 'V37 IS A NEW PROSPECTIVE ASSET-DELIVERY PHASE'],
    historicalV34Disposition: 'STEP_V34_BROWSER_CORE_GRAPH_CONTEXT_INTERRUPTION_AND_INFERENCE_LIFECYCLE_ACCOUNTING_ESTABLISHED_ROOT_LOSS_NOT_EVALUATED_CAPABILITY_CLOSED',
    historicalV35Disposition: 'PRACTICE_ACOUSTIC_V35_MODEL_ASSET_DELIVERY_EXECUTION_INTEGRITY_BLOCKED',
    historicalV36Disposition: 'PRACTICE_ACOUSTIC_V36_MODEL_ASSET_DELIVERY_EXECUTION_INTEGRITY_BLOCKED',
    historicalReceiptsUsedAsDeliveryEvidence: false, productionSourceAbsenceEstablished: false, productionDefectEstablished: false,
    sourceDiscovery: { result: 'PASS', requiredPathCount: discovery.requiredPathCount, records: discovery.records,
      testsPassed: discoveryUnitTests.tests.length, unitTestAuthority: 'Synthetic tests only, not browser delivery qualification',
      invariant: 'NO_QUALIFICATION_GATE_DEPENDS_ON_TRUNCATABLE_DISPLAY_OUTPUT',
      inputSourceWitness: failure.completedGates, fullInventorySummary: await load(OUT + '/internal-inventory-summary.json'),
      noDisplayedInventoryAuthority: true },
    environment: failure.environment,
    cause: 'Explicit V37 customer-web origin and legitimate auth mechanism were not supplied. Environment availability stop only, not a production defect. No domain discovery, credential fallback or network validation was attempted.',
    originProtocol: { apiBase: '/api/v1', browserAuthority: 'CUSTOMER_WEB_ORIGIN',
      backendOrigin: 'Server-side rewrite infrastructure only; not required as a browser-visible endpoint', dualBrowserOriginRequirement: false },
    noCredentialFilesRead: true, noEnvironmentFilesModified: true,
    descriptor: { schemaVersion: 1, assetId: 'practice-acoustic-robust-browser', assetVersion: 'v1', expectedByteSize: 98689283,
      sha256: '4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3', mediaType: 'application/octet-stream' },
    objectStorageIdentity: 'models/continuous/robust-browser-v1/4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3/model.onnx',
    cells: [{ id: 'authenticated-cold-network-delivery', status: 'NOT_STARTED' }, { id: 'authenticated-warm-opfs-cache', status: 'NOT_STARTED' }],
    counts: { authenticatedAccessRequests: 0, unauthenticatedAccessRequests: 0, signedUrlsCreated: 0, ossModelGets: 0, modelDownloadBytes: 0,
      browserCampaigns: 0, browserLaunches: 0, modelSessions: 0, inferenceRuns: 0, decoderRuns: 0, microphoneCaptureRuns: 0, productVerdictRuns: 0, freshHoldoutAccess: 0 },
    protocolFreezeCreated: false, remoteDeliveryAuthorizationCreated: false,
    remainingDeliveryQualificationTests: 'NOT_RUN_AFTER_PERMANENT_ENVIRONMENT_STOP', securityTests,
    securityPolicy: 'Every new file is scanned before each commit; credentials, emails, cookies and signed URL values never enter reports. Only security containment reads of process-environment sensitive values occur after the stop, never auth retry.',
    noDependencyOverrides: true, noSyntheticDescriptors: true, noFallbackSource: true, noAuthenticationBypass: true,
    deliveryBoundaryQualified: false, coldDownloadQualified: false, warmCacheQualified: false, sessionAcceptanceQualified: false,
    productionDiff: [], V3ThroughV36Diff: [],
    capabilities: { Continuous: 'MODEL_NOT_VALIDATED', STEP: 'ATTEMPT_ANALYZER_NOT_VALIDATED', productionMicrophone: false, D4: false },
    disclaimers: ['REAL_PHYSICAL_MICROPHONE_DEVICE_NOT_QUALIFIED', 'MICROPHONE_PERMISSION_UX_NOT_QUALIFIED',
      'PHYSICAL_MICROPHONE_UX_LATENCY_NOT_QUALIFIED', 'FRESH_ACOUSTIC_RECOGNITION_QUALIFICATION_NOT_PERFORMED', 'ROOT_SOURCE_LOSS_NOT_EVALUATED'],
    noRepairOrRetry: true, localChecksAreNotGitHubCI: true, stop: 'STOP_FOR_INDEPENDENT_AUDIT'
  };
  await save('assessment.json', assessment);
  await save('assessment.md', '# V37 Asset Delivery\n\n' + BLOCKED + '\n\n' + assessment.historicalStatements.join('\n\n') + '\n\n' +
    'All 19 required sources were prospectively proved by independent exact Git-object checks before reads. All ten anti-truncation discovery tests passed. Internal raw tree bytes produced a compact count/SHA256 summary; no qualification gate used displayed long output. The three model-assets backend files were present. This does not repair or reinterpret V36.\n\n' +
    'V37 stopped pre-freeze at explicit environment availability. Neither the V37 customer-web origin nor a permitted legitimate auth mechanism was supplied. No browser target was inferred and no backend browser origin was required. No credential file, database, existing unrelated browser storage, OSS account or auth endpoint was accessed for qualification.\n\n' +
    'Both delivery cells remain NOT_STARTED. All browser/access/signing/OSS/model/inference/capture/verdict counters are zero. No protocol freeze or remote delivery authorization exists. Remaining qualification tests were not run after the stop. This is an environment availability block, not a production defect.\n\n' +
    'Only additive failure sealing and security checks followed. Production, V3-V36, model identities and capabilities remain unchanged. Result/receipt push processes complete before fetch. Terminal receipt verification and GitHub queries print stdout only, with no later tracked write. Local checks are not GitHub CI. STOP for independent audit.\n');
  await save('precommit-security-scan.json', { at: now(), ...await safeScan(), securityTests });
  await formatting(); git('diff', '--check');
  let resultScan, receiptScan, resultEvidence;
  const protectedChecks = async head => {
    scope(); const currentTree = gitTree(head);
    for (const p of protectedObjects) compareGitObjects(p, gitObjectRecord(p.path, head, currentTree));
    for (const f of history) await verifyLocalRecord(f);
    const checkedIdentity = protectedObjects.map(p => { const c = gitObjectRecord(p.path, head, currentTree); return [c.path, c.gitObject, c.mode]; });
    assert.equal(digestRecords(checkedIdentity), compactStart.protectedGitIdentityListSha256);
    const newFiles = [];
    for (const p of scope()) {
      const record = gitObjectContentRecord(p, head); assert.equal(record.sha256, rawBytesSha256(await bytes(p))); newFiles.push(record);
    }
    return { ...compactStart, verifiedCommit: head, protectedGitObjectsUnchanged: true, historicalLocalBytesUnchanged: true,
      newV37CommittedFiles: newFiles, capabilities: assessment.capabilities };
  };
  const completed = await serializedCloseout(machine, {
    commitResult: async () => {
      machine.assertWriteAllowed(); resultScan = await safeScan(); scope();
      git('add', '-f', '--', DIR, OUT); git('diff', '--cached', '--check');
      assert.ok(git('diff', '--cached', '--name-only').split('\n').every(p => p.startsWith(DIR + '/') || p.startsWith(OUT + '/')));
      git('commit', '-m', 'research: seal V37 exact discovery and pre-freeze explicit environment block'); return git('rev-parse', 'HEAD');
    },
    push: () => network('push'), fetch: () => network('fetch'),
    verifyResult: async () => { resultEvidence = await protectedChecks(machine.resultCommit); return remote(); },
    github,
    writeResultProof: async proof => {
      machine.assertWriteAllowed();
      await save('remote-result-proof.json', { at: now(), startingHead: START, resultCommit: machine.resultCommit, ...proof,
        resultEvidence, resultSecretScan: resultScan, disposition: BLOCKED, finalAuthority: 'Terminal receipt-commit stdout only; no self-reference commit',
        productionDiff: [], V3ThroughV36Diff: [], capabilities: assessment.capabilities });
    },
    commitReceipt: async () => {
      machine.assertWriteAllowed(); receiptScan = await safeScan();
      assert.deepEqual(git('ls-files', '--others', '--exclude-standard').split('\n').filter(Boolean), [OUT + '/remote-result-proof.json']);
      git('add', '-f', '--', OUT + '/remote-result-proof.json'); git('diff', '--cached', '--check');
      assert.deepEqual(git('diff', '--cached', '--name-only').split('\n').filter(Boolean), [OUT + '/remote-result-proof.json']);
      git('commit', '-m', 'research: record V37 blocked result remote proof'); return git('rev-parse', 'HEAD');
    },
    verifyReceipt: async () => {
      await protectedChecks(machine.receiptCommit); await safeScan();
      assert.deepEqual(git('diff', '--name-only', machine.resultCommit, machine.receiptCommit).split('\n').filter(Boolean), [OUT + '/remote-result-proof.json']);
      return remote();
    }
  });
  console.log(JSON.stringify({ phase: 'V37', disposition: BLOCKED, ...completed, ...completed.finalIdentity,
    counts: assessment.counts, resultSecretScan: resultScan.result, receiptSecretScan: receiptScan.result,
    CI: completed.finalGitHub.ciInterpretation, productionDiff: [], V3ThroughV36Diff: [], capabilities: assessment.capabilities,
    requiredPathsVerified: discovery.requiredPathCount, antiTruncationTestsPassed: discoveryUnitTests.tests.length,
    invariant: 'NO_QUALIFICATION_GATE_DEPENDS_ON_TRUNCATABLE_DISPLAY_OUTPUT', historicalStatements: assessment.historicalStatements,
    stop: 'STOP_FOR_INDEPENDENT_AUDIT' }));
} catch (error) {
  const safe = { disposition: BLOCKED, closeoutFailure: { state: machine.state, at: now(), errorClass: error?.name ?? 'Error',
    messageOmittedToPreventSecretExposure: true }, noRepairOrRetry: true, terminalBoundaryReached: machine.finalRemoteVerified };
  if (!machine.finalRemoteVerified && !await exists(OUT + '/closeout-failure.json')) await save('closeout-failure.json', safe);
  console.log(JSON.stringify(safe)); process.exitCode = 1;
}
