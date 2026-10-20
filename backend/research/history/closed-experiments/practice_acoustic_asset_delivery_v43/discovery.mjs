import assert from 'node:assert/strict';
import { captureProcess, requireProcessSuccess } from './process-result.mjs';
import { createHash } from 'node:crypto';

export const START = '83d6c1590cf88ff42dd32f8856d4081f7927cb1d';
export const BRANCH = 'codex/customer-web-delivery-boundary';
export const DIR = 'backend/research/practice_acoustic_asset_delivery_v43';
export const OUT = 'backend/research/reports/practice_acoustic_asset_delivery_v43';
export const REQUIRED = [
  'apps/customer-web/src/lib/app-protocol.ts', 'apps/customer-web/next.config.ts',
  'apps/customer-web/src/lib/api-client.ts', 'apps/customer-web/src/lib/api/practice-acoustic-model-asset.ts',
  'apps/customer-web/src/lib/model-assets/model-asset-store.ts',
  'apps/customer-web/src/lib/model-assets/verified-model-asset-loader.ts',
  'apps/customer-web/src/lib/practice/acoustic/model/acoustic-model-manifest.ts',
  'apps/customer-web/src/lib/practice/acoustic/model/model-inference.ts',
  'apps/customer-web/src/lib/practice/acoustic/model/worker-client.ts',
  'apps/customer-web/src/lib/practice/step/step-microphone-platform.ts', 'backend/app/api/deps.py',
  'backend/app/modules/model_assets/router.py', 'backend/app/modules/model_assets/service.py',
  'backend/app/modules/model_assets/schemas.py', 'backend/app/core/settings/model_asset_delivery.py',
  'backend/app/core/settings/browser_cors.py', 'backend/app/core/settings/customer_session_security.py',
  'backend/tests/test_practice_acoustic_model_asset.py', 'backend/tests/test_model_assets.py',
  'docker-compose.backend-dev.yml', 'docker/backend/Dockerfile.api', 'docker/backend/Dockerfile.quality',
  'backend/requirements/api.txt', 'backend/requirements/quality-core.txt', 'backend/requirements/quality-tools.txt',
  'scripts/backend_quality_docker.ps1', 'backend/README.md', '.github/workflows/backend-quality.yml'
];
export const gitBytes = (...args) => requireProcessSuccess(captureProcess('git', args), 'DIRECT_GIT_' + args[0]);
export const git = (...args) => gitBytes(...args).toString('utf8').trim();
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function verifyPath(run, commit, file, expected = null) {
  const bytes = args => { const result = run(args); assert.ok(Buffer.isBuffer(result)); return result; };
  bytes(['cat-file', '-e', commit + ':' + file]);
  const blobSha = bytes(['rev-parse', commit + ':' + file]).toString().trim();
  assert.match(blobSha, /^[a-f0-9]{40}$/);
  assert.equal(bytes(['cat-file', '-t', blobSha]).toString().trim(), 'blob');
  const rows = bytes(['ls-tree', '-z', commit, '--', file]).toString().split('\0').filter(Boolean);
  assert.equal(rows.length, 1);
  assert.equal(rows[0], '100644 blob ' + blobSha + '\t' + file);
  if (expected !== null) assert.equal(blobSha, expected);
  return { path: file, exists: true, objectType: 'blob', blobSha, startCommit: commit };
}
export function verifyPaths(run, commit, paths) {
  assert.equal(new Set(paths).size, paths.length);
  return paths.map(file => verifyPath(run, commit, file));
}
export function summarizeInventory(raw) {
  assert.ok(Buffer.isBuffer(raw)); assert.equal(raw.at(-1), 0);
  const paths = raw.toString().split('\0').filter(Boolean);
  assert.equal(new Set(paths).size, paths.length);
  return { entryCount: paths.length, rawByteCount: raw.length, sha256: sha256(raw) };
}
export function rejectDisplayedInventory() { throw Error('DISPLAY_OUTPUT_IS_NEVER_AUTHORITY'); }
