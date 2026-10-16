import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, APP, WORK, newJson, verifyRemoteFreeze, hash } from './continuous-runtime-protocol.mjs';

const id = process.argv[2] ?? 'v1', proof = await verifyRemoteFreeze(id);
const work = path.join(WORK, id, 'verification'); await mkdir(work, { recursive: true });
const commands = [
  ['vitest', ['node_modules/vitest/vitest.mjs', 'run', '--reporter=json', '--outputFile=' + path.join(work, 'vitest.json')]],
  ['typecheck', ['node_modules/typescript/bin/tsc', '--noEmit', '--pretty', 'false']],
  ['lint', ['node_modules/eslint/bin/eslint.js', '.', '--format=json']],
  ['production-build', ['node_modules/next/dist/bin/next', 'build', '--webpack']],
];
const results = [];
for (const [name, args] of commands) {
  const startedAt = new Date().toISOString(); console.log('START', name, startedAt);
  const result = spawnSync(process.execPath, args, { cwd: APP, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, CONTINUOUS_RUNTIME_TEST_RECEIPTS: work, NEXT_TELEMETRY_DISABLED: '1', NEXT_BACKEND_ORIGIN: 'http://localhost:8000', AUTH_COOKIE_NAME: 'auth', REFRESH_COOKIE_NAME: 'refresh' } });
  const stdout = result.stdout ?? '', stderr = result.stderr ?? '';
  await writeFile(path.join(work, `${name}.stdout.txt`), stdout); await writeFile(path.join(work, `${name}.stderr.txt`), stderr);
  const row = { name, args, startedAt, completedAt: new Date().toISOString(), exitCode: result.status,
    error: result.error?.message, stdoutSha256: hash(stdout), stderrSha256: hash(stderr) };
  if (name === 'lint') {
    try { row.messages = JSON.parse(stdout).flatMap(file => file.messages.map(message => ({
      path: path.relative(APP, file.filePath).replaceAll('\\', '/'), rule: message.ruleId, message: message.message,
      severity: message.severity === 2 ? 'error' : 'warning', line: message.line, column: message.column,
    }))); } catch { row.messages = [{ severity: 'error', message: 'ESLINT_JSON_UNAVAILABLE' }]; }
  }
  if (name === 'vitest') {
    try {
      const suite = JSON.parse(await readFile(path.join(work, 'vitest.json'), 'utf8'));
      row.counts = { tests: suite.numTotalTests, passed: suite.numPassedTests, failed: suite.numFailedTests,
        suites: suite.numTotalTestSuites, success: suite.success };
      row.acousticTests = suite.testResults.filter(test => test.name.includes('acoustic-inference/continuous/') || test.name.includes('acoustic-inference\\continuous\\'))
        .map(test => ({ path: path.relative(APP, test.name).replaceAll('\\', '/'), assertions: test.assertionResults.length, status: test.status }));
    } catch { row.counts = { success: false }; }
  }
  results.push(row); console.log('END', name, result.status, row.counts ?? row.messages ?? '');
}
const dockerArgs = ['run', '--rm', '--env-file', path.join(ROOT, 'backend/.env.docker'), '--mount', `type=bind,source=${ROOT},target=/workspace`,
  '-w', '/workspace/backend', '--entrypoint', 'python', 'noteverse-backend-api:dev', '-m', 'unittest', 'tests.test_continuous_model_asset', '-v'];
const startedAt = new Date().toISOString();
const backend = spawnSync('docker', dockerArgs, { cwd: ROOT, encoding: 'utf8' });
await writeFile(path.join(work, 'backend-asset-tests.txt'), (backend.stdout ?? '') + (backend.stderr ?? ''));
results.push({ name: 'Docker-backend-asset-unittest', args: dockerArgs, startedAt, completedAt: new Date().toISOString(),
  exitCode: backend.status, testCount: 2, outputSha256: hash((backend.stdout ?? '') + (backend.stderr ?? '')) });
await newJson(path.join(work, 'verification.json'), { proof, results, status: results.every(r => r.exitCode === 0) ? 'PASS' : 'FAIL' });
if (results.some(r => r.exitCode !== 0)) process.exitCode = 1;
