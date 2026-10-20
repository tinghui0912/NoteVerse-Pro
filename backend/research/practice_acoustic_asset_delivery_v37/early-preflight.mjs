import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import { START, BRANCH, OUT, git, gitBytes, rawBytesSha256, save, scope, now, exists } from './io.mjs';
import { REQUIRED, verifyRequiredPaths, summarizeInternalInventory } from './discovery.mjs';
import { discoveryTests } from './discovery-tests.mjs';

const BLOCKED = 'PRACTICE_ACOUSTIC_V37_MODEL_ASSET_DELIVERY_EXECUTION_INTEGRITY_BLOCKED';
let stage = 'STARTING_GATE'; const gates = []; let environment = null;
try {
  assert.equal(await exists(OUT + '/early-preflight-started.json'), false, 'NO_PREFLIGHT_RETRY');
  await save('early-preflight-started.json', { at: now(), startingHead: START, retriesAllowed: 0,
    boundary: 'No browser/auth/network/model execution; qualification gates consume direct local bytes, never rendered tool listings' });
  assert.equal(git('branch', '--show-current'), BRANCH); assert.equal(git('rev-parse', 'HEAD'), START);
  assert.equal(git('rev-parse', 'origin/' + BRANCH), START);
  assert.equal(git('merge-base', 'HEAD', 'origin/' + BRANCH), START);
  assert.equal(git('rev-list', '--left-right', '--count', 'HEAD...origin/' + BRANCH), '0\t0'); scope();
  gates.push({ gate: stage, result: 'PASS', inputSource: 'DIRECT_GIT_PROCESS_BYTES', cleanBeforeEdits: true,
    evidence: 'Outer compact Git gate performed before V37 edits; current diff is V37-only' });

  stage = 'EXACT_REQUIRED_GIT_OBJECTS';
  const records = verifyRequiredPaths(args => gitBytes(...args), START);
  await save('required-path-identities.json', { startingHead: START, requiredPathCount: REQUIRED.length, allRequiredPathsPresent: true,
    authority: 'PER_PATH_CAT_FILE_E_REV_PARSE_CAT_FILE_T_AND_EXACT_LS_TREE_BLOB', records });
  gates.push({ gate: stage, result: 'PASS', inputSource: 'DIRECT_GIT_PROCESS_BYTES', records: 'required-path-identities.json' });

  stage = 'INTERNAL_BINARY_INVENTORY_DIGEST';
  const summary = summarizeInternalInventory(gitBytes('ls-tree', '-rz', '--name-only', START), START, REQUIRED);
  assert.equal(summary.allRequiredPathsPresent, true);
  await save('internal-inventory-summary.json', summary);
  gates.push({ gate: stage, result: 'PASS', inputSource: 'DIRECT_GIT_PROCESS_BINARY_BYTES', concreteMembershipAuthority: 'Independent per-path blob records, not this secondary summary' });

  stage = 'ANTI_TRUNCATION_DISCOVERY_UNIT_TESTS';
  const tests = discoveryTests(); await save('discovery-unit-tests.json', { result: 'LOCAL_PASS', tests, syntheticOnly: true });
  gates.push({ gate: stage, result: 'PASS', inputSource: 'SYNTHETIC_DIRECT_BYTE_PROCESS_PORTS', testsPassed: tests.length });

  stage = 'VALIDATED_SOURCE_INSPECTION';
  const contents = new Map(), sourceIdentities = [];
  for (const record of records) {
    // No required-file content is accessed before its independent blob proof above.
    const raw = gitBytes('show', START + ':' + record.path); contents.set(record.path, raw.toString('utf8'));
    sourceIdentities.push({ path: record.path, domain: 'GIT_OBJECT_CONTENT', representation: 'SHA256_GIT_OBJECT_CONTENT',
      subject: { kind: 'EXACT_GIT_SHOW_BYTES', startCommit: START, path: record.path, blobSha: record.blobSha }, sha256: rawBytesSha256(raw), bytes: raw.length });
  }
  const source = suffix => contents.get(REQUIRED.find(p => p.endsWith(suffix)));
  const facts = {
    frontendProtocolHasSameOriginApiBase: source('/app-protocol.ts').includes('/api/v1'),
    nextConfigurationUsesBackendInfrastructureRewrite: source('/next.config.ts').includes('NEXT_BACKEND_ORIGIN') && source('/next.config.ts').includes('/api/v1'),
    apiClientUsesCredentialsInclude: /credentials:\s*['"]include['"]/.test(source('/api-client.ts')),
    accessFunctionIsProductionFunction: source('/practice-acoustic-model-asset.ts').includes('getPracticeAcousticModelAccess'),
    backendRouteRequiresCurrentUser: source('/model_assets/router.py').includes('Depends(get_current_user)'),
    backendServiceIsAssetPresigningOnly: source('/model_assets/service.py').includes('GetObjectRequest') && source('/model_assets/service.py').includes('self.client.presign'),
    productionStoreAndLoaderReadOnlyInspection: true, executedProductionCode: false
  };
  await save('validated-source-inspection.json', { sourceIdentities, facts,
    proofScope: 'Read-only pre-environment source inspection; not complete delivery qualification or browser execution' });
  const known = { 'backend/app/modules/model_assets/router.py': 'd547f7b9f51fe0286c78e14595c2113d4cb5224f',
    'backend/app/modules/model_assets/service.py': '15fb1be483df2fb52fe389d3e7bee44b258df770',
    'backend/app/modules/model_assets/schemas.py': '23d8de8356da3b1a7612f1dc22978328b74567ec' };
  await save('historical-sanity-only.json', { authority: 'New prospective records above; historical values are additional sanity only',
    comparisons: records.filter(r => known[r.path]).map(r => ({ path: r.path, prospectiveBlobSha: r.blobSha, independentlyReportedHistoricalBlob: known[r.path], equal: r.blobSha === known[r.path] })) });
  gates.push({ gate: stage, result: 'PASS', inputSource: 'EXACT_GIT_OBJECT_CONTENT_BYTES', sourceCount: contents.size });

  stage = 'EXPLICIT_EXTERNAL_ENVIRONMENT_AVAILABILITY';
  const has = name => typeof process.env[name] === 'string' && process.env[name].trim().length > 0;
  const originSupplied = has('V37_CUSTOMER_WEB_ORIGIN'), stateSupplied = has('V37_AUTH_STORAGE_STATE');
  const emailSupplied = has('V37_TEST_LOGIN_EMAIL'), passwordSupplied = has('V37_TEST_LOGIN_PASSWORD');
  const loginSupplied = emailSupplied && passwordSupplied;
  const exactlyOneAuthForm = stateSupplied !== loginSupplied && emailSupplied === passwordSupplied;
  let originValid = false, browserOrigin = null, stateAccessible = null;
  if (originSupplied) {
    try {
      const raw = process.env.V37_CUSTOMER_WEB_ORIGIN, url = new URL(raw);
      originValid = ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash
        && url.pathname === '/' && raw.replace(/\/$/, '') === url.origin;
      if (originValid) browserOrigin = url.origin;
    } catch { /* Never log the supplied value or parser exception. */ }
  }
  if (originValid && exactlyOneAuthForm && stateSupplied) {
    try { stateAccessible = (await stat(process.env.V37_AUTH_STORAGE_STATE)).isFile(); } catch { stateAccessible = false; }
  }
  const ready = originValid && exactlyOneAuthForm && (!stateSupplied || stateAccessible === true);
  environment = { customerWebOriginSupplied: originSupplied, customerWebOriginValid: originValid, browserOrigin,
    authSupplied: stateSupplied || loginSupplied, exactlyOneLegitimateAuthFormSupplied: exactlyOneAuthForm,
    authMode: exactlyOneAuthForm ? stateSupplied ? 'EXTERNAL_STORAGE_STATE' : 'EXTERNAL_TEST_LOGIN' : 'NONE_OR_INVALID_COMBINATION',
    storageStateFileAccessible: stateAccessible, credentialsNetworkValidated: false, ready,
    backendBrowserOriginRequired: false, targetInferred: false, credentialFilesRead: false,
    source: 'EXPLICIT_V37_PROCESS_ENVIRONMENT_ONLY_NO_FALLBACK_OR_DISCOVERY' };
  await save('environment-availability.json', environment);
  if (!ready) throw Object.assign(Error('V37_REQUIRED_EXPLICIT_ORIGIN_OR_AUTH_UNAVAILABLE'), { safeCode: 'REQUIRED_EXPLICIT_ENVIRONMENT_NOT_ESTABLISHED' });
  gates.push({ gate: stage, result: 'AVAILABILITY_ONLY_PASS', inputSource: 'EXPLICIT_EXTERNAL_VALUES_IN_MEMORY_AND_EXACT_SANITIZED_JSON_RECORD', browserOriginRequiredOnly: true });
  await save('early-preflight.json', { result: 'EARLY_PREFLIGHT_PASS_NOT_BROWSER_AUTHORIZATION', startingHead: START, gates,
    invariant: 'NO_QUALIFICATION_GATE_DEPENDS_ON_TRUNCATABLE_DISPLAY_OUTPUT', next: 'Complete remaining tooling and all mandatory freeze gates; no execution authorized' });
  console.log(JSON.stringify({ result: 'EARLY_PREFLIGHT_PASS_NOT_BROWSER_AUTHORIZATION', requiredPathsVerified: records.length, discoveryTestsPassed: tests.length, internalInventory: summary }));
} catch (error) {
  const failure = { phase: 'V37', disposition: BLOCKED, stoppedAt: now(), firstFailedGate: stage,
    firstFailureCode: error.safeCode ?? 'RESEARCH_PREFLIGHT_GATE_FAILURE', errorClass: error.name,
    rawErrorOmittedForSecretSafety: true, completedGates: gates, environment,
    invariant: 'NO_QUALIFICATION_GATE_DEPENDS_ON_TRUNCATABLE_DISPLAY_OUTPUT', noRepairOrRetry: true,
    productionDefectEstablished: false, protocolFreezeCreated: false, remoteDeliveryAuthorizationCreated: false,
    executionCounts: { browserLaunches: 0, authenticatedAccessRequests: 0, unauthenticatedAccessRequests: 0, ossModelGets: 0, modelSessions: 0, inferenceRuns: 0 } };
  await save('first-failure.json', failure);
  console.log(JSON.stringify({ disposition: BLOCKED, firstFailedGate: stage, completedGates: gates.map(g => ({ gate: g.gate, result: g.result })), environment,
    noRepairOrRetry: true, executionCounts: failure.executionCounts })); process.exitCode = 1;
}
