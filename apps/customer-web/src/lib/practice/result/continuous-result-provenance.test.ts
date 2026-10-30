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
      expect(result.schemaVersion).toBe(7);
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
  it.each([true, false])('rejects unknown microphone provenance fields (available=%s)', available => {
    const parsed = JSON.parse(JSON.stringify(canonicalContinuousResultFixture('MICROPHONE', 48000, available)));
    parsed.evidenceProvenance.unexpectedField = 'unexpected';
    expect(() => assertContinuousEvidenceProvenance(parsed.evidenceProvenance)).toThrow('Continuous acoustic evidence identity is corrupt.');
    expect(() => assertContinuousPerformanceResult(parsed)).toThrow('Continuous acoustic evidence identity is corrupt.');
  });
  it.each([44100, 48000] as const)('%i rejects well-formed digests that differ from configured core/adapter identity', rate => {
    for (const available of [true, false]) {
      const current = canonicalContinuousResultFixture('MICROPHONE', rate, available);
      const unknownCore = '0'.repeat(64), unknownAdapter = '1'.repeat(64);
      for (const patch of [{ acousticCoreIdentitySha256: unknownCore }, { sourceAdapterIdentitySha256: unknownAdapter },
        { acousticCoreIdentitySha256: unknownCore, sourceAdapterIdentitySha256: unknownAdapter }]) {
        const parsed = JSON.parse(JSON.stringify(current));
        Object.assign(parsed.evidenceProvenance, patch);
        expect(() => assertContinuousPerformanceResult(parsed)).toThrow('Continuous acoustic evidence identity is corrupt.');
        expect(() => assertContinuousPerformanceResult(current)).not.toThrow();
        expect(Object.keys(parsed.evidenceProvenance)).toEqual(Object.keys(current.evidenceProvenance));
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
