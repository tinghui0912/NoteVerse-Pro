import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiClient } from '../api-client';
import { modelAssetsApi } from './model-assets';

vi.mock('../api-client', () => ({
  apiClient: {
    get: vi.fn(),
  },
}));

const EXPECTED_ACCESS = {
  schemaVersion: 1,
  assetId: 'bytedance-piano-transcription-note-model',
  assetVersion: 'CRNN_note_F1_0.9677_pedal_F1_0.9186',
  expectedByteSize: 98_691_493,
  sha256: '6ba3bc4e73607f9cd021e69858fd3ff969a3941c7a93876d5be5cedb53038cf5',
  mediaType: 'application/octet-stream',
  downloadUrl:
    'https://noteverse-model-assets.oss-cn-shenzhen.aliyuncs.com/models/bytedance/piano-note/model.onnx?x-oss-signature=test',
  downloadUrlExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
} as const;

function mockAccess(data: unknown) {
  vi.mocked(apiClient.get).mockResolvedValue({ data });
}

describe('modelAssetsApi.getByteDanceNoteModelAccess', () => {
  beforeEach(() => {
    vi.mocked(apiClient.get).mockReset();
  });

  it('accepts exact-locked valid descriptor', async () => {
    mockAccess(EXPECTED_ACCESS);
    await expect(modelAssetsApi.getByteDanceNoteModelAccess()).resolves.toEqual(EXPECTED_ACCESS);
  });

  it('rejects non-object or null input', async () => {
    mockAccess(null);
    await expect(modelAssetsApi.getByteDanceNoteModelAccess()).rejects.toThrow(/missing data/);

    mockAccess('string');
    await expect(modelAssetsApi.getByteDanceNoteModelAccess()).rejects.toThrow(/must be a non-null object/);
  });

  it('rejects mismatched schemaVersion', async () => {
    mockAccess({ ...EXPECTED_ACCESS, schemaVersion: 2 });
    await expect(modelAssetsApi.getByteDanceNoteModelAccess()).rejects.toThrow(/Unsupported model asset schema version/);
  });

  it('rejects mismatched assetId', async () => {
    mockAccess({ ...EXPECTED_ACCESS, assetId: 'other-model' });
    await expect(modelAssetsApi.getByteDanceNoteModelAccess()).rejects.toThrow(/assetId mismatch/);
  });

  it('rejects mismatched assetVersion', async () => {
    mockAccess({ ...EXPECTED_ACCESS, assetVersion: 'v2' });
    await expect(modelAssetsApi.getByteDanceNoteModelAccess()).rejects.toThrow(/assetVersion mismatch/);
  });

  it('rejects mismatched expectedByteSize', async () => {
    mockAccess({ ...EXPECTED_ACCESS, expectedByteSize: 12345 });
    await expect(modelAssetsApi.getByteDanceNoteModelAccess()).rejects.toThrow(/expectedByteSize mismatch/);
  });

  it('rejects mismatched sha256', async () => {
    mockAccess({ ...EXPECTED_ACCESS, sha256: 'deadbeef' });
    await expect(modelAssetsApi.getByteDanceNoteModelAccess()).rejects.toThrow(/sha256 mismatch/);
  });

  it('rejects invalid mediaType', async () => {
    mockAccess({ ...EXPECTED_ACCESS, mediaType: 'application/json' });
    await expect(modelAssetsApi.getByteDanceNoteModelAccess()).rejects.toThrow(/mediaType must be application\/octet-stream/);
  });

  it('rejects invalid downloadUrl', async () => {
    mockAccess({ ...EXPECTED_ACCESS, downloadUrl: 'ftp://bad-url' });
    await expect(modelAssetsApi.getByteDanceNoteModelAccess()).rejects.toThrow(/missing valid downloadUrl/);
  });

  it('rejects expired downloadUrlExpiresAt', async () => {
    mockAccess({
      ...EXPECTED_ACCESS,
      downloadUrlExpiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    await expect(modelAssetsApi.getByteDanceNoteModelAccess()).rejects.toThrow(
      /downloadUrlExpiresAt must be a valid future ISO timestamp/
    );
  });
});
