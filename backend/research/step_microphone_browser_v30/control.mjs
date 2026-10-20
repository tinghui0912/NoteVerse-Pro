import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { ROOT, DIR, OUT, V26SRC, START, BRANCH, bytes, load, rawBytesSha256, now, save, git, scope, remote, exists, zero, github } from './io.mjs';
import { immutable, rawImmutable, semanticCoreIdentity, ownFiles, textFormatting } from './manifest.mjs';
import { verifyRawFileIdentity } from './identities.mjs';
import { identityTests } from './identity-tests.mjs';
import { staticWitnesses, toolingBoundary } from './isolation.mjs';
import { tests } from './tests.mjs';

export async function chromeIdentity(environment) {
  await verifyRawFileIdentity(environment.chromeExecutable, environment.chromeExecutableSha256);
  assert.equal(environment.chromeFileVersion, '155.0.8059.80');
  return { staticFileVersion: environment.chromeFileVersion, executable: environment.chromeExecutable, noBrowserLaunch: true };
}
export async function verify() {
  scope(); const freeze = await load(OUT + '/browser-protocol-freeze.json');
  for (const f of [...freeze.files, ...(await load(OUT + '/historical-identities.json')).files]) await verifyRawFileIdentity(f.path, f.sha256);
  assert.equal(await exists(OUT + '/preflight-failure.json'), false, 'PERMANENT_PREFLIGHT_STOP'); return freeze;
}
async function preflight() {
  assert.equal(await exists(OUT + '/tooling-execution-started.json'), false, 'NO_PREFLIGHT_RETRY');
  await save('tooling-execution-started.json', { at: now(), startingHead: START, counters: zero(), retriesAllowed: 0 });
  const results = []; let stage = 'STARTING_GATE';
  const run = async (name, fn) => { stage = name; const result = await fn(); results.push({ name, result: 'LOCAL_PASS', details: result ?? null }); };
  const child = (args, cwd = ROOT) => {
    const stdout = execFileSync(process.execPath, args, { cwd, shell: false, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
    return stdout.replaceAll('\r\n', '\n');
  };
  try {
    await run('starting-gate', async () => {
      scope(); assert.equal(git('rev-parse', 'HEAD'), START); assert.equal(remote(false), START);
      await save('starting-gate.json', { at: now(), branch: BRANCH, localHead: START, remoteHead: START,
        mergeBase: git('merge-base', 'HEAD', 'origin/' + BRANCH), aheadBehind: git('rev-list', '--left-right', '--count', 'HEAD...origin/' + BRANCH),
        fetchBeforeEdits: true, cleanBeforeEdits: true, provenance: 'Successful outer fetch and clean Git gate in task transcript before V30 edits; subsequent untracked paths are V30 only' });
    });
    const sources = await ownFiles();
    await run('every-v30-module-node-check', () => {
      for (const p of sources.filter(p => p.endsWith('.mjs'))) child(['--check', path.join(ROOT, p)]);
      return { modules: sources.filter(p => p.endsWith('.mjs')).length };
    });
    await run('research-eslint', async () => {
      const log = child(['apps/customer-web/node_modules/eslint/bin/eslint.js', '--config', DIR + '/eslint.config.mjs', DIR]);
      await save('research-eslint.log', log); return { errors: 0 };
    });
    await run('no-shell-inline-and-scope', () => toolingBoundary(sources));
    await run('identity-representation-unit-tests', async () => { const results = await identityTests(); await save('identity-unit-tests.json', { result: 'LOCAL_PASS', results }); return { passed: results.length }; });
    await run('raw-immutable-identities', async () => { const m = await rawImmutable(); await save('raw-immutable-inputs.json', m); return { sourceInputs: m.sourceInputs.length, assets: m.assets.length }; });
    await run('canonical-core-semantic-identity', async () => { const core = await semanticCoreIdentity(); await save('core-dual-identity.json', core); return core; });
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
      return { passed: r.numPassedTests, files: r.numPassedTestSuites, testDoublesOnlyNoRealNeural: true };
    });
    await run('application-typecheck', async () => {
      const log = child(['node_modules/typescript/bin/tsc', '--noEmit', '--incremental', 'false'], app); await save('typecheck.log', log);
    });
    await run('relevant-production-lint', async () => {
      const log = child(['node_modules/eslint/bin/eslint.js', 'src/lib/practice/step', 'src/lib/practice/local-core',
        'src/lib/practice/acoustic/source', 'src/lib/practice/acoustic/runtime', 'src/lib/practice/input-capability.ts'], app);
      await save('production-eslint.log', log);
    });
    await run('git-diff-check', () => { git('diff', '--check'); return { exitCode: 0 }; });
    await run('deterministic-text-format-and-final-scope', async () => { scope(); return textFormatting(); });
    await save('local-verification.json', { result: 'LOCAL_PASS', completedAt: now(), results, counters: zero(),
      localNotGitHubCI: true, productionDiff: [], V3ThroughV29Diff: [] });
    console.log(JSON.stringify({ result: 'LOCAL_PASS', gates: results.length }));
  } catch (error) {
    await save('preflight-failure.json', { disposition: 'STEP_V30_BROWSER_EXECUTION_INTEGRITY_BLOCKED', at: now(), firstFailedGate: stage,
      error: String(error.stack ?? error), stdout: String(error.stdout ?? ''), stderr: String(error.stderr ?? ''),
      completedGates: results, counters: zero(), noRepairOrRetry: true });
    console.error(error); process.exitCode = 1;
  }
}
async function freeze() {
  assert.equal(await exists(OUT + '/preflight-failure.json'), false); assert.equal((await load(OUT + '/local-verification.json')).result, 'LOCAL_PASS');
  assert.equal(git('rev-parse', 'HEAD'), START); scope(); git('diff', '--check'); await textFormatting();
  const m = await immutable(), history = [];
  for (const p of git('ls-tree', '-r', '--name-only', START, '--', 'backend/research').split('\n').filter(Boolean)) history.push(await verifyRawFileIdentity(p));
  await save('historical-identities.json', { startingHead: START, files: history });
  const own = await ownFiles(), reports = (await readdir(path.join(ROOT, OUT))).map(p => OUT + '/' + p);
  const protectedFiles = git('ls-tree', '-r', '--name-only', START, '--', 'apps/customer-web/src/lib/practice', 'apps/customer-web/src/hooks/practice').split('\n').filter(Boolean);
  const paths = [...new Set([...own, ...reports, ...m.artifacts.map(x => x.path), ...m.assets.map(x => x.path), ...m.sourceInputs.map(x => x.path), ...protectedFiles])].sort();
  const files = []; for (const p of paths) files.push(await verifyRawFileIdentity(p));
  const contract = await load(DIR + '/contract.json'), old = await load(V26SRC + '/contract.json');
  await save('browser-protocol-freeze.json', { phase: contract.phase, startingHead: START, createdAt: now(), contract,
    cells: contract.cells, campaignContract: { currentDefaults: contract.currentDefaults, deadlines: old.deadlines, normalObservationSeconds: old.normalObservationSeconds },
    immutableCandidate: m, chrome: m.chrome, playwright: m.playwright, files, historyFiles: history.length,
    oracleWitness: await load(OUT + '/oracle-isolation.json'),
    os: { platform: os.platform(), release: os.release(), arch: os.arch() }, productionDiff: [], V3ThroughV29Diff: [], counters: zero(),
    authorization: 'NEW_V30_REMOTE_PROOF_REQUIRED_NO_HISTORICAL_PHASE_RESUMPTION' });
  console.log(JSON.stringify({ freezeSha256: rawBytesSha256(await bytes(OUT + '/browser-protocol-freeze.json')), files: files.length, history: history.length }));
}
async function proof() {
  const freeze = await verify(), head = remote(), tracked = new Set(git('ls-files').split('\n')), remoteChecks = [];
  const protocolPath = OUT + '/browser-protocol-freeze.json';
  for (const f of [...freeze.files, await verifyRawFileIdentity(protocolPath)]) {
    if (tracked.has(f.path)) {
      const committedBytes = execFileSync('git', ['show', head + ':' + f.path], { cwd: ROOT, shell: false, maxBuffer: 128 * 1024 * 1024 });
      assert.equal(rawBytesSha256(committedBytes), f.sha256, 'REMOTE_FREEZE_RAW_BYTES:' + f.path);
      remoteChecks.push({ ...f, remoteBinding: 'COMMITTED_RAW_BYTES_VERIFIED' });
    } else {
      assert.ok(!f.path.startsWith(DIR + '/') && !f.path.startsWith(OUT + '/'), 'V30_SOURCE_OR_REPORT_NOT_COMMITTED:' + f.path);
      assert.ok(freeze.immutableCandidate.assets.some(a => a.path === f.path), 'UNDECLARED_NONREPOSITORY_FREEZE_INPUT');
      remoteChecks.push({ ...f, remoteBinding: 'PINNED_LOCAL_ASSET_RAW_HASH_BOUND_IN_REMOTE_MANIFEST' });
    }
  }
  await save('remote-browser-freeze-proof.json', { freezeCommit: head, remoteHead: head, remoteVerifiedAt: now(),
    freezeSha256: rawBytesSha256(await bytes(protocolPath)), freezeRepresentation: 'RAW_FILE_BYTES_SHA256', remoteChecks, counters: zero(),
    authorization: 'NEW_V30_FIRST_AUTHORIZED_CAMPAIGN_AFTER_REMOTE_PROOF' }); console.log(head);
}
async function receipt() {
  scope(); const head = remote(), files = scope(), identities = [];
  for (const p of files) {
    const b = await bytes(p), r = execFileSync('git', ['show', head + ':' + p], { cwd: ROOT, shell: false, maxBuffer: 128 * 1024 * 1024 });
    assert.equal(rawBytesSha256(b), rawBytesSha256(r), 'REMOTE_BYTES:' + p); identities.push({ path: p, representation: 'RAW_FILE_BYTES_SHA256', sha256: rawBytesSha256(b), bytes: b.length });
  }
  if (await exists(OUT + '/browser-protocol-freeze.json')) await verify();
  const m = await immutable();
  if (await exists(OUT + '/historical-identities.json')) for (const f of (await load(OUT + '/historical-identities.json')).files) await verifyRawFileIdentity(f.path, f.sha256);
  const checks = await github(head);
  await save('remote-result-proof.json', { resultCommit: head, remoteHead: head, verifiedAt: now(), exactChangedFiles: files, identities,
    productionDiff: [], V3ThroughV29Diff: [], immutableArtifacts: m.artifacts, capabilities: (await load(DIR + '/contract.json')).capabilities,
    disposition: (await load(OUT + '/assessment.json')).disposition, github: checks, cleanBeforeReceipt: true,
    note: 'Additive receipt; final receipt HEAD independently refetched/queried, not self-referential' }); console.log(JSON.stringify({ head, github: checks }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  if (mode === 'preflight') await preflight();
  else if (mode === 'freeze') await freeze();
  else if (mode === 'proof') await proof();
  else if (mode === 'receipt') await receipt();
  else if (mode === 'final-head') { const head = remote(); scope(); console.log(JSON.stringify({ head, github: await github(head) })); }
  else if (mode === 'verify') { await verify(); console.log('FROZEN_IDENTITIES_SCOPE_EXACT'); }
  else throw Error('Explicit preflight/freeze/proof/receipt/final-head/verify mode required');
}
