import { createModelAssetStore } from './model-asset-store';
import type { ModelAssetDescriptor, ModelAssetStoreOptions, ModelAssetLoadResult } from './types';

/** Truthful immutable asset identity, independent of model family or inference policy. */
export function createVerifiedModelAssetLoader(options?: ModelAssetStoreOptions): (asset: ModelAssetDescriptor) => Promise<ModelAssetLoadResult> {
  const store = createModelAssetStore(options);
  return asset => store.ensureAsset(asset);
}
