import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export const REQUIRED = [
  'apps/customer-web/src/lib/app-protocol.ts', 'apps/customer-web/next.config.ts', 'apps/customer-web/src/lib/api-client.ts',
  'apps/customer-web/src/lib/api/practice-acoustic-model-asset.ts', 'apps/customer-web/src/lib/model-assets/model-asset-store.ts',
  'apps/customer-web/src/lib/model-assets/verified-model-asset-loader.ts',
  'apps/customer-web/src/lib/practice/acoustic/model/acoustic-model-manifest.ts',
  'apps/customer-web/src/lib/practice/acoustic/model/model-inference.ts', 'apps/customer-web/src/lib/practice/acoustic/model/worker-client.ts',
  'apps/customer-web/src/lib/practice/step/step-microphone-platform.ts', 'backend/app/api/deps.py',
  'backend/app/modules/model_assets/router.py', 'backend/app/modules/model_assets/service.py', 'backend/app/modules/model_assets/schemas.py',
  'backend/app/core/settings/model_asset_delivery.py', 'backend/app/core/settings/browser_cors.py',
  'backend/app/core/settings/customer_session_security.py', 'backend/tests/test_practice_acoustic_model_asset.py', 'backend/tests/test_model_assets.py'
];

// The injected runner is a direct Git process byte stream, never rendered terminal/tool text.
function directBytes(run, args) {
  const result = run(args);
  assert.ok(Buffer.isBuffer(result), 'DIRECT_GIT_PROCESS_BUFFER_REQUIRED');
  return result;
}
export function verifyRequiredPath(run, startCommit, sourcePath, expectedBlob = null) {
  directBytes(run, ['cat-file', '-e', startCommit + ':' + sourcePath]);
  const blobSha = directBytes(run, ['rev-parse', startCommit + ':' + sourcePath]).toString('utf8').trim();
  assert.match(blobSha, /^[0-9a-f]{40}$/);
  const objectType = directBytes(run, ['cat-file', '-t', blobSha]).toString('utf8').trim();
  assert.equal(objectType, 'blob', 'REQUIRED_FILE_IS_NOT_BLOB');
  const rows = directBytes(run, ['ls-tree', '-z', startCommit, '--', sourcePath]).toString('utf8').split('\0').filter(Boolean);
  assert.equal(rows.length, 1, 'EXACTLY_ONE_REQUIRED_BLOB');
  const tab = rows[0].indexOf('\t'), fields = rows[0].slice(0, tab).split(' ');
  assert.equal(rows[0].slice(tab + 1), sourcePath); assert.equal(fields[1], 'blob'); assert.equal(fields[2], blobSha);
  if (expectedBlob !== null) assert.equal(blobSha, expectedBlob, 'UNEXPECTED_BLOB_IDENTITY_CHANGE');
  return { path: sourcePath, exists: true, objectType, blobSha, startCommit };
}
export function validateRequiredRecords(records, paths) {
  assert.equal(new Set(paths).size, paths.length, 'DUPLICATE_REQUIRED_PATH');
  assert.equal(records.length, paths.length);
  assert.equal(new Set(records.map(r => r.path)).size, records.length, 'DUPLICATE_REQUIRED_PATH_RECORD');
  for (const p of paths) {
    const matches = records.filter(r => r.path === p); assert.equal(matches.length, 1);
    assert.equal(matches[0].exists, true); assert.equal(matches[0].objectType, 'blob'); assert.match(matches[0].blobSha, /^[0-9a-f]{40}$/);
  }
  return records;
}
export function verifyRequiredPaths(run, startCommit, paths = REQUIRED) {
  assert.equal(new Set(paths).size, paths.length, 'DUPLICATE_REQUIRED_PATH');
  return validateRequiredRecords(paths.map(p => verifyRequiredPath(run, startCommit, p)), paths);
}
export function summarizeInternalInventory(raw, startCommit, required) {
  assert.ok(Buffer.isBuffer(raw), 'INTERNAL_BINARY_INVENTORY_REQUIRED');
  assert.ok(raw.length > 0 && raw.at(-1) === 0, 'NUL_TERMINATED_INTERNAL_INVENTORY_REQUIRED');
  const paths = raw.toString('utf8').split('\0').filter(Boolean), membership = new Set(paths);
  assert.equal(membership.size, paths.length, 'DUPLICATE_INTERNAL_TREE_PATH');
  return { startCommit, entryCount: paths.length, rawInventoryByteCount: raw.length,
    rawInventorySha256: createHash('sha256').update(raw).digest('hex'), requiredPathCount: required.length,
    allRequiredPathsPresent: required.every(p => membership.has(p)), inputAuthority: 'DIRECT_CHILD_PROCESS_BINARY_BYTES', fullPathInventoryPersisted: false };
}
export function rejectDisplayedInventory() {
  throw Error('DISPLAYED_INVENTORY_IS_NEVER_MEMBERSHIP_AUTHORITY');
}
