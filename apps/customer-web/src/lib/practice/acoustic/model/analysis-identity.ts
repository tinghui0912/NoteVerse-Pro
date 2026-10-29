import acousticCoreIdentity from './acoustic-core-identity.json';
import { ACOUSTIC_MODEL } from './model-contract';

/**
 * Public identity of the declared evidence-producing acoustic semantic core.
 * Selected repository attestations are not an executable dependency closure.
 */
export const ACOUSTIC_ANALYSIS_IDENTITY = Object.freeze({
  identityName: ACOUSTIC_MODEL.identityName,
  coreIdentitySha256: ACOUSTIC_MODEL.identitySha256,
  modelSha256: ACOUSTIC_MODEL.modelSha256,
  decoderSourceSha256: acousticCoreIdentity.decoder.authoritativeSource.sha256,
});
