import { expect, it, vi } from 'vitest';
import { apiClient } from '../api-client';
import { assertPracticeAcousticModelAccess, getPracticeAcousticModelAccess } from './practice-acoustic-model-asset';
vi.mock('../api-client', () => ({ apiClient: { get: vi.fn() } }));
const access = { schemaVersion: 1, assetId: 'practice-acoustic-robust-browser', assetVersion: 'v1',
  expectedByteSize: 98689283, sha256: '4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3',
  mediaType: 'application/octet-stream', downloadUrl: 'https://example.invalid/model.onnx',
  downloadUrlExpiresAt: '2099-01-01T00:00:00Z' };
it('loads only the shared immutable model endpoint', async () => {
  vi.mocked(apiClient.get).mockResolvedValue({ data: access });
  expect(await getPracticeAcousticModelAccess()).toEqual(access);
  expect(vi.mocked(apiClient.get).mock.calls.at(-1)?.[0]).toBe('/model-assets/practice-acoustic-robust-browser-v1/access');
});
for (const [key, value] of Object.entries({ assetId: 'continuous-robust-browser', assetVersion: 'other', expectedByteSize: 98691493,
  sha256: '6ba3bc4e73607f9cd021e69858fd3ff969a3941c7a93876d5be5cedb53038cf5', schemaVersion: 2, mediaType: 'text/plain',
  downloadUrl: 'http://example.invalid', downloadUrlExpiresAt: '2000-01-01' })) it(`rejects changed ${key}`, () => {
  expect(() => assertPracticeAcousticModelAccess({ ...access, [key]: value })).toThrow();
});
