import { spawnSync } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, APP, WORK, newJson, verify, hash } from './protocol.mjs';

const proof = await verify(), work = path.join(WORK, 'verification');
await mkdir(work, { recursive: true });
const results = [];
for (const [name, args] of [
  ['vitest', ['node_modules/vitest/vitest.mjs', 'run', '--reporter=json', '--outputFile=' + path.join(work, 'vitest.json')]],
  ['typecheck', ['node_modules/typescript/bin/tsc', '--noEmit', '--pretty', 'false']],
  ['lint', ['node_modules/eslint/bin/eslint.js', '.', '--format=json']],
  ['build', ['node_modules/next/dist/bin/next', 'build', '--webpack']],
]) {
  const startedAt = new Date().toISOString(); console.log('START', name);
  const result = spawnSync(process.execPath, args, { cwd: APP, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', NEXT_BACKEND_ORIGIN: 'http://localhost:8000', AUTH_COOKIE_NAME: 'auth', REFRESH_COOKIE_NAME: 'refresh' } });
  await writeFile(path.join(work, name + '.stdout.txt'), result.stdout ?? '');
  await writeFile(path.join(work, name + '.stderr.txt'), result.stderr ?? '');
  const row = { name, args, startedAt, completedAt: new Date().toISOString(), exitCode: result.status,
    stdoutSha256: hash(result.stdout ?? ''), stderrSha256: hash(result.stderr ?? '') };
  if (name === 'lint') row.messages = JSON.parse(result.stdout).flatMap(file => file.messages.map(m => ({
    path: path.relative(APP, file.filePath).replaceAll('\\', '/'), rule: m.ruleId, message: m.message,
    severity: m.severity, line: m.line, column: m.column })));
  if (name === 'vitest') {
    const suite = JSON.parse(await readFile(path.join(work, 'vitest.json'), 'utf8'));
    row.counts = { totalTests: suite.numTotalTests, passedTests: suite.numPassedTests, failedTests: suite.numFailedTests,
      testFiles: suite.testResults.length, runnerSuiteCount: suite.numTotalTestSuites, success: suite.success };
    row.testFiles = suite.testResults.map(t => ({ path: path.relative(APP, t.name).replaceAll('\\', '/'), status: t.status, tests: t.assertionResults.length }));
  }
  results.push(row); console.log('END', name, result.status, row.counts ?? row.messages ?? '');
}
const backend = spawnSync('docker', ['run', '--rm', '--env-file', path.join(ROOT, 'backend/.env.docker'), '--mount', `type=bind,source=${ROOT},target=/workspace`,
  '-w', '/workspace/backend', '--entrypoint', 'python', 'noteverse-backend-api:dev', '-m', 'unittest', 'tests.test_continuous_model_asset', '-v'], { encoding: 'utf8' });
results.push({ name: 'Docker backend asset unittest', exitCode: backend.status, output: (backend.stdout ?? '') + (backend.stderr ?? '') });
await newJson(path.join(WORK, 'verification.json'), { proof, results, status: results.every(r => r.exitCode === 0) ? 'PASS' : 'FAIL' });
if (results.some(r => r.exitCode !== 0)) process.exitCode = 1;
