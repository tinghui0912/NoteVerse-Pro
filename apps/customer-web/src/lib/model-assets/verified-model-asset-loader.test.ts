import { expect, it, vi } from 'vitest';
const fake = vi.hoisted(() => ({ ensureAsset: vi.fn(async (asset: unknown) => ({ asset, bytes: new Uint8Array([1]), diagnostics: {} })) }));
vi.mock('./model-asset-store', () => ({ createModelAssetStore: () => fake }));
import { createVerifiedModelAssetLoader } from './verified-model-asset-loader';
import { continuousAcousticModelManifest } from '../practice/acoustic-inference/continuous/acoustic-model-manifest';

it('delegates the actual immutable asset identity to the generic verified OPFS store without relabeling', async () => {
  const manifest = continuousAcousticModelManifest('https://example.invalid/exact-model');
  await createVerifiedModelAssetLoader()(manifest.asset);
  expect(fake.ensureAsset).toHaveBeenCalledWith(manifest.asset);
  expect(fake.ensureAsset.mock.calls[0][0]).toMatchObject({ assetId: 'continuous-robust-browser', assetVersion: 'v1', expectedByteSize: 98689283 });
});
