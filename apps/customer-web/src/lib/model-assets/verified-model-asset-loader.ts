import { createModelAssetStore } from './model-asset-store';
import type { ModelAssetDescriptor, ModelAssetStoreOptions, ModelAssetLoadResult, ModelAssetProgressCallback } from './types';

/** Truthful immutable asset identity, independent of model family or inference policy. */
export function createVerifiedModelAssetLoader(options?: ModelAssetStoreOptions): (asset: ModelAssetDescriptor, progress?: ModelAssetProgressCallback) => Promise<ModelAssetLoadResult> {
  const store = createModelAssetStore(options);
  return (asset, progress) => store.ensureAsset(asset, progress);
}
