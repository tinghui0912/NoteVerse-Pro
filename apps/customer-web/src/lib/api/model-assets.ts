import { apiClient, type ApiResponse } from '../api-client';

export type ModelAssetAccess = {
  schemaVersion: 1;
  assetId: 'bytedance-piano-transcription-note-model';
  assetVersion: 'CRNN_note_F1_0.9677_pedal_F1_0.9186';
  expectedByteSize: 98_691_493;
  sha256: '6ba3bc4e73607f9cd021e69858fd3ff969a3941c7a93876d5be5cedb53038cf5';
  mediaType: 'application/octet-stream';
  downloadUrl: string;
  downloadUrlExpiresAt: string;
};

export const EXPECTED_BYTEDANCE_MODEL_ASSET_ID = 'bytedance-piano-transcription-note-model';
export const EXPECTED_BYTEDANCE_MODEL_ASSET_VERSION = 'CRNN_note_F1_0.9677_pedal_F1_0.9186';
export const EXPECTED_BYTEDANCE_MODEL_BYTE_SIZE = 98_691_493;
export const EXPECTED_BYTEDANCE_MODEL_SHA256 =
  '6ba3bc4e73607f9cd021e69858fd3ff969a3941c7a93876d5be5cedb53038cf5';

export function assertModelAssetAccess(data: unknown): asserts data is ModelAssetAccess {
  if (!data || typeof data !== 'object') {
    throw new Error('ModelAssetAccess must be a non-null object');
  }
  const candidate = data as Partial<ModelAssetAccess>;
  if (candidate.schemaVersion !== 1) {
    throw new Error(`Unsupported model asset schema version: ${String(candidate.schemaVersion)}`);
  }
  if (candidate.assetId !== EXPECTED_BYTEDANCE_MODEL_ASSET_ID) {
    throw new Error(
      `ModelAssetAccess assetId mismatch: expected ${EXPECTED_BYTEDANCE_MODEL_ASSET_ID}, got ${String(candidate.assetId)}`
    );
  }
  if (candidate.assetVersion !== EXPECTED_BYTEDANCE_MODEL_ASSET_VERSION) {
    throw new Error(
      `ModelAssetAccess assetVersion mismatch: expected ${EXPECTED_BYTEDANCE_MODEL_ASSET_VERSION}, got ${String(candidate.assetVersion)}`
    );
  }
  if (candidate.expectedByteSize !== EXPECTED_BYTEDANCE_MODEL_BYTE_SIZE) {
    throw new Error(
      `ModelAssetAccess expectedByteSize mismatch: expected ${EXPECTED_BYTEDANCE_MODEL_BYTE_SIZE}, got ${String(candidate.expectedByteSize)}`
    );
  }
  if (candidate.sha256 !== EXPECTED_BYTEDANCE_MODEL_SHA256) {
    throw new Error(
      `ModelAssetAccess sha256 mismatch: expected ${EXPECTED_BYTEDANCE_MODEL_SHA256}, got ${String(candidate.sha256)}`
    );
  }
  if (candidate.mediaType !== 'application/octet-stream') {
    throw new Error('ModelAssetAccess mediaType must be application/octet-stream');
  }
  if (
    !candidate.downloadUrl ||
    typeof candidate.downloadUrl !== 'string' ||
    (!candidate.downloadUrl.startsWith('https://') && !candidate.downloadUrl.startsWith('http://'))
  ) {
    throw new Error('ModelAssetAccess missing valid downloadUrl');
  }
  if (!candidate.downloadUrlExpiresAt || typeof candidate.downloadUrlExpiresAt !== 'string') {
    throw new Error('ModelAssetAccess missing downloadUrlExpiresAt');
  }
  const expiresAtMs = Date.parse(candidate.downloadUrlExpiresAt);
  if (Number.isNaN(expiresAtMs) || expiresAtMs <= Date.now()) {
    throw new Error(
      `ModelAssetAccess downloadUrlExpiresAt must be a valid future ISO timestamp: ${String(candidate.downloadUrlExpiresAt)}`
    );
  }
}

export async function getByteDanceNoteModelAccess(signal?: AbortSignal): Promise<ModelAssetAccess> {
  const response = await apiClient.get<ApiResponse<ModelAssetAccess>>(
    '/model-assets/bytedance-note/access',
    undefined,
    { signal, suppressAuthRedirect: true }
  );
  if (!response.data) {
    throw new Error('Model asset access response missing data');
  }
  assertModelAssetAccess(response.data);
  return response.data;
}

export const modelAssetsApi = {
  getByteDanceNoteModelAccess,
};
