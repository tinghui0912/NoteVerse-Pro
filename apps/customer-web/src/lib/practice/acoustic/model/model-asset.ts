import { ACOUSTIC_MODEL_ASSET_DESCRIPTOR } from '../generated/runtime-contract';
import type { ModelAssetDescriptor } from '../../../model-assets/types';

/** Bind the delivery URL to the generated immutable byte identity. */
export function acousticModelAsset(
  url: string,
): Readonly<ModelAssetDescriptor> {
  return Object.freeze({ ...ACOUSTIC_MODEL_ASSET_DESCRIPTOR, url });
}
