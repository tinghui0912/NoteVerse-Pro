import { describe, expect, expectTypeOf, it } from 'vitest';
import { canonicalContinuousResultFixture } from '@/lib/practice/__fixtures__/continuous-result';
import { ACOUSTIC_MODEL, sourceIdentity } from '@/lib/practice/acoustic/model/model-contract';
import acousticCoreIdentity from '@/lib/practice/acoustic/model/acoustic-core-identity.json';
import { ACOUSTIC_ANALYSIS_IDENTITY } from '@/lib/practice/acoustic/model/analysis-identity';
import { continuousTimingProvenance } from '@/lib/practice/continuous/timing/timing-provenance';
import { ContinuousMidiEvidence } from '@/lib/practice/continuous/input/midi-evidence';
import { assertContinuousEvidenceProvenance, type ContinuousEvidenceProvenance } from './continuous-result-provenance';
import { assertContinuousPerformanceResult } from './continuous-performance-result';

describe('session-level evidence identity', () => {
  it.each([44100, 48000] as const)('%i microphone result uses canonical model/decoder and the configured source adapter, including silence and unavailable analysis', rate => {
    for (const available of [true, false]) {
      const result = canonicalContinuousResultFixture('MICROPHONE', rate, available);
      expect(result.evidenceProvenance).toEqual({ inputSource: 'MICROPHONE', timing: continuousTimingProvenance('MICROPHONE'), acousticIdentityName: ACOUSTIC_MODEL.identityName,
        acousticCoreIdentitySha256: ACOUSTIC_MODEL.identitySha256, modelSha256: ACOUSTIC_MODEL.modelSha256,
        decoderSourceSha256: acousticCoreIdentity.decoder.authoritativeSource.sha256,
        sourceSampleRateHz: rate, sourceAdapterIdentitySha256: sourceIdentity(rate).identitySha256 });
      const parsed: unknown = JSON.parse(JSON.stringify(result));
      expect(() => assertContinuousPerformanceResult(parsed)).not.toThrow();
      expect(result.schemaVersion).toBe(6);
      expect(ACOUSTIC_ANALYSIS_IDENTITY.identityName).toBe(acousticCoreIdentity.identityName);
      expect(Object.isFrozen(ACOUSTIC_ANALYSIS_IDENTITY)).toBe(true);
    }
  });
  it.each([44100, 48000] as const)('%i COMPLETE and UNAVAILABLE identify the configured evidence stack, not execution outcome', rate => {
    const complete = canonicalContinuousResultFixture('MICROPHONE', rate, true);
    const unavailable = canonicalContinuousResultFixture('MICROPHONE', rate, false);
    expect(complete.evaluation.status).toBe('COMPLETE'); expect(unavailable.evaluation.status).toBe('UNAVAILABLE');
    expect(unavailable.evidenceProvenance).toEqual(complete.evidenceProvenance);
    expect(Object.keys(complete.evidenceProvenance).sort()).toEqual([
      'inputSource', 'acousticIdentityName', 'acousticCoreIdentitySha256', 'modelSha256',
      'decoderSourceSha256', 'sourceSampleRateHz', 'sourceAdapterIdentitySha256', 'timing',
    ].sort());
    expectTypeOf<keyof Extract<ContinuousEvidenceProvenance, { inputSource: 'MICROPHONE' }>>().toEqualTypeOf<
      'inputSource' | 'acousticIdentityName' | 'acousticCoreIdentitySha256' | 'modelSha256'
      | 'decoderSourceSha256' | 'sourceSampleRateHz' | 'sourceAdapterIdentitySha256' | 'timing'
    >();
  });
  it.each([true, false].flatMap(available => [
    'resourcePolicyId', 'runtimePolicySha256', 'livenessPolicyId', 'executionIdentitySha256',
  ].map(field => ({ available, field }))))('rejects $field in configured microphone provenance (analysis available=$available)', ({ available, field }) => {
    const parsed = JSON.parse(JSON.stringify(canonicalContinuousResultFixture('MICROPHONE', 48000, available)));
    parsed.evidenceProvenance[field] = 'not-part-of-evidence-provenance';
    expect(() => assertContinuousEvidenceProvenance(parsed.evidenceProvenance)).toThrow('Continuous acoustic evidence identity is corrupt.');
    expect(() => assertContinuousPerformanceResult(parsed)).toThrow('Continuous acoustic evidence identity is corrupt.');
  });
  // Retired hashes are rejection probes only, never an accepted identity/compatibility path.
  it.each([
    { rate: 44100, retiredAdapter: '27dc3ec4690d0e715ccc76481d056417eb913b4c64e1147880985795941d71fd' },
    { rate: 48000, retiredAdapter: 'd0bd52cbab51f00902d48ddcf2e2d9160435ccf3eb5f33ed29ba1cdc8e7f7cf3' },
  ] as const)('$rate schema-6 parsed microphone Result rejects retired core/composite provenance', ({ rate, retiredAdapter }) => {
    for (const available of [true, false]) {
      const current = canonicalContinuousResultFixture('MICROPHONE', rate, available);
      const retiredCore = '6f57c7780ad8a16ea529c194de20d743fa124af82e1dea3a51be4cd9d24177ed';
      for (const patch of [{ acousticCoreIdentitySha256: retiredCore }, { sourceAdapterIdentitySha256: retiredAdapter },
        { acousticCoreIdentitySha256: retiredCore, sourceAdapterIdentitySha256: retiredAdapter }]) {
        const parsed = JSON.parse(JSON.stringify(current));
        Object.assign(parsed.evidenceProvenance, patch);
        expect(() => assertContinuousPerformanceResult(parsed)).toThrow('Continuous acoustic evidence identity is corrupt.');
      }
    }
  });
  it('MIDI provenance comes from the physical evidence owner without acoustic fields', () => {
    const owner = new ContinuousMidiEvidence('midi');
    const provenance = canonicalContinuousResultFixture().evidenceProvenance;
    expect(provenance).toEqual({ inputSource: 'MIDI', evidencePolicyId: owner.evidencePolicyId, timing: continuousTimingProvenance('MIDI') });
    expectTypeOf<keyof Extract<ContinuousEvidenceProvenance, { inputSource: 'MIDI' }>>().toEqualTypeOf<'inputSource' | 'evidencePolicyId' | 'timing'>();
  });
  it('rejects mismatched source adapter/core identity and cross-source fields', () => {
    const provenance = canonicalContinuousResultFixture('MICROPHONE', 44100).evidenceProvenance;
    for (const patch of [{ sourceSampleRateHz: 48000 }, { modelSha256: 'wrong' }, { acousticCoreIdentitySha256: 'wrong' },
      { decoderSourceSha256: 'wrong' }, { evidencePolicyId: new ContinuousMidiEvidence('midi').evidencePolicyId }]) {
      expect(() => assertContinuousEvidenceProvenance({ ...provenance, ...patch } as ContinuousEvidenceProvenance)).toThrow();
    }
  });
});
