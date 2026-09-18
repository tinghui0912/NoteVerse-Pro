import {
  type ByteDanceModelManifest,
  validateByteDanceModelManifest,
} from '../practice/acoustic-inference/bytedance-contract';
import type { ByteDanceModelLoader } from '../practice/acoustic-inference/bytedance-onnx-provider';
import { createModelAssetStore } from './model-asset-store';
import type { ModelAssetDescriptor, ModelAssetStoreOptions } from './types';

export function byteDanceManifestToModelAssetDescriptor(
  manifest: ByteDanceModelManifest
): ModelAssetDescriptor {
  validateByteDanceModelManifest(manifest);
  return {
    schemaVersion: 1,
    assetId: manifest.modelId,
    assetVersion: manifest.modelVersion,
    url: manifest.modelUrl,
    expectedByteSize: manifest.expectedByteSize,
    sha256: manifest.sha256,
    mediaType: 'application/octet-stream',
  };
}

export function createOpfsByteDanceModelLoader(
  options?: ModelAssetStoreOptions
): ByteDanceModelLoader {
  const store = createModelAssetStore(options);
  return async (manifest: ByteDanceModelManifest) => {
    validateByteDanceModelManifest(manifest);
    const descriptor = byteDanceManifestToModelAssetDescriptor(manifest);
    const result = await store.ensureAsset(descriptor);
    return {
      bytes: result.bytes,
      source: result.diagnostics.source,
      downloadMs: result.diagnostics.downloadMs,
      cacheReadMs: result.diagnostics.cacheReadMs,
      verificationMs: result.diagnostics.verificationMs,
      persistentStorageGranted: result.diagnostics.persistentStorageGranted,
    };
  };
}
