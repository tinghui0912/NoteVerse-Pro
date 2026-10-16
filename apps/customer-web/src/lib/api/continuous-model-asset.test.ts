import { expect, it } from 'vitest';
import { assertContinuousModelAccess } from './continuous-model-asset';
const valid = () => ({ schemaVersion: 1, assetId: 'continuous-robust-browser', assetVersion: 'v1',
  expectedByteSize: 98689283, sha256: '4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3',
  mediaType: 'application/octet-stream', downloadUrl: 'https://example.invalid/immutable.onnx',
  downloadUrlExpiresAt: new Date(Date.now() + 60000).toISOString() });
it('accepts only the exact versioned Continuous asset descriptor', () => { expect(() => assertContinuousModelAccess(valid())).not.toThrow(); });
it.each([
  { expectedByteSize: 98691493 }, { sha256: '6ba3bc4e73607f9cd021e69858fd3ff969a3941c7a93876d5be5cedb53038cf5' },
  { assetVersion: 'v2' }, { downloadUrl: 'http://example.invalid/model' }, { downloadUrlExpiresAt: '2000-01-01T00:00:00Z' },
])('rejects mismatched identity/expiry without model fallback: %j', change => {
  expect(() => assertContinuousModelAccess({ ...valid(), ...change })).toThrow('CONTINUOUS_MODEL_ACCESS_IDENTITY_MISMATCH');
});
