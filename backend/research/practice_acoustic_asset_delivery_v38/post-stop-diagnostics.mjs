import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { load, save, OUT, now } from './io.mjs';

// Availability observations only: the failed pytest command is never executed again.
const failure = load(OUT + '/first-failure.json');
assert.equal(failure.firstFailedGate, 'EXISTING_BACKEND_MODEL_ASSET_TESTS');
const prefix = ['compose', '-f', 'docker-compose.backend-dev.yml'];
const observations = [];
function probe(name, argv, summarize) {
  const result = spawnSync('docker', [...prefix, ...argv], { shell: false, encoding: 'utf8', maxBuffer: 1024 * 1024 });
  observations.push({ name, exitCode: result.status, available: result.status === 0,
    ...summarize(result.stdout ?? '', result.stderr ?? '') });
}
probe('RUNNING_API_CONTAINER', ['ps', '--status', 'running', '-q', 'api'], text => ({ present: text.trim().length > 0 }));
probe('PYTHON_RUNTIME', ['exec', '-T', 'api', 'python', '--version'], text => ({ version: text.match(/Python [0-9.]+/)?.[0] ?? null }));
probe('PYTEST_PACKAGE_AVAILABILITY', ['exec', '-T', 'api', 'python', '-m', 'pip', 'show', 'pytest'], text => ({ version: text.match(/^Version: ([0-9.]+)$/m)?.[1] ?? null }));
for (const file of ['tests/test_practice_acoustic_model_asset.py', 'tests/test_model_assets.py']) {
  probe('CONTAINER_REQUIRED_TEST_FILE', ['exec', '-T', 'api', 'test', '-f', file], () => ({ path: file }));
}
save('post-stop-availability-diagnostics.json', { observedAt: now(), firstFailureUnchanged: true,
  purpose: 'Read-only availability observations after permanent stop; not a qualification gate or test retry',
  failedCommandRepeated: false, browserLaunches: 0, accessRequests: 0, ossRequests: 0, observations,
  causalLimit: 'Original child stderr was not retained by the frozen-in-preparation runner. No raw stderr or secret-bearing text is reconstructed or persisted.' });
console.log(JSON.stringify({ observations, qualificationRemainsPermanentlyBlocked: true }));
