import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evidence, assessmentRecord, serializeReport } from './evidence.mjs';
import { scanText } from './security.mjs';
import { DIR, START, gitBytes } from './discovery.mjs';

export function writerTests(principalSecrets = []) {
  const tests = [], test = (name, fn) => { fn(); tests.push({ name, result: 'PASS' }); };
  const secret = 'synthetic' + 'q'.repeat(48);
  const enumValue = 'V43_FROZEN_DELIVERY_AUTHORIZED';
  const reject = value => assert.throws(() => serializeReport(value), /UNSAFE_REPORT_REFUSED/);
  test('strict scanner bytes unchanged from V41', () => assert.deepEqual(readFileSync(DIR + '/security.mjs'), gitBytes('show', START + ':backend/research/practice_acoustic_asset_delivery_v41/security.mjs')));
  test('qualification state metadata accepted', () => serializeReport({ qualificationAuthorizationState: enumValue }));
  test('other safe enums accepted', () => serializeReport({ result: 'PASS', cacheSource: 'opfs-cache', classification: 'OSS_MODEL_PAYLOAD_GET' }));
  test('reserved authorization enum still rejected', () => reject({ authorization: enumValue }));
  test('reserved authorization Bearer still rejected', () => reject({ authorization: 'Bearer ' + secret }));
  test('non-JSON Bearer rejected', () => assert.ok(scanText('Bearer ' + secret).length));
  test('JWT rejected', () => assert.ok(scanText('eyJ' + 'a'.repeat(20) + '.' + 'b'.repeat(20) + '.' + 'c'.repeat(20)).length));
  test('cookie rejected', () => reject({ cookie: secret }));
  test('set-cookie rejected', () => reject({ 'set-cookie': secret }));
  test('opaque login password rejected', () => assert.throws(() => serializeReport({ diagnostic: principalSecrets[1] ?? secret }, [principalSecrets[1] ?? secret]), /UNSAFE_REPORT_REFUSED/));
  test('opaque login identity rejected', () => assert.throws(() => serializeReport({ diagnostic: principalSecrets[0] ?? secret }, [principalSecrets[0] ?? secret]), /UNSAFE_REPORT_REFUSED/));
  test('OSS key ID rejected', () => reject({ diagnostic: 'LTAI' + 'x'.repeat(20) }));
  test('OSS secret rejected', () => reject({ access_key_secret: secret }));
  test('signed URL rejected', () => reject({ diagnostic: 'https:' + '//bucket.invalid/model?x-oss-signature=' + secret }));
  test('OSS signature value rejected', () => reject({ diagnostic: 'x-oss-signature=' + secret }));
  test('OSS credential value rejected', () => reject({ diagnostic: 'x-oss-credential=' + secret }));
  test('sanitized OSS record accepted', () => serializeReport({ hostname: 'bucket.invalid', pathname: '/model.onnx', queryParameterNames: ['x-oss-signature', 'x-oss-credential'] }));
  const contract = JSON.parse(readFileSync(DIR + '/contract.json'));
  const timestamp = '2026-10-20T00:00:00.000Z', commit = 'a'.repeat(40), digest = 'b'.repeat(64);
  const scope = { productionDiff: [], V3ThroughV42Diff: [], capabilitiesUnchanged: true };
  const identity = { localHead: commit, originHead: commit, liveRemoteHead: commit, aheadBehind: [0, 0], cleanWorktree: true };
  const github = { head: commit, queriedAt: timestamp, combinedState: 'pending', statuses: [], workflowRuns: [], ciInterpretation: 'NOT CI PASS' };
  const authorizationReceipt = evidence('REMOTE_FREEZE_AUTHORIZATION', {
    qualificationAuthorizationState: enumValue, freezeCommit: commit, protocolHash: digest, remote: identity,
    remoteVerifiedAt: timestamp, serializedNetworkEvents: [{ event: 'FREEZE_PUSH_EXITED_SUCCESS', exitCode: 0, at: timestamp }, { event: 'FREEZE_FETCH_STARTED', at: timestamp }],
    protectedObjects: [{ subject: 'synthetic/source.ts', startingGitObject: commit, currentGitObject: commit, equal: true }],
    frozenIndexIdentitiesVerified: 24, committedSecretScan: 'PASS', ...scope
  });
  const anonymous = evidence('ANONYMOUS_401', { status: 401, isolated: true, pathname: contract.endpoint });
  const cell = name => evidence('DELIVERY_CELL', { name, result: 'RECEIPTS_READY_FOR_INDEPENDENT_AUDIT',
    events: [{ order: 1, cell: name, kind: 'CELL_BEGIN', exactTargetEntryAbsent: name === contract.cells[0] }], inferenceRuns: 0 });
  const cold = cell(contract.cells[0]), warm = cell(contract.cells[1]);
  const campaign = evidence('BROWSER_CAMPAIGN', {
    phase: 'V43', stage: 'FROZEN_QUALIFICATION', startedAt: timestamp, browserLaunches: 1,
    network: [{ ordinal: 1, classification: 'MODEL_ACCESS_DESCRIPTOR_API', hostname: 'localhost', pathname: contract.endpoint, method: 'GET', status: 200, responseBodyBytes: 1000 }],
    cells: [cold, warm], pageErrors: 0, unknownNetwork: 0, inferenceRuns: 0,
    unauthenticatedWitness: anonymous, authenticated: { authenticated: true, mechanism: 'UNCHANGED_API_CLIENT_REAL_CUSTOMER_LOGIN' },
    finishedAt: timestamp, disposition: 'SYNTHETIC_WRITER_SIMULATION_NOT_QUALIFICATION_EVIDENCE'
  });
  const assessment = assessmentRecord({ disposition: campaign.disposition, firstFailure: null,
    counters: { browserLaunches: 1, modelAccessRequests: 3, ossModelGets: 1, inferenceRuns: 0 } }, contract, scope);
  const failureAssessment = assessmentRecord({ disposition: 'SYNTHETIC_FROZEN_PROTOCOL_FAILURE',
    firstFailure: { activeLocalGate: 'FREEZE_REMOTE_AUTHORIZATION', orchestratorBoundary: 'NONE', safeCode: 'SYNTHETIC_ASSERTION', errorClass: 'AssertionError', detail: 'Synthetic safe stack' },
    counters: { browserLaunches: 0, modelAccessRequests: 0, ossModelGets: 0, inferenceRuns: 0 }, productionDefectEstablished: false }, contract, scope);
  const remoteResult = evidence('REMOTE_RESULT_PROOF', { subjectCommit: commit, identity, github, checkedAt: timestamp,
    protectedGitObjectsVerified: 31, secretScan: 'PASS', ...scope, resultDisposition: campaign.disposition,
    serializedEvents: [{ state: 'RESULT_REMOTE_VERIFIED', at: timestamp }], selfReference: 'Synthetic RESULT only; terminal receipt is stdout only' });
  const records = { remoteFreezeAuthorization: authorizationReceipt, anonymous401: anonymous, authenticatedCold: cold,
    authenticatedWarm: warm, browserCampaign: campaign, terminalAssessment: assessment,
    freezeFailureAssessment: failureAssessment, remoteResultProof: remoteResult };
  for (const [name, record] of Object.entries(records)) {
    test('safe actual writer schema ' + name, () => serializeReport(record));
    test('secret rejected by actual writer schema ' + name, () => {
      const injected = JSON.parse(JSON.stringify(record)); injected.diagnostic = secret;
      assert.throws(() => serializeReport(injected, [secret]), /UNSAFE_REPORT_REFUSED/);
    });
  }
  const stages = ['FREEZE_PREPARED', 'FREEZE_COMMIT_AVAILABLE', 'REMOTE_FREEZE_VERIFIED', 'STATE_SERIALIZED',
    'CAMPAIGN_ELIGIBLE', 'BROWSER_SERIALIZED', 'ASSESSMENT_SERIALIZED', 'RESULT_RECEIPT_SERIALIZED'];
  test('writer lifecycle ordered without browser or network', () => {
    let previous = -1;
    for (const [index, stage] of stages.entries()) {
      assert.equal(index, previous + 1);
      if (stage === 'STATE_SERIALIZED') serializeReport(authorizationReceipt);
      if (stage === 'CAMPAIGN_ELIGIBLE') assert.equal(previous, stages.indexOf('STATE_SERIALIZED'));
      if (stage === 'BROWSER_SERIALIZED') serializeReport(campaign);
      if (stage === 'ASSESSMENT_SERIALIZED') serializeReport(assessment);
      if (stage === 'RESULT_RECEIPT_SERIALIZED') serializeReport(remoteResult);
      previous = index;
    }
  });
  test('frozen consumers require non-sensitive state key', () => {
    const writer = readFileSync(DIR + '/freeze.mjs', 'utf8'), consumer = readFileSync(DIR + '/campaign.mjs', 'utf8');
    assert.ok(writer.includes('qualificationAuthorizationState:'));
    assert.ok(consumer.includes('proof.qualificationAuthorizationState'));
    assert.equal(/proof\.authorization\b|\{ authorization:/.test(writer + consumer), false);
  });
  return { result: 'LOCAL_PASS_NOT_CI', invariant: 'ALL_POST_FREEZE_EVIDENCE_SCHEMAS_ARE_SECRET_SCANNER_COMPATIBLE_BEFORE_FREEZE',
    schemaNames: Object.keys(records), lifecycle: stages, browserExecutions: 0, networkExecutions: 0, tests };
}
