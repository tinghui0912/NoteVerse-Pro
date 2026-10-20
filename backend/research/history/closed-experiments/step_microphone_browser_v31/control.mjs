import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { ROOT, DIR, OUT, V26SRC, START, BRANCH, bytes, load, rawBytesSha256, now, save, git, scope, remote, exists, zero } from './io.mjs';
import { immutable, rawImmutable, semanticCoreIdentity, ownFiles, textFormatting, environmentPolicy } from './manifest.mjs';
import { verifyWorktreeMaterialization, verifyExternalLocalAsset, verifyLocalRecord } from './identities.mjs';
import { gitTree, gitObjectRecord, compareGitObjects, indexRecord, verifyCommittedIndexRecord, gitObjectContentRecord } from './git-identities.mjs';
import { identityTests } from './identity-tests.mjs';
import { staticWitnesses, toolingBoundary } from './isolation.mjs';
import { tests } from './tests.mjs';

export async function chromeIdentity(environment) {
  await verifyExternalLocalAsset(environment.chromeExecutable, environment.chromeExecutableSha256);
  assert.equal(environment.chromeFileVersion, '155.0.8059.80');
  return { staticFileVersion: environment.chromeFileVersion, executable: environment.chromeExecutable, noBrowserLaunch: true };
}
export function verifyProtectedObjects(startRecords, ref) {
  const tree = gitTree(ref), comparisons = [];
  for (const record of startRecords) comparisons.push(compareGitObjects(record, gitObjectRecord(record.path, ref, tree)));
  return comparisons;
}
export async function verify() {
  scope(); const freeze = await load(OUT + '/browser-protocol-freeze.json'), head = git('rev-parse', 'HEAD');
  for (const f of freeze.indexIdentities) verifyCommittedIndexRecord(f, head);
  const currentLocalFiles = await ownFiles();
  for (const p of currentLocalFiles) {
    const frozen = freeze.indexIdentities.find(f => f.path === p); assert.ok(frozen, 'UNFROZEN_V31_SOURCE');
    assert.equal(rawBytesSha256(await bytes(p)), frozen.sha256, 'NEW_V31_SOURCE_LOCAL_MUTATION:' + p);
  }
  for (const f of freeze.localIdentities) await verifyLocalRecord(f);
  for (const f of (await load(OUT + '/historical-identities.json')).files) await verifyLocalRecord(f);
  verifyProtectedObjects(freeze.startingGitObjects, head);
  await verifyLocalRecord(freeze.environmentPolicy.repositoryConfig);
  for (const name of ['preflight-failure.json', 'protocol-failure.json']) assert.equal(await exists(OUT + '/' + name), false, 'PERMANENT_STOP');
  return freeze;
}
async function preflight() {
  assert.equal(await exists(OUT + '/tooling-execution-started.json'), false, 'NO_PREFLIGHT_RETRY');
  await save('tooling-execution-started.json', { at: now(), startingHead: START, counters: zero(), retriesAllowed: 0 });
  const results = []; let stage = 'STARTING_GATE';
  const run = async (name, fn) => { stage = name; const details = await fn(); results.push({ name, result: 'LOCAL_PASS', details: details ?? null }); };
  const child = (args, cwd = ROOT) => execFileSync(process.execPath, args,
    { cwd, shell: false, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 }).replaceAll('\r\n', '\n');
  try {
    await run('starting-gate', async () => {
      scope(); assert.equal(git('rev-parse', 'HEAD'), START); assert.equal(remote(false), START);
      await save('starting-gate.json', { at: now(), branch: BRANCH, localHead: START, remoteHead: START,
        mergeBase: git('merge-base', 'HEAD', 'origin/' + BRANCH), aheadBehind: git('rev-list', '--left-right', '--count', 'HEAD...origin/' + BRANCH),
        fetchBeforeEdits: true, cleanBeforeEdits: true, provenance: 'Successful outer fetch/clean Git gate before V31 edits; all subsequent changes are V31 only' });
    });
    const sources = await ownFiles();
    await run('all-module-syntax', () => {
      for (const p of sources.filter(p => p.endsWith('.mjs'))) child(['--check', path.join(ROOT, p)]);
      return { modules: sources.filter(p => p.endsWith('.mjs')).length };
    });
    await run('research-eslint', async () => {
      await save('research-eslint.log', child(['apps/customer-web/node_modules/eslint/bin/eslint.js', '--config', DIR + '/eslint.config.mjs', DIR]));
      return { errors: 0 };
    });
    await run('shell-boundary', () => toolingBoundary(sources));
    await run('identity-domain-synthetic-tests', async () => {
      const results = await identityTests(); await save('identity-unit-tests.json', { result: 'LOCAL_PASS', results }); return { passed: results.length };
    });
    await run('historical-local-materializations-and-assets', async () => {
      const m = await rawImmutable(); await save('local-immutable-inputs.json', m); return { sourceInputs: m.sourceInputs.length, assets: m.assets.length };
    });
    await run('starting-git-object-authority', async () => {
      const tree = gitTree(START), records = [...tree.keys()].sort().map(p => gitObjectRecord(p, START, tree));
      await save('starting-git-objects.json', { startingHead: START, records });
      await save('environment-policy.json', await environmentPolicy()); return { protectedTrackedObjects: records.length, worktreeBytesNotUsedForRemoteComparison: true };
    });
    await run('dual-acoustic-identities', async () => { const core = await semanticCoreIdentity(); await save('core-dual-identity.json', core); return core; });
    await run('oracle-isolation-and-synchronous-rearm', async () => { const w = await staticWitnesses(); await save('oracle-isolation.json', w); return w; });
    await run('tooling-unit-tests', async () => { const t = await tests(); await save('tooling-tests.json', { result: 'LOCAL_PASS', tests: t }); return { passed: t.length }; });
    const app = path.join(ROOT, 'apps/customer-web');
    await run('local-product-regressions', async () => {
      const report = path.join(ROOT, OUT, 'product-regressions.json');
      const log = child(['node_modules/vitest/vitest.mjs', 'run', 'src/lib/practice/local-core', 'src/lib/practice/step', 'src/lib/practice/midi',
        'src/hooks/practice/use-local-practice.test.tsx', 'src/components/practice', 'src/lib/practice/input-capability.test.ts',
        'src/lib/practice/practice-architecture-boundaries.test.ts', 'tests/architecture/practice-no-legacy-realtime.test.ts',
        'src/lib/practice/acoustic/runtime/source-publication.test.ts', 'src/lib/practice/acoustic/runtime/source-analysis-runtime.test.ts',
        'src/lib/practice/acoustic/continuous', 'src/lib/practice/continuous', 'src/lib/practice/acoustic/source/capture-transport.test.ts',
        'src/lib/practice/acoustic/source/capture-architecture.test.ts', 'src/lib/practice/acoustic/model/inference.test.ts',
        'src/lib/practice/acoustic/model/window-geometry.test.ts', '--reporter=json', '--outputFile=' + report], app);
      const r = await load(OUT + '/product-regressions.json'); assert.equal(r.success, true); assert.equal(r.numFailedTests, 0); assert.equal(r.numPendingTests, 0);
      await writeFile(report, JSON.stringify(r, null, 2) + '\n'); await save('product-regressions.log', log);
      return { passed: r.numPassedTests, files: r.numPassedTestSuites, deterministicDoublesNotRealNeural: true };
    });
    await run('application-typecheck', async () => {
      await save('typecheck.log', child(['node_modules/typescript/bin/tsc', '--noEmit', '--incremental', 'false'], app));
    });
    await run('relevant-production-lint', async () => {
      await save('production-eslint.log', child(['node_modules/eslint/bin/eslint.js', 'src/lib/practice/step', 'src/lib/practice/local-core',
        'src/lib/practice/acoustic/source', 'src/lib/practice/acoustic/runtime', 'src/lib/practice/input-capability.ts'], app));
    });
    await run('git-diff-check', () => { git('diff', '--check'); return { exitCode: 0 }; });
    await run('deterministic-v31-text-and-scope', async () => { scope(); return textFormatting(); });
    await save('local-verification.json', { result: 'LOCAL_PASS', completedAt: now(), results, counters: zero(),
      productionDiff: [], V3ThroughV30Diff: [], localNotGitHubCI: true });
    console.log(JSON.stringify({ result: 'LOCAL_PASS', gates: results.length }));
  } catch (error) {
    await save('preflight-failure.json', { disposition: 'STEP_V31_BROWSER_EXECUTION_INTEGRITY_BLOCKED', at: now(), firstFailedGate: stage,
      error: String(error.stack ?? error), stdout: String(error.stdout ?? ''), stderr: String(error.stderr ?? ''), completedGates: results,
      counters: zero(), noRepairOrRetry: true }); console.error(error); process.exitCode = 1;
  }
}
async function freeze() {
  assert.equal(await exists(OUT + '/preflight-failure.json'), false); assert.equal((await load(OUT + '/local-verification.json')).result, 'LOCAL_PASS');
  assert.equal(git('rev-parse', 'HEAD'), START); scope(); git('diff', '--check'); await textFormatting();
  const m = await immutable(), history = [];
  for (const p of git('ls-tree', '-r', '--name-only', START, '--', 'backend/research').split('\n').filter(Boolean)) history.push(await verifyWorktreeMaterialization(p));
  await save('historical-identities.json', { startingHead: START, files: history });
  // Index content is authoritative for NEW V31 controlled files; no remote/checkout byte comparison for old production.
  git('add', '-f', '--', DIR, OUT); git('diff', '--cached', '--check');
  const stagedPaths = git('diff', '--cached', '--name-only').split('\n').filter(Boolean);
  assert.ok(stagedPaths.every(p => p.startsWith(DIR + '/') || p.startsWith(OUT + '/')));
  const indexIdentities = []; for (const p of stagedPaths) indexIdentities.push(await indexRecord(p));
  assert.ok((await ownFiles()).every(p => indexIdentities.some(r => r.path === p)), 'ALL_V31_SOURCES_MUST_BE_STAGED');
  const contract = await load(DIR + '/contract.json'), old = await load(V26SRC + '/contract.json');
  const localIdentities = [...m.artifacts, ...m.assets, ...m.sourceInputs, ...m.frozenLocalSourceIdentities,
    m.coreRaw, m.productionCanonicalDefinition, m.chrome, m.playwright.packageIdentity, m.ortPackage, m.oldFreezeIdentity, m.core.canonical];
  const startingGitObjects = (await load(OUT + '/starting-git-objects.json')).records;
  await save('browser-protocol-freeze.json', { phase: contract.phase, startingHead: START, createdAt: now(), contract,
    cells: contract.cells, campaignContract: { currentDefaults: contract.currentDefaults, deadlines: old.deadlines, normalObservationSeconds: old.normalObservationSeconds },
    immutableCandidate: m, chrome: m.chrome, playwright: m.playwright, indexIdentities, localIdentities, startingGitObjects,
    historyFiles: history.length, environmentPolicy: await load(OUT + '/environment-policy.json'), oracleWitness: await load(OUT + '/oracle-isolation.json'),
    os: { platform: os.platform(), release: os.release(), arch: os.arch() }, productionDiff: [], V3ThroughV30Diff: [], counters: zero(),
    selfReference: 'None. This manifest hash is recorded subsequently from committed Git content in remote proof.',
    authorization: 'NEW_V31_REMOTE_PROOF_REQUIRED_NO_PHASE_RESUMPTION' });
  git('add', '-f', '--', OUT + '/browser-protocol-freeze.json'); git('diff', '--cached', '--check');
  console.log(JSON.stringify({ manifestIndexIdentity: await indexRecord(OUT + '/browser-protocol-freeze.json'), stagedIdentities: indexIdentities.length }));
}
async function proof() {
  const freeze = await verify(), head = remote();
  const comparisons = verifyProtectedObjects(freeze.startingGitObjects, head);
  const sourceChecks = freeze.indexIdentities.map(f => verifyCommittedIndexRecord(f, head));
  const protocolPath = OUT + '/browser-protocol-freeze.json', protocolCommitted = gitObjectContentRecord(protocolPath, head);
  // The freeze itself was staged LF. This is NEW V31 content, never a protected historical materialization.
  assert.equal(rawBytesSha256(await bytes(protocolPath)), protocolCommitted.sha256, 'NEW_V31_PROTOCOL_LOCAL_MUTATION');
  const api = freeze.immutableCandidate.apiClient;
  const apiProof = { starting: api.git, freeze: gitObjectRecord(api.git.path, head), startingContent: api.gitContent,
    freezeContent: gitObjectContentRecord(api.git.path, head), localMaterialization: api.local, domainsNeverCrossCompared: true };
  assert.equal(apiProof.starting.gitObject, apiProof.freeze.gitObject); assert.equal(apiProof.startingContent.sha256, apiProof.freezeContent.sha256);
  await save('remote-browser-freeze-proof.json', { freezeCommit: head, remoteHead: head, remoteVerifiedAt: now(),
    freezeSha256: protocolCommitted.sha256, freezeIdentity: protocolCommitted, protectedGitObjects: comparisons,
    startingAndFreezeGitObjectsEqual: true, committedV31IndexChecks: sourceChecks, apiClientProof: apiProof,
    localIdentitiesReverified: freeze.localIdentities, counters: zero(), authorization: 'NEW_V31_BROWSER_AUTHORIZATION_AFTER_TWO_DOMAIN_PROOF' });
  console.log(JSON.stringify({ freezeCommit: head, protectedObjects: comparisons.length, indexIdentities: sourceChecks.length, freezeSHA256: protocolCommitted.sha256 }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  try {
    if (mode === 'preflight') await preflight();
    else if (mode === 'freeze') await freeze();
    else if (mode === 'proof') await proof();
    else if (mode === 'verify') { await verify(); console.log('V31_DOMAIN_SEPARATED_IDENTITIES_EXACT'); }
    else throw Error('Explicit preflight/freeze/proof/verify mode required');
  } catch (error) {
    if (!await exists(OUT + '/protocol-failure.json')) await save('protocol-failure.json', { at: now(), mode, disposition: 'STEP_V31_BROWSER_EXECUTION_INTEGRITY_BLOCKED',
      error: String(error.stack ?? error), stdout: String(error.stdout ?? ''), stderr: String(error.stderr ?? ''), counters: zero(), noRepairOrRetry: true });
    console.error(error); process.exitCode = 1;
  }
}
