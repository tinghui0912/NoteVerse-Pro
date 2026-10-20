import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { scanText } from './security.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
let sensitiveValues = [];
export function setSensitiveValues(values) { sensitiveValues = values.filter(value => typeof value === 'string' && value.length > 0); }
export function reportSensitiveValues() { return [...sensitiveValues]; }
export function captureProcess(file, argv, options = {}, runner = spawnSync) {
  assert.ok(Array.isArray(argv) && argv.every(value => typeof value === 'string'), 'DIRECT_ARGV_REQUIRED');
  assert.ok(options.shell === undefined || options.shell === false, 'SHELL_EXECUTION_REJECTED');
  const started = Date.now();
  const result = runner(file, argv, { maxBuffer: 128 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'], ...options, shell: false });
  return { exitCode: result.status ?? null, signal: result.signal ?? null,
    stdout: Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout ?? ''),
    stderr: Buffer.isBuffer(result.stderr) ? result.stderr : Buffer.from(result.stderr ?? ''),
    error: result.error ? { name: result.error.name, code: result.error.code ?? null } : null,
    elapsedMs: Date.now() - started };
}
export function assertBackendTestArgv(argv) {
  assert.equal(argv[0], 'compose');
  assert.equal(argv.includes('build'), false, 'NO_IMAGE_BUILD_DURING_V43_QUALIFICATION');
  assert.equal(argv.includes('--build'), false, 'NO_IMAGE_BUILD_DURING_V43_QUALIFICATION');
  assert.equal(argv.includes('--no-build'), false, 'COMPOSE_RUN_NO_BUILD_FLAG_INVALID');
  const mode = argv.findIndex(value => value === 'run' || value === 'exec');
  assert.ok(mode >= 0, 'COMPOSE_TEST_OPERATION_REQUIRED');
  let index = mode + 1;
  while (argv[index]?.startsWith('-')) {
    if (argv[index] === '--pull') { assert.equal(argv[index + 1], 'never', 'NO_IMAGE_PULL'); index += 2; }
    else { assert.ok(['--rm', '--no-deps'].includes(argv[index]), 'UNAUTHORIZED_COMPOSE_RUN_OPTION'); index++; }
  }
  const service = argv[index];
  assert.equal(service, 'quality', 'BACKEND_TESTS_MUST_NOT_EXECUTE_IN_API_RUNTIME_CONTAINER');
  assert.deepEqual(argv.slice(index + 1, index + 4), ['python', '-m', 'pytest']);
  assert.equal(argv[mode], 'run', 'DEDICATED_EPHEMERAL_QUALITY_SERVICE_REQUIRED');
  assert.ok(argv.slice(mode, index).includes('--rm'));
  assert.ok(argv.slice(mode, index).includes('--no-deps'), 'NO_DEPENDENCY_SERVICE_STARTUP');
  assert.ok(argv.slice(mode, index).includes('--pull'), 'EXPLICIT_NEVER_PULL_POLICY_REQUIRED');
  return { service, operation: 'run', invariant: 'NO_IMAGE_BUILD_DURING_V43_QUALIFICATION', build: false, pull: false };
}
export function failureCategory(result) {
  if (result.orchestratorBoundary && result.orchestratorBoundary !== 'NONE') return 'OUTER_ORCHESTRATOR_TRANSPORT_FAILURE';
  const text = result.stdout.toString('utf8') + '\n' + result.stderr.toString('utf8');
  if (/No module named ['"]?pytest|pytest: (?:not found|command not found)/i.test(text)) return 'QUALITY_IMAGE_PYTEST_RUNTIME_CONTRACT_FAILED';
  if (/No such image|image.+not found/i.test(text)) return 'QUALITY_IMAGE_UNAVAILABLE';
  if (/failed to (?:solve|build)|Cannot connect to the Docker daemon|docker daemon is not running|pull access denied|error during connect|failed to resolve source metadata|no such service/i.test(text)) return 'ENVIRONMENT_INFRASTRUCTURE_FAILURE';
  if (/ERROR collecting|ImportError while importing|ModuleNotFoundError|error during collection/i.test(text)) return 'PYTEST_COLLECTION_OR_IMPORT_ERROR';
  if (/FAILED\s+tests\/[^\s]+|AssertionError|assert\s+.+\s*==/i.test(text)) return 'CONCRETE_TEST_ASSERTION_FAILURE';
  if (result.error || result.signal) return 'CHILD_PROCESS_INFRASTRUCTURE_FAILURE';
  if (/connection refused|timed out|network is unreachable|name resolution|temporary failure/i.test(text)) return 'ENVIRONMENT_INFRASTRUCTURE_FAILURE';
  return 'UNKNOWN_CHILD_PROCESS_FAILURE';
}
export function sanitizedProcessResult(result, semanticId, secrets = sensitiveValues) {
  // Both exact streams are inspected in memory before any child text may be persisted.
  const out = result.stdout.toString('utf8'), err = result.stderr.toString('utf8');
  const unsafe = scanText(out, secrets).length > 0 || scanText(err, secrets).length > 0;
  const record = { semanticId, exitCode: result.exitCode, signal: result.signal, error: result.error,
    elapsedMs: result.elapsedMs, stdoutBytes: result.stdout.length, stderrBytes: result.stderr.length,
    stdoutSha256: digest(result.stdout), stderrSha256: digest(result.stderr),
    outputPolicy: unsafe ? 'OUTPUT_REDACTED_FOR_SECRET_SAFETY' : 'SECRET_SCAN_PASS_COMPACT_ONLY' };
  if (result.exitCode === 0 && !result.error && !result.signal) {
    const passed = out.match(/(?:^|\s)(\d+) passed\b/), failed = out.match(/(?:^|\s)(\d+) failed\b/);
    return { ...record, passed: passed ? Number(passed[1]) : null, failed: failed ? Number(failed[1]) : 0 };
  }
  record.causalCategory = failureCategory(result);
  if (!unsafe) {
    const bounded = text => text.length <= 6000 ? text : text.slice(0, 1500) + '\n[BOUNDED_DIAGNOSTIC_MIDDLE_OMITTED]\n' + text.slice(-4500);
    record.stdoutDiagnostic = bounded(out); record.stderrDiagnostic = bounded(err);
    record.safeFailedTestNodeIds = [...new Set((out + '\n' + err).match(/tests\/[a-zA-Z0-9_./-]+\.py(?:::[a-zA-Z0-9_\-[\]]+)+/g) ?? [])];
  }
  return record;
}
export function requireProcessSuccess(result, semanticId, secrets = sensitiveValues) {
  if (result.exitCode !== 0 || result.signal || result.error) {
    const diagnostic = sanitizedProcessResult(result, semanticId, secrets);
    throw Object.assign(Error('MANDATORY_CHILD_PROCESS_FAILED'), { safeCode: diagnostic.causalCategory, processDiagnostic: diagnostic });
  }
  return result.stdout;
}
