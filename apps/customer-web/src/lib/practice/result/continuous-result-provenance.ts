import { ACOUSTIC_ANALYSIS_IDENTITY } from '@/lib/practice/acoustic/model/analysis-identity';
import { sourceIdentity, type SourceRate } from '@/lib/practice/acoustic/model/model-contract';
import { CONTINUOUS_MIDI_EVIDENCE_POLICY_ID } from '@/lib/practice/continuous/input/midi-evidence-identity';
import { continuousTimingProvenance, assertContinuousTimingProvenance, type ContinuousTimingProvenance } from '@/lib/practice/continuous/timing/timing-provenance';

export type ContinuousEvidenceProvenance =
  | Readonly<{ inputSource: 'MIDI'; evidencePolicyId: typeof CONTINUOUS_MIDI_EVIDENCE_POLICY_ID; timing: ContinuousTimingProvenance }>
  | Readonly<{ inputSource: 'MICROPHONE'; acousticIdentityName: string; acousticCoreIdentitySha256: string;
      modelSha256: string; decoderSourceSha256: string; sourceSampleRateHz: SourceRate; sourceAdapterIdentitySha256: string; timing: ContinuousTimingProvenance }>;

export function midiEvidenceProvenance(evidencePolicyId: typeof CONTINUOUS_MIDI_EVIDENCE_POLICY_ID): ContinuousEvidenceProvenance {
  const value = Object.freeze({ inputSource: 'MIDI' as const, evidencePolicyId, timing: continuousTimingProvenance('MIDI') });
  assertContinuousEvidenceProvenance(value); return value;
}
export function microphoneEvidenceProvenance(sourceSampleRateHz: SourceRate): ContinuousEvidenceProvenance {
  const identity = ACOUSTIC_ANALYSIS_IDENTITY;
  const value = Object.freeze({ inputSource: 'MICROPHONE' as const,
    timing: continuousTimingProvenance('MICROPHONE'),
    acousticIdentityName: identity.identityName, acousticCoreIdentitySha256: identity.coreIdentitySha256,
    modelSha256: identity.modelSha256, decoderSourceSha256: identity.decoderSourceSha256,
    sourceSampleRateHz, sourceAdapterIdentitySha256: sourceIdentity(sourceSampleRateHz).identitySha256 });
  assertContinuousEvidenceProvenance(value); return value;
}
export function assertContinuousEvidenceProvenance(value: ContinuousEvidenceProvenance): void {
  assertContinuousTimingProvenance(value.timing, value.inputSource);
  if (value.inputSource === 'MIDI') {
    if (value.evidencePolicyId !== CONTINUOUS_MIDI_EVIDENCE_POLICY_ID || Object.keys(value).sort().join() !== 'evidencePolicyId,inputSource,timing') {
      throw new Error('Continuous MIDI evidence identity is corrupt.');
    }
    return;
  }
  const identity = ACOUSTIC_ANALYSIS_IDENTITY;
  if (value.inputSource !== 'MICROPHONE' || ![44100, 48000].includes(value.sourceSampleRateHz)
    || value.acousticIdentityName !== identity.identityName || value.acousticCoreIdentitySha256 !== identity.coreIdentitySha256
    || value.modelSha256 !== identity.modelSha256 || value.decoderSourceSha256 !== identity.decoderSourceSha256
    || value.sourceAdapterIdentitySha256 !== sourceIdentity(value.sourceSampleRateHz).identitySha256
    || Object.keys(value).sort().join() !== ['inputSource', 'acousticIdentityName', 'acousticCoreIdentitySha256',
      'modelSha256', 'decoderSourceSha256', 'sourceSampleRateHz', 'sourceAdapterIdentitySha256', 'timing'].sort().join()) {
    throw new Error('Continuous acoustic evidence identity is corrupt.');
  }
}
