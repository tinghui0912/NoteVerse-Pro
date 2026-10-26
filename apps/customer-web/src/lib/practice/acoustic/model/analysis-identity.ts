import acousticCoreIdentity from './acoustic-core-identity.json';
import { ACOUSTIC_MODEL } from './model-contract';

/** Public, immutable identity of the decoder-qualified source analysis implementation. */
export const ACOUSTIC_ANALYSIS_IDENTITY = Object.freeze({
  identityName: ACOUSTIC_MODEL.identityName,
  coreIdentitySha256: ACOUSTIC_MODEL.identitySha256,
  modelSha256: ACOUSTIC_MODEL.modelSha256,
  decoderSourceSha256: acousticCoreIdentity.decoder.authoritativeSource.sha256,
});
