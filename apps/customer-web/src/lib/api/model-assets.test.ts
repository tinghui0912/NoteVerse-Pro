import { describe, expect, it } from 'vitest';
import {
  assertModelAssetAccess,
  EXPECTED_BYTEDANCE_MODEL_ASSET_ID,
  EXPECTED_BYTEDANCE_MODEL_ASSET_VERSION,
  EXPECTED_BYTEDANCE_MODEL_BYTE_SIZE,
  EXPECTED_BYTEDANCE_MODEL_SHA256,
  type ModelAssetAccess,
} from './model-assets';

function createValidAccess(): ModelAssetAccess {
  return {
    schemaVersion: 1,
    assetId: EXPECTED_BYTEDANCE_MODEL_ASSET_ID,
    assetVersion: EXPECTED_BYTEDANCE_MODEL_ASSET_VERSION,
    expectedByteSize: EXPECTED_BYTEDANCE_MODEL_BYTE_SIZE,
    sha256: EXPECTED_BYTEDANCE_MODEL_SHA256,
    mediaType: 'application/octet-stream',
    downloadUrl:
      'https://noteverse-model-assets.oss-cn-shenzhen.aliyuncs.com/models/bytedance/piano-note/model.onnx?x-oss-signature=test',
    downloadUrlExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
  };
}

describe('assertModelAssetAccess', () => {
  it('accepts exact-locked valid descriptor', () => {
    const valid = createValidAccess();
    expect(() => assertModelAssetAccess(valid)).not.toThrow();
  });

  it('rejects non-object or null input', () => {
    expect(() => assertModelAssetAccess(null)).toThrow(/must be a non-null object/);
    expect(() => assertModelAssetAccess('string')).toThrow(/must be a non-null object/);
  });

  it('rejects mismatched schemaVersion', () => {
    const invalid = { ...createValidAccess(), schemaVersion: 2 };
    expect(() => assertModelAssetAccess(invalid)).toThrow(/Unsupported model asset schema version/);
  });

  it('rejects mismatched assetId', () => {
    const invalid = { ...createValidAccess(), assetId: 'other-model' };
    expect(() => assertModelAssetAccess(invalid)).toThrow(/assetId mismatch/);
  });

  it('rejects mismatched assetVersion', () => {
    const invalid = { ...createValidAccess(), assetVersion: 'v2' };
    expect(() => assertModelAssetAccess(invalid)).toThrow(/assetVersion mismatch/);
  });

  it('rejects mismatched expectedByteSize', () => {
    const invalid = { ...createValidAccess(), expectedByteSize: 12345 };
    expect(() => assertModelAssetAccess(invalid)).toThrow(/expectedByteSize mismatch/);
  });

  it('rejects mismatched sha256', () => {
    const invalid = { ...createValidAccess(), sha256: 'deadbeef' };
    expect(() => assertModelAssetAccess(invalid)).toThrow(/sha256 mismatch/);
  });

  it('rejects invalid mediaType', () => {
    const invalid = { ...createValidAccess(), mediaType: 'application/json' };
    expect(() => assertModelAssetAccess(invalid)).toThrow(/mediaType must be application\/octet-stream/);
  });

  it('rejects invalid downloadUrl', () => {
    const invalid = { ...createValidAccess(), downloadUrl: 'ftp://bad-url' };
    expect(() => assertModelAssetAccess(invalid)).toThrow(/missing valid downloadUrl/);
  });

  it('rejects expired downloadUrlExpiresAt', () => {
    const expired = {
      ...createValidAccess(),
      downloadUrlExpiresAt: new Date(Date.now() - 60_000).toISOString(),
    };
    expect(() => assertModelAssetAccess(expired)).toThrow(/downloadUrlExpiresAt must be a valid future ISO timestamp/);
  });
});
