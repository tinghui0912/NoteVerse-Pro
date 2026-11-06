import { expect, it } from 'vitest';
import { assertPracticeAcousticModelAccess } from './practice-acoustic-model-asset';
import { ACOUSTIC_MODEL_ASSET_DESCRIPTOR as descriptor } from '../practice/acoustic/generated/runtime-contract';
const valid = () => ({
  ...descriptor, downloadUrl: 'https://example.invalid/immutable.onnx',
  downloadUrlExpiresAt: new Date(Date.now() + 60000).toISOString() });
it('accepts only the exact versioned Practice acoustic asset descriptor', () => { expect(() => assertPracticeAcousticModelAccess(valid())).not.toThrow(); });
it.each([
  { expectedByteSize: descriptor.expectedByteSize + 1 }, { sha256: '0'.repeat(64) },
  { assetVersion: 'unconfigured' }, { downloadUrl: 'http://example.invalid/model' }, { downloadUrlExpiresAt: '2000-01-01T00:00:00Z' },
])('rejects mismatched identity/expiry without model fallback: %j', change => {
  expect(() => assertPracticeAcousticModelAccess({ ...valid(), ...change })).toThrow('PRACTICE_ACOUSTIC_MODEL_ACCESS_IDENTITY_MISMATCH');
});
