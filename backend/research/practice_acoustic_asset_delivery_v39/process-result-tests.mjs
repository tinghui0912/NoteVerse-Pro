import assert from 'node:assert/strict';
import { captureProcess, assertBackendTestArgv, sanitizedProcessResult } from './process-result.mjs';

export function processResultTests() {
  const tests = [], test = (name, fn) => { fn(); tests.push({ name, result: 'PASS' }); };
  const quality = ['compose', '-f', 'docker-compose.backend-dev.yml', 'run', '--rm', '--build', 'quality', 'python', '-m', 'pytest'];
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
  test('Docker build failure distinguished', () => assert.equal(sanitizedProcessResult(fixture('', 'failed to solve: failed to build'), 'UNIT').causalCategory, 'DOCKER_COMPOSE_IMAGE_BUILD_OR_START_FAILURE'));
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
  return { result: 'LOCAL_PASS_NOT_CI', tests };
}
