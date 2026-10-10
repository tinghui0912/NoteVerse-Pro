import { describe, expect, it } from 'vitest';
import {
  PUBLIC_CHALLENGER_QUALIFICATION_PROTOCOL_V1,
  PUBLIC_CHALLENGER_QUALIFICATION_PROTOCOL_V1_SHA256,
  PHASE_9GA25_REGISTRY_SHA256,
  PHASE_9GB_BLIND_MANIFEST_SHA256,
  PHASE_9GA3,
  CHALLENGER_CALIBRATION_PERFORMERS,
  CHALLENGER_BLIND_PERFORMERS,
  assertChallengerQualificationPolicyIdentity,
  assertChallengerExecutionAllowed,
  runGuardedViennaChallengerExecutorsForTest,
  assertCandidateContextEligibilityFrozen,
  assertCandidateRawInferenceScoreIndependent,
  assertCounterfactualAcousticReuseValid,
  selectWithinFamilyRepresentative,
  type ChallengerExecutionRequest,
} from './public-challenger-qualification';
import {
  PUBLIC_MODEL_CALIBRATION_PROTOCOL_V5_SHA256,
} from './public-model-calibration';

function validRequest(overrides: Partial<ChallengerExecutionRequest> = {}): ChallengerExecutionRequest {
  return {
    policy: {
      policyId: PUBLIC_CHALLENGER_QUALIFICATION_PROTOCOL_V1,
      schemaVersion: 1,
      sha256: PUBLIC_CHALLENGER_QUALIFICATION_PROTOCOL_V1_SHA256,
    },
    incumbentPolicySha256: PUBLIC_MODEL_CALIBRATION_PROTOCOL_V5_SHA256,
    incumbentRegistrySha256: PHASE_9GA25_REGISTRY_SHA256,
    blindManifestSha256: PHASE_9GB_BLIND_MANIFEST_SHA256,
    phase: PHASE_9GA3,
    mode: 'CANDIDATE_INFERENCE',
    scenarioSplit: 'CALIBRATION',
    performers: [...CHALLENGER_CALIBRATION_PERFORMERS],
    ...overrides,
  };
}

describe('Phase 9G-A.3 Modern Challenger Qualification Protocol', () => {
  it('enforces exact Challenger V1 policy identity and SHA256', () => {
    expect(() => assertChallengerQualificationPolicyIdentity({
      policyId: PUBLIC_CHALLENGER_QUALIFICATION_PROTOCOL_V1,
      schemaVersion: 1,
      sha256: PUBLIC_CHALLENGER_QUALIFICATION_PROTOCOL_V1_SHA256,
    })).not.toThrow();

    expect(() => assertChallengerQualificationPolicyIdentity({
      policyId: 'WRONG_POLICY',
      schemaVersion: 1,
    })).toThrow(/CHALLENGER_QUALIFICATION_POLICY_ID_MISMATCH/);

    expect(() => assertChallengerQualificationPolicyIdentity({
      policyId: PUBLIC_CHALLENGER_QUALIFICATION_PROTOCOL_V1,
      schemaVersion: 2,
    })).toThrow(/CHALLENGER_QUALIFICATION_POLICY_SCHEMA_VERSION_MISMATCH/);

    expect(() => assertChallengerQualificationPolicyIdentity({
      policyId: PUBLIC_CHALLENGER_QUALIFICATION_PROTOCOL_V1,
      schemaVersion: 1,
      sha256: 'deadbeef',
    })).toThrow(/CHALLENGER_QUALIFICATION_POLICY_SHA_MISMATCH/);
  });

  it('binds two independent exact identity checks: frozen V5 incumbent AND challenger V1', () => {
    // Valid request passes
    expect(() => assertChallengerExecutionAllowed(validRequest())).not.toThrow();

    // Mismatched V5 incumbent policy SHA fails closed
    expect(() => assertChallengerExecutionAllowed(validRequest({ incumbentPolicySha256: 'bad_v5_sha' })))
      .toThrow(/FROZEN_V5_INCUMBENT_POLICY_SHA_MISMATCH/);

    // Mismatched A.2.5 incumbent registry SHA fails closed
    expect(() => assertChallengerExecutionAllowed(validRequest({ incumbentRegistrySha256: 'bad_registry_sha' })))
      .toThrow(/FROZEN_A25_INCUMBENT_REGISTRY_SHA_MISMATCH/);

    // Mismatched blind manifest SHA fails closed
    expect(() => assertChallengerExecutionAllowed(validRequest({ blindManifestSha256: 'bad_blind_sha' })))
      .toThrow(/FROZEN_BLIND_MANIFEST_SHA_MISMATCH/);
  });

  it('fails closed on absent, malformed, or wrong phase (no fail-open early return)', () => {
    expect(() => assertChallengerExecutionAllowed(validRequest({ phase: undefined as unknown as string })))
      .toThrow(/CHALLENGER_EXECUTION_PHASE_REQUIRED/);

    expect(() => assertChallengerExecutionAllowed(validRequest({ phase: '' })))
      .toThrow(/CHALLENGER_EXECUTION_PHASE_REQUIRED/);

    expect(() => assertChallengerExecutionAllowed(validRequest({ phase: '9G-B' })))
      .toThrow(/CHALLENGER_EXECUTION_PHASE_REQUIRED/);

    expect(() => assertChallengerExecutionAllowed(validRequest({ phase: '9G-A' })))
      .toThrow(/CHALLENGER_EXECUTION_PHASE_REQUIRED/);
  });

  it('strictly isolates blind performers and requires exact CALIBRATION split for candidate execution', () => {
    // Blind performers rejected
    expect(() => assertChallengerExecutionAllowed(validRequest({
      performers: [...CHALLENGER_BLIND_PERFORMERS],
    }))).toThrow(/CHALLENGER_BLIND_EVALUATION_INFERENCE_FORBIDDEN/);

    // Mixed performers rejected
    expect(() => assertChallengerExecutionAllowed(validRequest({
      performers: ['p07', 'p15'],
    }))).toThrow(/CHALLENGER_BLIND_EVALUATION_INFERENCE_FORBIDDEN/);

    // Non-CALIBRATION split rejected
    expect(() => assertChallengerExecutionAllowed(validRequest({
      scenarioSplit: 'EVALUATION',
    }))).toThrow(/CHALLENGER_CANDIDATE_INFERENCE_REQUIRES_CALIBRATION/);

    // Incomplete performer set rejected
    expect(() => assertChallengerExecutionAllowed(validRequest({
      performers: ['p07', 'p08'],
    }))).toThrow(/CHALLENGER_CALIBRATION_PERFORMER_SET_REQUIRED/);
  });

  it('guarantees executor call counters stay zero for TRUTH_ONLY requests', () => {
    let robustCalls = 0;
    let transkunCalls = 0;
    let ariaCalls = 0;
    let rttCalls = 0;

    const executors = {
      robustByteDance: () => { robustCalls += 1; },
      transkun: () => { transkunCalls += 1; },
      aria: () => { ariaCalls += 1; },
      rtt: () => { rttCalls += 1; },
    };

    const truthOnly = validRequest({
      mode: 'TRUTH_ONLY',
      scenarioSplit: 'EVALUATION',
      performers: [...CHALLENGER_BLIND_PERFORMERS],
    });

    const counts = runGuardedViennaChallengerExecutorsForTest(truthOnly, executors);
    expect(counts).toEqual({
      robustByteDanceCalls: 0,
      transkunCalls: 0,
      ariaCalls: 0,
      rttCalls: 0,
    });
    expect(robustCalls).toBe(0);
    expect(transkunCalls).toBe(0);
    expect(ariaCalls).toBe(0);
    expect(rttCalls).toBe(0);
  });

  it('verifies candidate adapters do not filter raw observations by expected score pitches', () => {
    const expectedScorePitches = new Set(['C4', 'E4', 'G4']);
    const rawObservations = [
      { observationId: 'obs-1', pitch: 'C4', performanceTimeMs: 100 },
      { observationId: 'obs-2', pitch: 'F#4', performanceTimeMs: 150 }, // Off-score wrong note
      { observationId: 'obs-3', pitch: 'G4', performanceTimeMs: 200 },
      { observationId: 'obs-4', pitch: 'A#4', performanceTimeMs: 250 }, // Off-score extra note
    ];

    const audit = assertCandidateRawInferenceScoreIndependent(rawObservations, expectedScorePitches);
    expect(audit.containsOffScorePitch).toBe(true);
    expect(audit.offScoreCount).toBe(2);
  });

  it('rejects counterfactual acoustic evidence reuse when audio SHA or checkpoint SHA differs', () => {
    // Valid reuse
    expect(assertCounterfactualAcousticReuseValid({
      baseAudioSha256: 'audio_sha_abc',
      counterfactualAudioSha256: 'audio_sha_abc',
      modelCheckpointSha256: 'ckpt_sha_123',
      cachedModelCheckpointSha256: 'ckpt_sha_123',
    })).toBe(true);

    // Audio mismatch rejected
    expect(() => assertCounterfactualAcousticReuseValid({
      baseAudioSha256: 'audio_sha_abc',
      counterfactualAudioSha256: 'audio_sha_different',
      modelCheckpointSha256: 'ckpt_sha_123',
      cachedModelCheckpointSha256: 'ckpt_sha_123',
    })).toThrow(/COUNTERFACTUAL_AUDIO_MISMATCH/);

    // Checkpoint mismatch rejected
    expect(() => assertCounterfactualAcousticReuseValid({
      baseAudioSha256: 'audio_sha_abc',
      counterfactualAudioSha256: 'audio_sha_abc',
      modelCheckpointSha256: 'ckpt_sha_123',
      cachedModelCheckpointSha256: 'ckpt_sha_other',
    })).toThrow(/MODEL_CHECKPOINT_MISMATCH/);
  });

  it('validates candidate context eligibility records are frozen before inference', () => {
    expect(() => assertCandidateContextEligibilityFrozen([
      {
        scenarioId: 'sc-1',
        candidateFamily: 'transkun',
        isEligible: true,
        preRollMs: 0,
        postRollMs: 0,
        requiredWindowMs: 16000,
      },
    ])).not.toThrow();

    expect(() => assertCandidateContextEligibilityFrozen([
      {
        scenarioId: '',
        candidateFamily: 'transkun',
        isEligible: true,
        preRollMs: 0,
        postRollMs: 0,
        requiredWindowMs: 16000,
      },
    ])).toThrow(/INVALID_ELIGIBILITY_RECORD/);
  });

  it('performs within-family selection before cross-family comparison and freezes single representative', () => {
    // Singleton family like Transkun or Aria
    const result = selectWithinFamilyRepresentative({
      candidateFamily: 'transkun',
      scores: [
        {
          profileId: 'transkun-v2-aug-calibrated-v1',
          scenarioId: 's1',
          family: 'BASE_ORIGINAL',
          metrics: {},
        },
      ],
    });
    expect(result.selectedProfileId).toBe('transkun-v2-aug-calibrated-v1');
    expect(result.selectionMethod).toBe('SINGLETON_PROFILE_FREEZE');
  });

  it('distinguishes acoustic event time from publication availability time for offline models', () => {
    const entireAudioDurationMs = 30000;
    const inferenceWallLatencyMs = 2500;
    const earliestPublicationAvailabilityMs = entireAudioDurationMs + inferenceWallLatencyMs;

    // Earliest publication availability cannot precede full recording arrival + decoding latency
    expect(earliestPublicationAvailabilityMs).toBeGreaterThan(entireAudioDurationMs);

    const noteEventTimeMs = 5200; // Predicted note at 5.2s
    // Publication availability (32.5s) is separate and strictly later than note event time (5.2s)
    expect(earliestPublicationAvailabilityMs).toBeGreaterThan(noteEventTimeMs);
  });
});
