import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIR, OUT, START, BRANCH, git, gitBytes, sha256, load, save, scope, remoteIdentity, scanFiles, now, BLOCKED } from './io.mjs';
import { gitIdentity, verifyGitIdentities } from './identities.mjs';
import { verifyExternal } from './proofs.mjs';
import { inspectPreparedImage } from './quality-image.mjs';
import { setSensitiveValues } from './process-result.mjs';
import { evidence, assessmentRecord, safeError } from './evidence.mjs';
import { verifySdkEnvironment } from './sdk-proof.mjs';

export function verifyFrozen() {
  scope(); const freeze = load(OUT + '/delivery-protocol-freeze.json');
  for (const record of freeze.indexIdentities) {
    assert.equal(sha256(gitBytes('show', freeze.freezeParentOrDescendant + ':' + record.subject)), record.sha256);
    assert.equal(sha256(readFileSync(record.subject)), record.sha256);
  }
  const comparisons = verifyGitIdentities(freeze.protectedGitObjects, 'HEAD');
  for (const record of freeze.externalIdentities) verifyExternal(record);
  inspectPreparedImage(freeze.preparedQualityImage.imageId);
  verifySdkEnvironment(freeze.sdkEnvironment);
  assert.equal(sha256(readFileSync(OUT + '/entry.mjs')), freeze.bundleSha256);
  return { freeze, comparisons };
}
async function authorize(input) {
  const secrets = Object.values(input.auth ?? {}).filter(v => typeof v === 'string'); setSensitiveValues(secrets);
  assert.equal(existsSync(OUT + '/delivery-protocol-freeze.json'), false, 'FREEZE_ALREADY_EXISTS');
  const summary = load(OUT + '/preflight-summary.json'); assert.equal(summary.result, 'LOCAL_PASS_NOT_CI');
  remoteIdentity(START, false); scope();
  for (const record of summary.finalHarnessIdentities) verifyExternal(record);
  assert.equal(sha256(readFileSync(OUT + '/entry.mjs')), summary.bundle.bundleSha256);
  const protectedPaths = [...new Set([...summary.product.records.map(r => r.path), ...summary.qualityProof.records.map(r => r.path),
    ...summary.bundle.inputs.filter(r => r.domain === 'WORKTREE_MATERIALIZATION' && !r.subject.startsWith(DIR + '/')).map(r => r.subject)])];
  const protectedGitObjects = protectedPaths.map(file => gitIdentity(file, START));
  const externalIdentities = [...summary.bundle.inputs, summary.bundle.vitePackage, summary.bundle.viteEntry,
    summary.execution.chrome, summary.execution.ortPackage, ...summary.execution.ortAssets, ...summary.execution.externalTrees];
  for (const record of externalIdentities) verifyExternal(record);
  inspectPreparedImage(summary.preparedQuality.image.imageId);
  const sdkEnvironment = load(OUT + '/sdk-expiry-semantics.json').identity;
  verifySdkEnvironment(sdkEnvironment);
  scanFiles([DIR, OUT], secrets); git('add', '-f', '--', DIR, OUT); git('diff', '--cached', '--check');
  const paths = git('diff', '--cached', '--name-only').split('\n').filter(Boolean);
  assert.ok(paths.every(p => p.startsWith(DIR + '/') || p.startsWith(OUT + '/')));
  const indexIdentities = paths.map(file => { const bytes = gitBytes('show', ':' + file); assert.equal(bytes.includes(13), false);
    return { subject: file, representation: 'SHA256_INDEX_OBJECT_CONTENT', domain: 'GIT_OBJECT_CONTENT', sha256: sha256(bytes), byteSize: bytes.length }; });
  save('delivery-protocol-freeze.json', { phase: 'V43', stage: 'FROZEN_QUALIFICATION', startCommit: START, createdAt: now(),
    freezeParentOrDescendant: 'HEAD', contract: load(DIR + '/contract.json'), indexIdentities, protectedGitObjects, externalIdentities,
    preparedQualityImage: summary.preparedQuality.image, sdkEnvironment, bundleSha256: summary.bundle.bundleSha256,
    execution: summary.execution, bundler: { authority: summary.bundle.authority, version: summary.bundle.viteVersion,
      externalRoute: summary.bundle.externalRoute, virtualInputs: summary.bundle.virtualInputs, deterministicBuild: true },
    selfReference: 'Protocol committed hash belongs only in subsequent remote proof.',
    counters: { browserCampaigns: 0, modelAccessRequests: 0, ossRequests: 0, sessions: 0, inferenceRuns: 0 } });
  scanFiles([DIR, OUT], secrets); git('add', '-f', '--', OUT + '/delivery-protocol-freeze.json'); git('diff', '--cached', '--check');
  git('commit', '-m', 'research: freeze engineered V43 model asset delivery qualification');
  const freezeCommit = git('rev-parse', 'HEAD'), events = [];
  events.push({ event: 'FREEZE_PUSH_STARTED', at: now() }); git('push', 'origin', BRANCH);
  events.push({ event: 'FREEZE_PUSH_EXITED_SUCCESS', at: now(), exitCode: 0 });
  events.push({ event: 'FREEZE_FETCH_STARTED', at: now() }); git('fetch', 'origin', BRANCH);
  events.push({ event: 'FREEZE_FETCH_EXITED_SUCCESS', at: now(), exitCode: 0 });
  const remote = remoteIdentity(freezeCommit), verified = verifyFrozen();
  scanFiles([DIR, OUT], secrets);
  const protocolHash = sha256(gitBytes('show', freezeCommit + ':' + OUT + '/delivery-protocol-freeze.json'));
  // Ensure all committed V43 bytes, not just the worktree materialization, were scanned.
  const security = await import('./security.mjs');
  for (const file of [...paths, OUT + '/delivery-protocol-freeze.json']) assert.equal(security.scanText(gitBytes('show', freezeCommit + ':' + file).toString(), secrets).length, 0);
  save('remote-proof.json', evidence('REMOTE_FREEZE_AUTHORIZATION', { qualificationAuthorizationState: 'V43_FROZEN_DELIVERY_AUTHORIZED', freezeCommit, protocolHash, remote,
    remoteVerifiedAt: now(), serializedNetworkEvents: events, protectedObjects: verified.comparisons,
    frozenIndexIdentitiesVerified: indexIdentities.length, committedSecretScan: 'PASS', ...scope() }));
  console.log(JSON.stringify({ result: 'V43_FROZEN_DELIVERY_AUTHORIZED', freezeCommit, protocolHash }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
  try { await authorize(input); }
  catch (error) {
    const committedFreeze = git('rev-parse', 'HEAD') !== START;
    if (committedFreeze) save('assessment.json', assessmentRecord({ disposition: BLOCKED,
      firstFailure: { activeLocalGate: 'FREEZE_REMOTE_AUTHORIZATION', orchestratorBoundary: 'NONE', ...safeError(error), processDiagnostic: error.processDiagnostic ?? null },
      counters: { browserLaunches: 0, modelAccessRequests: 0, ossModelGets: 0, inferenceRuns: 0 },
      productionDefectEstablished: false }, load(DIR + '/contract.json'), scope()));
    console.log(JSON.stringify({ result: committedFreeze ? BLOCKED : 'V43_NOT_STARTED_PREQUALIFICATION_NOT_READY', activeLocalGate: 'FREEZE_READINESS_OR_AUTHORIZATION', errorClass: error.name, qualificationStarted: committedFreeze }));
    process.exitCode = 1;
  }
}
