import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIR, OUT, START, execute, git, load, save, scope, remoteIdentity, scanFiles, filesUnder, now } from './io.mjs';
import { rawFileIdentity } from './identities.mjs';
import { qualityRuntimeProof } from './quality-runtime-proof.mjs';
import { inspectPreparedImage } from './quality-image.mjs';
import { assertBackendTestArgv, captureProcess, requireProcessSuccess, sanitizedProcessResult, setSensitiveValues } from './process-result.mjs';
import { toolingTests } from './tests.mjs';
import { processResultTests } from './process-result-tests.mjs';
import { closeoutTests } from './closeout-machine.mjs';
import { constructBundle } from './bundle.mjs';
import { staticProductProof, externalTreeIdentity } from './proofs.mjs';
import { writerTests } from './writer-tests.mjs';

let stage = 'HARNESS_ENGINEERING';
export async function ready(input) {
  assert.equal(existsSync(OUT + '/delivery-protocol-freeze.json'), false, 'FROZEN_SOURCE_IS_IMMUTABLE');
  const secrets = Object.values(input.auth ?? {}).filter(v => typeof v === 'string'); setSensitiveValues(secrets);
  assert.ok(input.auth?.identity && input.auth?.credential, 'EXPLICIT_PRINCIPAL_NOT_AVAILABLE');
  const contract = load(DIR + '/contract.json'); assert.equal(new URL(input.origin).origin, contract.customerWebOrigin);
  remoteIdentity(START, false); scope();
  stage = 'CUSTOMER_WEB_DOCUMENT_AVAILABILITY';
  const targetResponse = await fetch(contract.customerWebOrigin + '/zh/auth/login', { redirect: 'manual', signal: AbortSignal.timeout(15000) });
  assert.equal(targetResponse.status, 200, 'AUTHORIZED_CUSTOMER_WEB_DOCUMENT_UNAVAILABLE');
  await targetResponse.body?.cancel();
  const product = staticProductProof(), qualityProof = qualityRuntimeProof();
  const image = inspectPreparedImage(input.preparedImageId);
  const run = (name, file, argv, options = {}) => { stage = name; return execute(file, argv, { timeout: 90000, ...options }); };
  const app = path.resolve('apps/customer-web'), require = createRequire(path.join(app, 'package.json'));
  stage = 'BUNDLE_ENGINEERING'; const bundle = await constructBundle(secrets);
  if (process.argv[2] === 'bundle') {
    console.log(JSON.stringify({ stage: 'HARNESS_ENGINEERING', bundler: bundle.record.viteVersion, bundleSha256: bundle.record.bundleSha256,
      inputCount: bundle.record.inputs.length, virtualInputs: bundle.record.virtualInputs, smoke: bundle.record.structuralSmoke })); return;
  }
  const node = (name, argv, cwd = process.cwd()) => run(name, process.execPath, argv, { cwd });
  const sourceFiles = filesUnder(DIR).filter(file => file.endsWith('.mjs'));
  for (const file of sourceFiles) node('SYNTAX', ['--check', file]);
  node('RESEARCH_LINT', ['apps/customer-web/node_modules/eslint/bin/eslint.js', '--config', DIR + '/eslint.config.mjs', DIR]);
  stage = 'SHELL_BOUNDARY';
  for (const file of sourceFiles) {
    const text = readFileSync(file, 'utf8');
    for (const pair of [['node', ' -e'], ['python', ' -c'], ['pwsh', ' -Command'], ['Invoke', '-Expression'], ['cmd', ' /c']]) assert.equal(text.includes(pair.join('')), false);
    assert.equal(/shell\s*:\s*true/.test(text), false);
  }
  stage = 'RESEARCH_TESTS'; const tooling = toolingTests(), processes = processResultTests(), closeout = await closeoutTests(), writers = writerTests(secrets);
  const version = run('PYTEST_VERSION', 'docker', ['compose', '-f', 'docker-compose.backend-dev.yml', 'run', '--rm', '--no-deps', '--pull', 'never', 'quality', 'python', '-m', 'pytest', '--version']);
  assert.equal(version.toString().trim(), 'pytest 9.0.3');
  const imageBefore = inspectPreparedImage(image.imageId);
  const backendArgv = ['compose', '-f', 'docker-compose.backend-dev.yml', 'run', '--rm', '--no-deps', '--pull', 'never', 'quality',
    'python', '-m', 'pytest', 'tests/test_practice_acoustic_model_asset.py', 'tests/test_model_assets.py', '-q', '--no-header', '--tb=short', '-p', 'no:cacheprovider'];
  assertBackendTestArgv(backendArgv); stage = 'TARGETED_BACKEND_TESTS';
  const backendRaw = captureProcess('docker', backendArgv, { timeout: 90000 });
  const backend = sanitizedProcessResult(backendRaw, 'PREBUILT_QUALITY_TARGETED_MODEL_ASSET_TESTS', secrets);
  requireProcessSuccess(backendRaw, backend.semanticId, secrets); assert.equal(backend.passed, 7); assert.equal(backend.failed, 0);
  const imageAfter = inspectPreparedImage(image.imageId);
  const frontendOutput = node('FRONTEND_MODEL_ASSET_REGRESSIONS', ['node_modules/vitest/vitest.mjs', 'run', 'src/lib/model-assets/model-asset-store.test.ts',
    'src/lib/model-assets/verified-model-asset-loader.test.ts', 'src/lib/api/practice-acoustic-model-asset.test.ts',
    'src/lib/api/practice-acoustic-model-identity.test.ts', 'src/lib/practice/acoustic/model/inference.test.ts', '--reporter=json'], app).toString();
  const frontend = JSON.parse(frontendOutput.slice(frontendOutput.indexOf('{'))); assert.equal(frontend.success, true); assert.equal(frontend.numFailedTests, 0); assert.equal(frontend.numPendingTests, 0);
  node('TYPECHECK', ['node_modules/typescript/bin/tsc', '--noEmit', '--incremental', 'false'], app);
  node('PRODUCTION_LINT', ['node_modules/eslint/bin/eslint.js', 'src/lib/model-assets', 'src/lib/api/practice-acoustic-model-asset.ts',
    'src/lib/api/practice-acoustic-model-asset.test.ts', 'src/lib/practice/acoustic/model/model-inference.ts',
    'src/lib/practice/acoustic/model/acoustic-model-manifest.ts', 'src/lib/practice/step/step-microphone-platform.ts'], app);
  stage = 'EXTERNAL_IDENTITIES';
  const playwrightRoot = 'backend/research/browser_runtime/dr3r_browser_runtime/node_modules/playwright';
  const playwrightRequire = createRequire(path.resolve(playwrightRoot + '/package.json'));
  const playwrightCore = path.dirname(playwrightRequire.resolve('playwright-core/package.json'));
  const ortRoot = 'apps/customer-web/node_modules/onnxruntime-web'; assert.equal(load(ortRoot + '/package.json').version, '1.20.1');
  const execution = { chrome: rawFileIdentity('C:/Program Files/Google/Chrome/Application/chrome.exe', 'EXTERNAL_LOCAL_ASSET'),
    playwright: { root: playwrightRoot, version: load(playwrightRoot + '/package.json').version },
    externalTrees: [externalTreeIdentity(playwrightRoot, ['.js', '.json']), externalTreeIdentity(playwrightCore, ['.js', '.json']),
      externalTreeIdentity(path.dirname(require.resolve('vite/package.json')), ['.js', '.json', '.d.ts'])],
    ortAssets: filesUnder(ortRoot + '/dist').filter(file => /\.(mjs|wasm)$/.test(file))
      .map(file => ({ ...rawFileIdentity(file, 'EXTERNAL_LOCAL_ASSET'), route: '/__v42/ort/' + path.basename(file) })),
    ortPackage: rawFileIdentity(ortRoot + '/package.json', 'EXTERNAL_LOCAL_ASSET') };
  stage = 'FINAL_SOURCE_AND_SCOPE';
  mkdirSync(OUT, { recursive: true }); writeFileSync(OUT + '/entry.mjs', bundle.code);
  const harness = filesUnder(DIR).sort().map(file => rawFileIdentity(file));
  for (const file of [...filesUnder(DIR), OUT + '/entry.mjs']) {
    const text = readFileSync(file, 'utf8'); assert.equal(text.includes('\r'), false); assert.ok(text.endsWith('\n')); assert.equal(/[\t ]+\n/.test(text), false);
  }
  git('diff', '--check'); const diff = scope(); const security = scanFiles([DIR, OUT], secrets);
  remoteIdentity(START, false);
  const record = { stage: 'HARNESS_ENGINEERING', result: 'LOCAL_PASS_NOT_CI', completedAt: now(), startCommit: START,
    finalHarnessIdentities: harness, externalReadiness: { origin: input.origin, authMode: 'EXPLICIT_TEST_LOGIN_IN_MEMORY', priorLoginNotQualificationEvidence: true,
      customerWebDocumentStatus: targetResponse.status, noAuthOrModelRequestPerformed: true },
    product, qualityProof, preparedQuality: { image, pytestVersion: '9.0.3', imageBefore, imageAfter },
    researchTests: { tooling: tooling.tests.length, process: processes.tests.length, closeout: closeout.length, writers: writers.tests.length, allPass: true },
    writerCompatibility: writers,
    backend: { ...backend, commandArgv: backendArgv, service: 'quality', imageUnchanged: true },
    frontend: { passed: frontend.numPassedTests, failed: frontend.numFailedTests, localNotBrowserEvidence: true },
    typecheck: 'PASS', relevantLint: 'PASS', syntax: 'PASS', researchLint: 'PASS', shellBoundary: 'PASS',
    bundle: bundle.record, execution, secretScan: security, ...diff,
    counters: { browserCampaigns: 0, modelAccessRequests: 0, ossRequests: 0, modelSessions: 0, inferenceRuns: 0 } };
  save('preflight-summary.json', record, true); scanFiles([DIR, OUT], secrets);
  console.log(JSON.stringify({ result: 'STAGE_A_READY_NOT_QUALIFICATION_EVIDENCE', researchTests: record.researchTests,
    backendPassed: backend.passed, frontendPassed: frontend.numPassedTests, viteVersion: bundle.record.viteVersion, bundleSha256: bundle.record.bundleSha256 }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
  try { await ready(input); }
  catch (error) {
    const security = await import('./security.mjs'), text = String(error.stack ?? error);
    console.log(JSON.stringify({ result: 'V42_NOT_STARTED_PREQUALIFICATION_NOT_READY', activeLocalGate: stage, orchestratorBoundary: 'NONE',
      errorClass: error.name, safeCode: error.safeCode ?? 'HARNESS_ENGINEERING_NOT_READY', processDiagnostic: error.processDiagnostic ?? null,
      engineeringDiagnostic: security.scanText(text, Object.values(input.auth ?? {})).length ? 'REDACTED' : text.slice(0, 6000), qualificationDispositionCreated: false }));
    process.exitCode = 1;
  }
}
