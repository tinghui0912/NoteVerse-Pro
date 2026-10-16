import {spawnSync} from 'node:child_process';
import {mkdir, writeFile, readFile} from 'node:fs/promises';
import path from 'node:path';
const app = path.resolve(import.meta.dirname, '..');
const root = path.resolve(app, '../..');
const out = path.join(root, 'backend/data/work/continuous_product_core/v2');
await mkdir(out, {recursive: true});
const runs = [];
for (const [label, args] of [
  ['full-customer-web-vitest', ['node_modules/vitest/vitest.mjs', 'run', '--reporter=json', `--outputFile=${out}/vitest.json`]],
  ['full-typescript-noemit', ['node_modules/typescript/bin/tsc', '--noEmit', '--incremental', 'false']],
  ['repository-eslint', ['node_modules/eslint/bin/eslint.js', '.', '--format', 'json', '--output-file', `${out}/lint.json`]],
  ['full-next-production-build-webpack', ['node_modules/next/dist/bin/next', 'build', '--webpack']],
]) {
  const startedAt = new Date().toISOString();
  const result = spawnSync(process.execPath, args, {cwd: app, encoding: 'utf8', maxBuffer: 40 * 1024 * 1024,
    env: {...process.env, NEXT_BACKEND_ORIGIN: 'http://localhost:8000', AUTH_COOKIE_NAME: 'auth', REFRESH_COOKIE_NAME: 'refresh', NEXT_TELEMETRY_DISABLED: '1'}});
  const run = {label, command: [process.execPath, ...args], startedAt, completedAt: new Date().toISOString(),
    exitCode: result.status, signal: result.signal, error: result.error?.message ?? null, stdout: result.stdout, stderr: result.stderr};
  runs.push(run);
  console.log(JSON.stringify({label, exitCode: result.status, error: run.error}));
  await writeFile(path.join(out, 'checks.json'), JSON.stringify({runs}, null, 2) + '\n');
}
const tests = JSON.parse(await readFile(path.join(out, 'vitest.json'), 'utf8'));
const lint = JSON.parse(await readFile(path.join(out, 'lint.json'), 'utf8'));
const breakdown = {unitTestCount: tests.numTotalTests, passed: tests.numPassedTests, failed: tests.numFailedTests,
  testFiles: tests.testResults.length, historicalResearchTests: 'Archived byte-for-byte outside product suite, not migrated to new policy.',
  separateDspReferenceRuns: 0, browserInferenceRuns: 0,
  lintErrors: lint.reduce((n, file) => n + file.errorCount, 0), lintWarnings: lint.reduce((n, file) => n + file.warningCount, 0)};
await writeFile(path.join(out, 'checks.json'), JSON.stringify({runs, breakdown}, null, 2) + '\n');
if (runs.some(run => run.exitCode !== 0)) process.exitCode = 1;
