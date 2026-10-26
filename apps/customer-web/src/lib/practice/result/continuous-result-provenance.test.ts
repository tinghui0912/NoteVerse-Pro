import { describe, expect, expectTypeOf, it } from 'vitest';
import { canonicalContinuousResultFixture } from '@/lib/practice/__fixtures__/continuous-result';
import { ACOUSTIC_MODEL, sourceIdentity } from '@/lib/practice/acoustic/model/model-contract';
import acousticCoreIdentity from '@/lib/practice/acoustic/model/acoustic-core-identity.json';
import { ACOUSTIC_ANALYSIS_IDENTITY } from '@/lib/practice/acoustic/model/analysis-identity';
import { ContinuousMidiEvidence } from '@/lib/practice/continuous/input/midi-evidence';
import { assertContinuousEvidenceProvenance, type ContinuousEvidenceProvenance } from './continuous-result-provenance';

describe('session-level evidence identity', () => {
  it.each([44100, 48000] as const)('%i microphone result uses canonical model/decoder and the configured source adapter, including silence and unavailable analysis', rate => {
    for (const available of [true, false]) {
      const result = canonicalContinuousResultFixture('MICROPHONE', rate, available);
      expect(result.evidenceProvenance).toEqual({ inputSource: 'MICROPHONE', acousticIdentityName: ACOUSTIC_MODEL.identityName,
        acousticCoreIdentitySha256: ACOUSTIC_MODEL.identitySha256, modelSha256: ACOUSTIC_MODEL.modelSha256,
        decoderSourceSha256: acousticCoreIdentity.decoder.authoritativeSource.sha256,
        sourceSampleRateHz: rate, sourceAdapterIdentitySha256: sourceIdentity(rate).identitySha256 });
      expect(ACOUSTIC_ANALYSIS_IDENTITY.identityName).toBe(acousticCoreIdentity.identityName);
      expect(Object.isFrozen(ACOUSTIC_ANALYSIS_IDENTITY)).toBe(true);
    }
  });
  it('MIDI provenance comes from the physical evidence owner without acoustic fields', () => {
    const owner = new ContinuousMidiEvidence('midi');
    const provenance = canonicalContinuousResultFixture().evidenceProvenance;
    expect(provenance).toEqual({ inputSource: 'MIDI', evidencePolicyId: owner.evidencePolicyId });
    expectTypeOf<keyof Extract<ContinuousEvidenceProvenance, { inputSource: 'MIDI' }>>().toEqualTypeOf<'inputSource' | 'evidencePolicyId'>();
  });
  it('rejects mismatched source adapter/core identity and cross-source fields', () => {
    const provenance = canonicalContinuousResultFixture('MICROPHONE', 44100).evidenceProvenance;
    for (const patch of [{ sourceSampleRateHz: 48000 }, { modelSha256: 'wrong' }, { acousticCoreIdentitySha256: 'wrong' },
      { decoderSourceSha256: 'wrong' }, { evidencePolicyId: new ContinuousMidiEvidence('midi').evidencePolicyId }]) {
      expect(() => assertContinuousEvidenceProvenance({ ...provenance, ...patch } as ContinuousEvidenceProvenance)).toThrow();
    }
  });
});
