import { expect, it, vi } from 'vitest';
import { apiClient } from '../api-client';
import { assertPracticeAcousticModelAccess, getPracticeAcousticModelAccess } from './practice-acoustic-model-asset';
vi.mock('../api-client', () => ({ apiClient: { get: vi.fn() } }));
import { ACOUSTIC_MODEL_ASSET_DESCRIPTOR as descriptor } from '../practice/acoustic/generated/runtime-contract';
const access = { ...descriptor, downloadUrl: 'https://example.invalid/model.onnx',
  downloadUrlExpiresAt: '2099-01-01T00:00:00Z' };
it('loads only the shared immutable model endpoint', async () => {
  vi.mocked(apiClient.get).mockResolvedValue({ data: access });
  expect(await getPracticeAcousticModelAccess()).toEqual(access);
  expect(vi.mocked(apiClient.get).mock.calls.at(-1)?.[0]).toBe('/model-assets/practice-acoustic/access');
});
for (const [key, value] of Object.entries({ assetId: 'unconfigured', assetVersion: 'other', expectedByteSize: descriptor.expectedByteSize + 1,
  sha256: '0'.repeat(64), schemaVersion: 2, mediaType: 'text/plain',
  downloadUrl: 'http://example.invalid', downloadUrlExpiresAt: '2000-01-01' })) it(`rejects changed ${key}`, () => {
  expect(() => assertPracticeAcousticModelAccess({ ...access, [key]: value })).toThrow();
});
