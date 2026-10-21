import type { ModelAssetDescriptor } from '../../../model-assets/types';
import core from './acoustic-core-identity.json';
import { ACOUSTIC_MODEL as M } from './model-contract';

export function practiceAcousticModelManifest(url: string) {
  const asset: Readonly<ModelAssetDescriptor> = Object.freeze({ schemaVersion: 1, assetId: 'practice-acoustic-robust-browser', assetVersion: 'v1',
    url, expectedByteSize: M.modelBytes, sha256: M.modelSha256, mediaType: 'application/octet-stream' });
  return Object.freeze({ asset, ortVersion: M.ortVersion, provider: M.provider, automaticFallback: M.automaticFallback,
    acousticCoreIdentitySha256: M.identitySha256,
    input: Object.freeze({ name: 'audio', dtype: 'float32', shape: Object.freeze([1, 29120]) }),
    outputs: Object.freeze(['reg_onset_output', 'frame_output'].map(name => Object.freeze({ name, dtype: 'float32', shape: Object.freeze([1, 183, 88]) }))),
    decoder: Object.freeze({ identity: 'A', sourceSha256: core.decoder.authoritativeSource.sha256,
      function: core.decoder.function, onsetThreshold: M.onsetThreshold, frameThreshold: M.frameThreshold }) });
}
