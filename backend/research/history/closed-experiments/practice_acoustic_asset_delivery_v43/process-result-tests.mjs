import assert from 'node:assert/strict';
import { captureProcess, assertBackendTestArgv, sanitizedProcessResult } from './process-result.mjs';
import { requireImageIdentity, failureContext } from './quality-image.mjs';

export function processResultTests() {
  const tests = [], test = (name, fn) => { fn(); tests.push({ name, result: 'PASS' }); };
  const quality = ['compose', '-f', 'docker-compose.backend-dev.yml', 'run', '--rm', '--no-deps', '--pull', 'never', 'quality', 'python', '-m', 'pytest'];
  test('API runtime exec rejected', () => assert.throws(() => assertBackendTestArgv(['compose', 'exec', 'api', 'python', '-m', 'pytest'])));
  test('API runtime run rejected', () => assert.throws(() => assertBackendTestArgv(quality.map(s => s === 'quality' ? 'api' : s))));
  test('dedicated quality run accepted', () => assert.equal(assertBackendTestArgv(quality).service, 'quality'));
  const fixture = (stdout, stderr, status = 1) => captureProcess('synthetic', ['direct-argument'], {}, () => ({
    status, signal: null, stdout: Buffer.from(stdout), stderr: Buffer.from(stderr) }));
  test('nonzero preserves status and both streams', () => {
    const result = fixture('first stream', 'second stream', 7);
    assert.equal(result.exitCode, 7); assert.equal(result.stdout.toString(), 'first stream'); assert.equal(result.stderr.toString(), 'second stream');
  });
  test('missing pytest has distinct category', () => assert.equal(sanitizedProcessResult(fixture('', 'No module named pytest'), 'UNIT').causalCategory, 'QUALITY_IMAGE_PYTEST_RUNTIME_CONTRACT_FAILED'));
  test('safe assertion preserves node ID and category', () => {
    const record = sanitizedProcessResult(fixture('FAILED tests/test_asset.py::test_identity - AssertionError', ''), 'UNIT');
    assert.equal(record.causalCategory, 'CONCRETE_TEST_ASSERTION_FAILURE');
    assert.deepEqual(record.safeFailedTestNodeIds, ['tests/test_asset.py::test_identity']);
    assert.ok(record.stdoutDiagnostic.includes('AssertionError'));
  });
  test('safe collection failure distinguished', () => assert.equal(sanitizedProcessResult(fixture('', 'ERROR collecting tests/test_asset.py\nModuleNotFoundError: package'), 'UNIT').causalCategory, 'PYTEST_COLLECTION_OR_IMPORT_ERROR'));
  test('Docker infrastructure failure distinguished', () => assert.equal(sanitizedProcessResult(fixture('', 'Cannot connect to the Docker daemon'), 'UNIT').causalCategory, 'ENVIRONMENT_INFRASTRUCTURE_FAILURE'));
  test('secret stdout redacted before persistence', () => {
    const secret = 'synthetic' + 'private'.repeat(8);
    const record = sanitizedProcessResult(fixture('output ' + secret, 'No module named pytest'), 'UNIT', [secret]);
    assert.equal(record.outputPolicy, 'OUTPUT_REDACTED_FOR_SECRET_SAFETY');
    assert.equal(record.causalCategory, 'QUALITY_IMAGE_PYTEST_RUNTIME_CONTRACT_FAILED');
    assert.ok(!JSON.stringify(record).includes(secret)); assert.equal(record.stdoutDiagnostic, undefined);
  });
  test('secret stderr redacted before persistence', () => {
    const secret = 'synthetic' + 'private'.repeat(8), record = sanitizedProcessResult(fixture('safe', 'output ' + secret), 'UNIT', [secret]);
    assert.equal(record.outputPolicy, 'OUTPUT_REDACTED_FOR_SECRET_SAFETY'); assert.equal(record.stderrDiagnostic, undefined);
  });
  test('shell-based execution rejected before runner', () => {
    let reached = false;
    const unsafeOptions = {}; unsafeOptions.shell = Boolean(1);
    assert.throws(() => captureProcess('synthetic', [], unsafeOptions, () => { reached = true; }));
    assert.equal(reached, false);
  });
  test('successful test output compact only', () => {
    const record = sanitizedProcessResult(fixture('7 passed in 1.00s', '', 0), 'UNIT');
    assert.equal(record.passed, 7); assert.equal(record.failed, 0); assert.equal(record.stdoutDiagnostic, undefined);
  });
  test('V39 cold-build flag in qualification rejected', () => assert.throws(() => assertBackendTestArgv([...quality.slice(0, 5), '--build', ...quality.slice(5)])));
  test('compose build operation rejected', () => assert.throws(() => assertBackendTestArgv(['compose', 'build', 'quality'])));
  test('unsupported no-build flag rejected', () => assert.throws(() => assertBackendTestArgv([...quality.slice(0, 5), '--no-build', ...quality.slice(5)])));
  test('pull policy other than never rejected', () => assert.throws(() => assertBackendTestArgv(quality.map(s => s === 'never' ? 'always' : s))));
  const id = 'sha256:' + 'a'.repeat(64);
  test('prebuilt image accepted', () => assert.equal(requireImageIdentity({ imageId: id }, id).imageId, id));
  test('image ID changed rejected', () => assert.throws(() => requireImageIdentity({ imageId: 'sha256:' + 'b'.repeat(64) }, id)));
  test('expected image absent rejected', () => assert.throws(() => requireImageIdentity(null, id)));
  test('outer timeout cannot become assertion failure', () => {
    const result = fixture('FAILED tests/test_asset.py::test_identity - AssertionError', '');
    result.orchestratorBoundary = 'MCP_TRANSPORT_TIMEOUT';
    assert.equal(sanitizedProcessResult(result, 'UNIT').causalCategory, 'OUTER_ORCHESTRATOR_TRANSPORT_FAILURE');
  });
  test('local gate and orchestrator boundary are independent', () => {
    const running = failureContext('EXISTING_BACKEND_MODEL_ASSET_TESTS');
    const stopped = failureContext(running.activeLocalGate, 'MCP_TRANSPORT_TIMEOUT', true);
    assert.equal(running.orchestratorBoundary, 'NONE'); assert.equal(stopped.activeLocalGate, running.activeLocalGate);
    assert.equal(stopped.terminalCause, 'OUTER_ORCHESTRATOR_TRANSPORT_FAILURE'); assert.equal(stopped.childProcessLive, true);
  });
  return { result: 'LOCAL_PASS_NOT_CI', tests };
}
