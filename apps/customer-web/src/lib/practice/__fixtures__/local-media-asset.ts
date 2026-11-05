import { createLocalMediaAsset } from "../media/local-media-asset";

export function localMediaAssetFixture(blob = new Blob(["media"])) {
  return createLocalMediaAsset(blob, async () => {});
}
