import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { DIR, OUT, START, BRANCH, git, gitBytes, sha256, load, save, scope, execute, scanFiles, filesUnder, now, fail, remoteIdentity } from './io.mjs';
import { REQUIRED, verifyPaths } from './discovery.mjs';
import { rawFileIdentity, canonicalIdentity, gitIdentity, verifyGitIdentities, verifyRawIdentity } from './identities.mjs';
import { toolingTests } from './tests.mjs';
import { closeoutTests } from './closeout-machine.mjs';
import { qualityRuntimeProof } from './quality-runtime-proof.mjs';
import { captureProcess, sanitizedProcessResult, requireProcessSuccess, assertBackendTestArgv, setSensitiveValues } from './process-result.mjs';
import { processResultTests } from './process-result-tests.mjs';
import { inspectPreparedImage, regressionProof } from './quality-image.mjs';

const app = path.resolve('apps/customer-web'), require = createRequire(path.join(app, 'package.json'));
const node = (args, cwd = process.cwd()) => execute(process.execPath, args, { cwd }).toString('utf8');
let secrets = [];
let suppliedEnvironment = null;
let stage = 'STARTING_GATE';
const gateRecords = [];
const gate = async (name, fn) => {
  stage = name;
  save('gate-' + String(gateRecords.length + 1).padStart(2, '0') + '-entered.json', {
    at: now(), activeLocalGate: name, orchestratorBoundary: 'NONE', commandMayBePending: true });
  const details = await fn(); gateRecords.push({ name, result: 'LOCAL_PASS_NOT_CI', details });
};
function sourceProof() {
  const records = verifyPaths(args => gitBytes(...args), START, REQUIRED);
  const text = suffix => gitBytes('show', START + ':' + REQUIRED.find(p => p.endsWith(suffix))).toString();
  const store = text('/model-asset-store.ts'), route = text('/model_assets/router.py'), service = text('/model_assets/service.py');
  assert.ok(text('/app-protocol.ts').includes("API_BASE_URL = '/api/v1'"));
  assert.ok(text('/next.config.ts').includes('NEXT_BACKEND_ORIGIN') && text('/next.config.ts').includes('/api/v1/:path*'));
  assert.ok(/credentials:\s*['"]include['"]/.test(text('/api-client.ts')));
  assert.ok(route.includes('Depends(get_current_user)') && route.includes('service.get_practice_acoustic_access()'));
  assert.ok(service.includes('self.client.presign(') && service.includes('GetObjectRequest'));
  assert.ok(!/websocket|session\.run|PracticeRuntime|microphone/i.test(route + service));
  const deps = text('/deps.py'); assert.ok(deps.includes('select(User).where(User.id == user_id)') && deps.includes('if not user.is_active'));
  const access = text('/practice-acoustic-model-asset.ts');
  assert.ok(access.includes('assertPracticeAcousticModelAccess(response.data)') && access.includes('Object.freeze'));
  for (const term of ['expectedByteSize', 'modelSha256', 'mediaType', 'Date.parse']) assert.ok(access.includes(term));
  const ts = require('typescript'), ast = ts.createSourceFile('store.ts', store, ts.ScriptTarget.Latest, true);
  const calls = [];
  const visit = node => { if (ts.isCallExpression(node)) calls.push({ expression: node.expression.getText(ast), start: node.pos, end: node.end }); ts.forEachChild(node, visit); };
  visit(ast);
  const cold = store.slice(store.indexOf('const downloadMs'), store.indexOf('private async tryReadCachedAsset'));
  const order = ['binHandle.getFile()', 'file.arrayBuffer()', 'bytes.byteLength !== descriptor.expectedByteSize',
    'computeSha256Hex(bytes)', 'digest.toLowerCase() !== descriptor.sha256.toLowerCase()', "entryDir.getFileHandle('verified.json'"];
  const positions = order.map(term => { const position = cold.indexOf(term); assert.ok(position >= 0); return { term, position }; });
  positions.forEach((entry, index) => { if (index) assert.ok(entry.position > positions[index - 1].position); });
  assert.ok(store.includes('await writable.close()') && store.includes("source: 'opfs-cache'"));
  assert.ok(store.includes('`${descriptor.assetId.toLowerCase()}:${descriptor.sha256.toLowerCase()}`'));
  const inference = text('/model-inference.ts');
  const loadPositions = ['await createVerifiedModelAssetLoader()(manifest.asset)', 'await verifyAcousticModel(loaded.bytes)', 'ort.InferenceSession.create(loaded.bytes'].map(s => inference.indexOf(s));
  assert.ok(loadPositions[0] > 0 && loadPositions[1] > loadPositions[0] && loadPositions[2] > loadPositions[1]);
  assert.ok(inference.includes("graphOptimizationLevel: 'disabled'"));
  return { records, routeAuthenticated: true, activeDbUserResolution: true, deliveryOnly: true,
    productionAccessAssertion: true, urlIndependentCacheKey: true, coldActivationOrder: positions,
    astCallWitnesses: calls.filter(c => /getFile|arrayBuffer|computeSha256Hex|createWritable/.test(c.expression)),
    verificationBeforeOrt: loadPositions, graphOptimizationLevel: 'disabled', sourceExecution: false };
}
async function preflight() {
  assert.equal(existsSync(OUT + '/preflight-started.json'), false, 'NO_PREFLIGHT_RETRY');
  save('preflight-started.json', { at: now(), retries: 0, browserLaunches: 0, modelAccessRequests: 0, ossGets: 0 });
  await gate('EXACT_START_AND_SCOPE', () => {
    assert.equal(git('rev-parse', 'HEAD'), START); assert.equal(git('rev-parse', 'origin/' + BRANCH), START);
    assert.equal(git('ls-remote', 'origin', 'refs/heads/' + BRANCH).split(/\s/)[0], START);
    assert.equal(git('rev-list', '--left-right', '--count', 'HEAD...origin/' + BRANCH), '0\t0'); return scope();
  });
  await gate('EXACT_SOURCE_OBJECT_DISCOVERY', () => {
    const records = verifyPaths(args => gitBytes(...args), START, REQUIRED);
    save('preflight-source-objects.json', { records, authority: 'EXACT_DIRECT_GIT_OBJECT_BYTES', requiredPathCount: records.length });
    return { requiredPathsVerified: records.length };
  });
  await gate('V38_TEST_RUNTIME_SELECTION_REGRESSION_PROOF', () => {
    const proof = qualityRuntimeProof(); save('quality-runtime-proof.json', proof);
    return { facts: proof.facts, sourceObjects: proof.records.length, invariant: proof.invariant };
  });
  await gate('V39_OUTER_TIMEOUT_AND_COLD_BUILD_REGRESSION', () => {
    const proof = regressionProof(suppliedEnvironment.preparedQuality);
    save('outer-orchestrator-regression-proof.json', proof); return proof;
  });
  await gate('PREPARED_QUALITY_IMAGE_ID_CAPTURE', () => {
    const image = inspectPreparedImage(suppliedEnvironment.preparedQuality.imageId);
    save('prepared-quality-environment.json', { image, phase0Availability: suppliedEnvironment.preparedQuality,
      noQualificationEvidenceReused: true, capturedAtStartCommit: START });
    return { imageId: image.imageId, domain: image.domain, pytestVersion: '9.0.3' };
  });
  await gate('SYNTAX_ALL_MODULES', () => { const files = filesUnder(DIR).filter(p => p.endsWith('.mjs')); for (const file of files) node(['--check', file]); return { checked: files.length }; });
  await gate('RESEARCH_ESLINT', () => { node(['apps/customer-web/node_modules/eslint/bin/eslint.js', '--config', DIR + '/eslint.config.mjs', DIR]); return { errors: 0 }; });
  await gate('SHELL_BOUNDARY', () => {
    for (const file of filesUnder(DIR).filter(p => p.endsWith('.mjs'))) {
      const text = readFileSync(file, 'utf8');
      const forbidden = [['node', ' -e'], ['python', ' -c'], ['pwsh', ' -Command'], ['Invoke', '-Expression'], ['cmd', ' /c']];
      for (const pair of forbidden) assert.equal(text.includes(pair.join('')), false, 'INLINE_SOURCE_FORBIDDEN');
      assert.equal(/shell\s*:\s*true/.test(text), false);
      for (const term of [['Start', 'Process'].join('-'), ['Start', 'Job'].join('-'), ['spawn', '('].join('')]) assert.equal(text.includes(term), false);
    }
    return { directArgvOnly: true, renderedInventoryAuthority: false };
  });
  await gate('DISCOVERY_SECURITY_NETWORK_IDENTITY_OPFS_UNIT_TESTS', () => { const result = toolingTests(); save('tooling-unit-tests.json', result); return { passed: result.tests.length, antiTruncation: result.discoveryTests }; });
  await gate('QUALITY_RUNTIME_AND_CHILD_CAPTURE_UNIT_TESTS', () => {
    const result = processResultTests(); save('process-result-unit-tests.json', result); return { passed: result.tests.length };
  });
  await gate('SERIALIZED_CLOSEOUT_UNIT_TESTS', async () => { const result = await closeoutTests(); save('closeout-unit-tests.json', result); return { passed: result.length }; });
  await gate('PRODUCTION_STATIC_DELIVERY_AUTH_ACTIVATION_PROOF', () => { const proof = sourceProof(); save('production-static-proof.json', proof); return { requiredObjects: proof.records.length, astWitnesses: proof.astCallWitnesses.length }; });
  await gate('DUAL_ACOUSTIC_IDENTITY', () => {
    const core = 'apps/customer-web/src/lib/practice/acoustic/model/acoustic-core-identity.json';
    const definition = 'apps/customer-web/src/lib/practice/acoustic/model/model-contract.ts';
    const raw = rawFileIdentity(core), semantic = canonicalIdentity(core), productionDefinition = rawFileIdentity(definition);
    assert.equal(raw.sha256, 'ce05905ea023f9bb41a5c2d4e0fd6fb9c3bb7f3222af4a0f1b212257380bf2fb');
    assert.equal(semantic.sha256, '93a9914278e3aa3d659ca73aec8ac10dde5bb51d2101a87abfadcbc75ed01443');
    assert.equal(productionDefinition.sha256, 'dca6d9c5feda834f356f3243e500c8542d1b83a65c724de815cb068d72c57ad5');
    assert.notEqual(raw.sha256, semantic.sha256); save('acoustic-dual-identity.json', { raw, semantic, productionDefinition, differentRepresentationsExpected: true }); return { passed: 3 };
  });
  await gate('EXISTING_BACKEND_MODEL_ASSET_TESTS_IN_QUALITY_SERVICE', () => {
    const imageBefore = inspectPreparedImage(suppliedEnvironment.preparedQuality.imageId);
    const argv = ['compose', '-f', 'docker-compose.backend-dev.yml', 'run', '--rm', '--no-deps', '--pull', 'never', 'quality',
      'python', '-m', 'pytest', 'tests/test_practice_acoustic_model_asset.py', 'tests/test_model_assets.py', '-q', '--no-header', '--tb=short', '-p', 'no:cacheprovider'];
    const service = assertBackendTestArgv(argv);
    const captured = captureProcess('docker', argv, { timeout: 90000 });
    const imageAfter = inspectPreparedImage(suppliedEnvironment.preparedQuality.imageId);
    const result = sanitizedProcessResult(captured, 'TARGETED_BACKEND_MODEL_ASSET_TESTS_IN_QUALITY_SERVICE', secrets);
    save('backend-targeted-test-result.json', { ...result, ...service, commandArgv: argv,
      imageBefore, imageAfter, imageIdUnchanged: imageBefore.imageId === imageAfter.imageId,
      activeLocalGate: stage, orchestratorBoundary: 'NONE', localNotCi: true, deliveryQualificationEvidence: false });
    requireProcessSuccess(captured, 'TARGETED_BACKEND_MODEL_ASSET_TESTS_IN_QUALITY_SERVICE', secrets);
    assert.ok(result.passed > 0); assert.equal(result.failed, 0);
    return { passed: result.passed, service: 'quality', hermeticLocalNotDeliveryEvidence: true, noDatabaseMutation: true };
  });
  await gate('QUALITY_IMAGE_ID_UNCHANGED_AFTER_TEST', () => inspectPreparedImage(suppliedEnvironment.preparedQuality.imageId));
  await gate('EXISTING_FRONTEND_MODEL_ASSET_REGRESSIONS', () => {
    const output = node(['node_modules/vitest/vitest.mjs', 'run', 'src/lib/model-assets/model-asset-store.test.ts',
      'src/lib/model-assets/verified-model-asset-loader.test.ts', 'src/lib/api/practice-acoustic-model-asset.test.ts',
      'src/lib/api/practice-acoustic-model-identity.test.ts', 'src/lib/practice/acoustic/model/inference.test.ts', '--reporter=json'], app);
    const result = JSON.parse(output.slice(output.indexOf('{'))); assert.equal(result.success, true);
    assert.equal(result.numFailedTests, 0); assert.equal(result.numPendingTests, 0);
    return { passed: result.numPassedTests, suites: result.numPassedTestSuites, deterministicTestsNotBrowserQualification: true };
  });
  await gate('APPLICATION_TYPECHECK', () => { node(['node_modules/typescript/bin/tsc', '--noEmit', '--incremental', 'false'], app); return { errors: 0 }; });
  await gate('RELEVANT_PRODUCTION_LINT', () => {
    node(['node_modules/eslint/bin/eslint.js', 'src/lib/model-assets', 'src/lib/api/practice-acoustic-model-asset.ts',
      'src/lib/api/practice-acoustic-model-asset.test.ts', 'src/lib/practice/acoustic/model/model-inference.ts',
      'src/lib/practice/acoustic/model/acoustic-model-manifest.ts', 'src/lib/practice/step/step-microphone-platform.ts'], app);
    return { errors: 0 };
  });
  await gate('BUILD_READ_ONLY_PRODUCTION_DELIVERY_ENTRY', async () => {
    const esbuild = require('esbuild'); mkdirSync(OUT + '/bundles', { recursive: true });
    const options = { entryPoints: [DIR + '/browser-entry.mjs'], outfile: OUT + '/bundles/entry.js', bundle: true,
      platform: 'browser', format: 'esm', target: 'es2022', metafile: true, legalComments: 'none',
      define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
      tsconfig: 'apps/customer-web/tsconfig.json', nodePaths: [app + '/node_modules'] };
    const build = await esbuild.build({ ...options, plugins: [{ name: 'pinned-ort', setup(build) {
      build.onResolve({ filter: /^onnxruntime-web\/webgpu$/ }, () => ({ path: '/__v40/ort/ort.webgpu.min.mjs', external: true }));
    } }] });
    const inputs = Object.keys(build.metafile.inputs).map(name => {
      if (name === '<define:process.env>') return { subject: name, domain: 'ESBUILD_VIRTUAL_INPUT', representation: 'BUILD_SEMANTIC_PROVENANCE',
        provenance: options.define };
      assert.equal(name.startsWith('<'), false, 'UNKNOWN_VIRTUAL_INPUT');
      return { metafileInput: name, ...rawFileIdentity(name, name.includes('/node_modules/') ? 'EXTERNAL_LOCAL_ASSET' : 'WORKTREE_MATERIALIZATION') };
    });
    save('build.json', { options, esbuildVersion: esbuild.version, externalResolver: 'onnxruntime-web/webgpu -> /__v40/ort/ort.webgpu.min.mjs',
      metafile: build.metafile, inputs, bundle: rawFileIdentity(OUT + '/bundles/entry.js') });
    return { inputs: inputs.length, browserExecutions: 0, modelExecutions: 0 };
  });
  await gate('EXECUTION_ASSET_IDENTITIES', () => {
    const chrome = rawFileIdentity('C:/Program Files/Google/Chrome/Application/chrome.exe', 'EXTERNAL_LOCAL_ASSET');
    const playwrightRoot = 'backend/research/browser_runtime/dr3r_browser_runtime/node_modules/playwright';
    const playwright = { root: playwrightRoot, version: load(playwrightRoot + '/package.json').version,
      package: rawFileIdentity(playwrightRoot + '/package.json', 'EXTERNAL_LOCAL_ASSET'),
      entry: rawFileIdentity(playwrightRoot + '/index.js', 'EXTERNAL_LOCAL_ASSET') };
    const playwrightRequire = createRequire(path.resolve(playwrightRoot + '/package.json'));
    const corePackage = playwrightRequire.resolve('playwright-core/package.json');
    playwright.runtimeFiles = filesUnder(path.dirname(corePackage)).filter(p => /\.(js|json)$/.test(p))
      .map(p => rawFileIdentity(p, 'EXTERNAL_LOCAL_ASSET'));
    const ortRoot = 'apps/customer-web/node_modules/onnxruntime-web';
    assert.equal(load(ortRoot + '/package.json').version, '1.20.1');
    const ortAssets = filesUnder(ortRoot + '/dist').filter(p => /\.(mjs|wasm)$/.test(p)).map(p => ({
      ...rawFileIdentity(p, 'EXTERNAL_LOCAL_ASSET'), route: '/__v40/ort/' + path.basename(p) }));
    save('execution-assets.json', { chrome, playwright, ortPackage: rawFileIdentity(ortRoot + '/package.json', 'EXTERNAL_LOCAL_ASSET'),
      ortAssets, chromeVersionAuthority: 'ACTUAL_BROWSER_AND_CDP_AFTER_AUTHORIZATION', browserLaunches: 0 });
    return { ortAssets: ortAssets.length, executableBound: true };
  });
  await gate('GIT_DIFF_DETERMINISTIC_TEXT_SCOPE_SECRET_SCAN', () => {
    git('diff', '--check');
    for (const file of [...filesUnder(DIR), ...filesUnder(OUT)]) {
      const text = readFileSync(file, 'utf8'); assert.equal(text.includes('\r'), false); assert.ok(text.endsWith('\n'));
      assert.equal(/[\t ]+\n/.test(text), false, 'TRAILING_WHITESPACE');
    }
    const report = scanFiles([DIR, OUT], secrets); return { ...scope(), secretScan: report };
  });
  save('local-verification.json', { result: 'LOCAL_PASS_NOT_CI', gates: gateRecords, completedAt: now(),
    browserLaunches: 0, modelAccessRequests: 0, ossGets: 0, modelSessions: 0, inferenceRuns: 0 });
  console.log(JSON.stringify({ result: 'LOCAL_PASS_NOT_CI', gates: gateRecords.length }));
}

export function verifyFreeze() {
  assert.equal(existsSync(OUT + '/first-failure.json'), false, 'PERMANENT_STOP'); scope();
  const freeze = load(OUT + '/delivery-protocol-freeze.json'), head = git('rev-parse', 'HEAD');
  inspectPreparedImage(freeze.preparedQuality.image.imageId);
  for (const record of freeze.indexIdentities) {
    const committed = gitBytes('show', head + ':' + record.subject);
    assert.equal(sha256(committed), record.sha256); assert.equal(sha256(readFileSync(record.subject)), record.sha256);
  }
  verifyGitIdentities(freeze.protectedGitObjects, head);
  for (const record of freeze.localAssetIdentities) verifyRawIdentity(record);
  return freeze;
}
async function authorize() {
  assert.equal(existsSync(OUT + '/first-failure.json'), false); assert.equal(load(OUT + '/local-verification.json').result, 'LOCAL_PASS_NOT_CI');
  assert.equal(git('rev-parse', 'HEAD'), START); scope();
  const build = load(OUT + '/build.json'), execution = load(OUT + '/execution-assets.json');
  const paths = [...new Set([...REQUIRED, ...load(OUT + '/quality-runtime-proof.json').records.map(r => r.path),
    ...build.inputs.filter(r => r.domain === 'WORKTREE_MATERIALIZATION' && !r.subject.startsWith(DIR + '/') && !r.subject.startsWith(OUT + '/')).map(r => r.subject)])];
  const protectedGitObjects = paths.map(file => gitIdentity(file, START));
  scanFiles([DIR, OUT], secrets); git('add', '-f', '--', DIR, OUT); git('diff', '--cached', '--check');
  const staged = git('diff', '--cached', '--name-only').split('\n').filter(Boolean);
  assert.ok(staged.every(p => p.startsWith(DIR + '/') || p.startsWith(OUT + '/')));
  const indexIdentities = staged.map(file => { const bytes = gitBytes('show', ':' + file);
    assert.equal(bytes.includes(13), false); return { subject: file, domain: 'GIT_OBJECT_CONTENT', representation: 'SHA256_INDEX_OBJECT_CONTENT', sha256: sha256(bytes), byteSize: bytes.length }; });
  const localAssetIdentities = [...build.inputs.filter(r => r.domain !== 'ESBUILD_VIRTUAL_INPUT'), execution.chrome,
    execution.playwright.package, execution.playwright.entry, ...execution.playwright.runtimeFiles,
    execution.ortPackage, ...execution.ortAssets];
  save('delivery-protocol-freeze.json', { phase: 'V40', startCommit: START, createdAt: now(), contract: load(DIR + '/contract.json'),
    indexIdentities, protectedGitObjects, localAssetIdentities, execution,
    preparedQuality: load(OUT + '/prepared-quality-environment.json'),
    dualAcousticIdentity: load(OUT + '/acoustic-dual-identity.json'),
    inputAuthorities: ['DIRECT_GIT_PROCESS_BYTES', 'EXACT_FILE_BYTES', 'EXACT_BROWSER_RECEIPT', 'EXACT_NETWORK_EVENT', 'EXACT_JSON_RECORD'],
    selfReference: 'Protocol hash is recorded subsequently from committed Git bytes, not inside itself',
    counters: { browserLaunches: 0, modelAccessRequests: 0, ossGets: 0, modelSessions: 0, inferenceRuns: 0 } });
  scanFiles([DIR, OUT], secrets); git('add', '-f', '--', OUT + '/delivery-protocol-freeze.json');
  stage = 'FREEZE_COMMIT'; git('commit', '-m', 'research: freeze prospective V40 authenticated delivery qualification');
  const freezeCommit = git('rev-parse', 'HEAD'), network = [];
  stage = 'FREEZE_PUSH'; network.push({ event: 'PUSH_STARTED', at: now() }); git('push', 'origin', BRANCH);
  network.push({ event: 'PUSH_EXITED_SUCCESS', at: now(), exitCode: 0 });
  stage = 'FREEZE_FETCH'; network.push({ event: 'FETCH_STARTED', at: now() }); git('fetch', 'origin', BRANCH);
  network.push({ event: 'FETCH_EXITED_SUCCESS', at: now(), exitCode: 0 });
  stage = 'REMOTE_FREEZE_VERIFICATION'; const remote = remoteIdentity(freezeCommit);
  const freeze = verifyFreeze(); scanFiles([DIR, OUT], secrets);
  const protectedProof = verifyGitIdentities(freeze.protectedGitObjects, freezeCommit);
  save('remote-delivery-authorization.json', { authorization: 'V40_PROSPECTIVE_DELIVERY_AUTHORIZED', freezeCommit,
    remoteVerifiedAt: now(), remote, serializedNetworkEvents: network,
    protocolGitContentSha256: sha256(gitBytes('show', freezeCommit + ':' + OUT + '/delivery-protocol-freeze.json')),
    protectedProof, productionDiff: [], V3ThroughV39Diff: [], secretScan: 'PASS', preexistingLoginIsNotQualificationEvidence: true });
  console.log(JSON.stringify({ result: 'V40_REMOTE_DELIVERY_AUTHORIZED', freezeCommit }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    suppliedEnvironment = JSON.parse(readFileSync(0, 'utf8') || '{}');
    secrets = suppliedEnvironment.sensitive ?? [];
    setSensitiveValues(secrets);
    const mode = process.argv[2];
    if (mode === 'preflight') await preflight();
    else if (mode === 'authorize') await authorize();
    else throw Error('EXPLICIT_PREFLIGHT_OR_AUTHORIZE_REQUIRED');
  } catch (error) {
    save('preflight-gate-ledger.json', { completedGates: gateRecords, activeLocalGate: stage,
      orchestratorBoundary: error.orchestratorBoundary ?? 'NONE', noRetry: true, rawChildOutputLost: false });
    fail(stage, error); process.exitCode = 1;
  }
}
