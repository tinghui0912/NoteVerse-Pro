import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { ROOT, DIR, OUT, V27, START, bytes, load, sha, canonical, save, git, scope, remote, github, now } from './io.mjs';

// Post-stop evidence sealing only. This helper cannot authorize or execute the qualification campaign.
assert.equal((await load(OUT + '/preflight-failure.json')).firstFailedGate, 'immutable-identities');
const mode = process.argv[2];
if (mode === 'witness') {
  scope();
  const corePath = 'apps/customer-web/src/lib/practice/acoustic/model/acoustic-core-identity.json';
  const raw = await bytes(corePath), core = JSON.parse(raw), old = await load(V27 + '/browser-protocol-freeze.json');
  const acceptedRaw = old.files.find(f => f.path === corePath); assert.ok(acceptedRaw);
  const verified = new Map();
  for (const f of [...old.files, ...(await load(V27 + '/historical-identities.json')).files]) {
    assert.equal(sha(await bytes(f.path)), f.sha256, 'CLOSEOUT_RAW_MUTATION:' + f.path); verified.set(f.path, f.sha256);
  }
  const history = [];
  for (const p of git('ls-tree', '-r', '--name-only', START, '--', 'backend/research').split('\n').filter(Boolean)) history.push({ path: p, sha256: sha(await bytes(p)) });
  await save('closeout-raw-historical-identities.json', { at: now(), startingHead: START, files: history,
    acceptedRawFilesReverified: verified.size, productionDiff: [], V3ThroughV28Diff: [], purpose: 'Post-stop immutability verification only, not prospective freeze or qualification authorization' });
  await save('failure-cause.json', { at: now(), disposition: 'STEP_V29_BROWSER_EXECUTION_INTEGRITY_BLOCKED',
    code: 'RESEARCH_MANIFEST_RAW_FILE_SHA_COMPARED_WITH_CANONICAL_CORE_IDENTITY_SHA',
    firstFailure: await load(OUT + '/preflight-failure.json'),
    core: { path: corePath, actualRawByteSHA256: sha(raw), acceptedV27RawByteSHA256: acceptedRaw.sha256,
      canonicalJsonSHA256: sha(Buffer.from(canonical(core))), requestedAcousticCoreIdentitySHA256: '93a9914278e3aa3d659ca73aec8ac10dde5bb51d2101a87abfadcbc75ed01443',
      rawBytesStillMatchAcceptedHistory: sha(raw) === acceptedRaw.sha256,
      canonicalIdentityStillMatchesRequestedIdentity: sha(Buffer.from(canonical(core))) === '93a9914278e3aa3d659ca73aec8ac10dde5bb51d2101a87abfadcbc75ed01443' },
    productionDefinitionSource: { path: 'apps/customer-web/src/lib/practice/acoustic/model/model-contract.ts',
      sha256: sha(await bytes('apps/customer-web/src/lib/practice/acoustic/model/model-contract.ts')),
      semantics: 'assertAcousticIdentity hashes TextEncoder(canonicalJson(coreIdentity)); it does not compare identitySha256 with JSON file bytes' },
    causalConclusion: 'V29 research manifest used the wrong identity representation. No production asset drift or production graph defect established. The failed gate is not repaired, retried or relabeled PASS.',
    gateCoverage: { passed: ['starting-gate', '10-module-node-check', 'research-eslint', 'no-shell-inline-and-scope'],
      failed: 'immutable-identities', notRun: ['oracle-isolation-gate', 'tooling-unit-tests', 'product-regressions', 'application-typecheck', 'production-lint', 'pre-freeze-git-diff-check', 'deterministic-text-format-gate', 'protocol-freeze', 'remote-browser-authorization', 'all-four-browser-cells'] },
    productionDiff: [], V3ThroughV28Diff: [], noSourceFix: true, noRetry: true, noBrowserExecution: true });
  await save('failure-cause.md', '# V29 Permanent Pre-freeze Stop\n\nSTEP_V29_BROWSER_EXECUTION_INTEGRITY_BLOCKED\n\n' +
    'The first executed preflight failed at immutable-identities. The V29 research manifest incorrectly compared raw acoustic-core-identity.json file SHA with the semantic acoustic-core identity SHA.\n\n' +
    'Raw file SHA: ' + sha(raw) + '. This still equals the accepted V27 raw-file identity.\n\n' +
    'Canonical core identity SHA: ' + sha(Buffer.from(canonical(core))) + '. This equals the requested 93a991... identity, following the unchanged production model-contract definition. This post-stop diagnosis does not repair or rerun the failed gate.\n\n' +
    'Ten module syntax checks, research ESLint and no-shell-inline/scope checks passed. Oracle isolation, unit/product tests, app typecheck/lint and the remaining pre-freeze gates did not run. No protocol freeze/proof or browser campaign exists. All four cells NOT_EXECUTED; model/neural/decoder/browser-product counts zero.\n\n' +
    'Production and V3-V28 remain unchanged. This is a research tooling defect, not a model, H50 or browser resource defect. No source fix, retry, rebuild, tuning, capability/controller integration or qualification claim. Root loss, physical device, permission UX, latency, recognition and backend delivery remain unqualified.\n\nSTOP for independent audit.\n');
  console.log(JSON.stringify({ disposition: 'STEP_V29_BROWSER_EXECUTION_INTEGRITY_BLOCKED', acceptedRawFiles: verified.size,
    historicalFiles: history.length, rawCoreSHA256: sha(raw), canonicalCoreSHA256: sha(Buffer.from(canonical(core))) }));
} else if (mode === 'receipt') {
  const head = remote(), files = scope(), identities = [];
  for (const p of files) {
    const b = await bytes(p), r = execFileSync('git', ['show', head + ':' + p], { cwd: ROOT, shell: false, maxBuffer: 128 * 1024 * 1024 });
    assert.equal(sha(b), sha(r), 'REMOTE_RESULT_BYTES:' + p); identities.push({ path: p, sha256: sha(b), bytes: b.length });
  }
  const history = await load(OUT + '/closeout-raw-historical-identities.json');
  for (const f of history.files) assert.equal(sha(await bytes(f.path)), f.sha256, 'POST_STOP_HISTORY_CHANGE:' + f.path);
  const accepted = (await load(V27 + '/browser-protocol-freeze.json')).immutableCandidate;
  for (const f of [...accepted.artifacts, ...accepted.assets]) {
    const b = await bytes(f.path); assert.equal(sha(b), f.sha256); assert.equal(b.length, f.bytes);
  }
  const checks = await github(head);
  await save('remote-result-proof.json', { at: now(), startingHead: START, resultCommit: head, remoteHead: head,
    exactChangedFiles: files, identities, productionDiff: [], V3ThroughV28Diff: [], historicalRawFilesReverified: history.files.length,
    immutableV26ArtifactsAndAssetsExact: true, capabilities: (await load(DIR + '/contract.json')).capabilities,
    disposition: (await load(OUT + '/assessment.json')).disposition, github: checks, cleanBeforeReceipt: true,
    noBrowserFreezeOrAuthorization: true, noBrowserCampaign: true, noRepairOrRetry: true,
    note: 'Additive remote-result receipt only; final receipt commit independently refetched/queried, not self-referential. STOP for independent audit.' });
  console.log(JSON.stringify({ head, github: checks }));
} else if (mode === 'final-head') {
  const head = remote(); scope(); console.log(JSON.stringify({ head, github: await github(head) }));
} else throw Error('Only post-stop witness/receipt/final-head evidence modes are permitted');
