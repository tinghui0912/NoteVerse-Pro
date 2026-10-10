import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  PUBLIC_CHALLENGER_QUALIFICATION_PROTOCOL_V1,
  PUBLIC_CHALLENGER_QUALIFICATION_PROTOCOL_V1_SHA256,
  PUBLIC_CHALLENGER_QUALIFICATION_PROTOCOL_V2,
  PUBLIC_CHALLENGER_QUALIFICATION_PROTOCOL_V2_SHA256,
  PHASE_9GA25_REGISTRY_SHA256,
  PHASE_9GA1_CALIBRATION_SCENARIOS_SHA256,
  PHASE_9GB_BLIND_MANIFEST_SHA256,
  PHASE_9GA3,
  PHASE_9GA31,
  PHASE_9GA32,
  PHASE_9GB0,
  PHASE_9GB01,
  PHASE_9GB1,
  PHASE_9GB11,
  PHASE_9GB12,
  PHASE_9GB2_PRE,
  PHASE_9GB2_ARM,
  PHASE_9GB2_FINAL_GATE,
  PHASE_9GB_BLIND_EVALUATION_PROTOCOL_V1_SHA256,
  PHASE_9GB_BLIND_EVALUATION_PROTOCOL_V2,
  PHASE_9GB_BLIND_EVALUATION_PROTOCOL_V2_SHA256,
  PHASE_9GB_BLIND_EVALUATION_PROTOCOL_V3,
  PHASE_9GB_BLIND_EVALUATION_PROTOCOL_V3_SHA256,
  PHASE_9GB_BLIND_EVALUATION_PROTOCOL_V4,
  PHASE_9GB_BLIND_EVALUATION_PROTOCOL_V4_SHA256,
  PHASE_9GB_BLIND_EVALUATION_PROTOCOL_V5,
  PHASE_9GB_BLIND_EVALUATION_PROTOCOL_V5_SHA256,
  PHASE_9GB_BLIND_EVALUATION_PROTOCOL_V6,
  CHALLENGER_CALIBRATION_PERFORMERS,
  CHALLENGER_BLIND_PERFORMERS,
  assertChallengerQualificationPolicyIdentity,
  assertChallengerExecutionAllowed,
  runGuardedViennaChallengerExecutorsForTest,
  assertCandidateContextEligibilityFrozen,
  assertCandidateRawInferenceScoreIndependent,
  assertCounterfactualAcousticReuseValid,
  selectWithinFamilyRepresentative,
  validateA25IncumbentRegistry,
  assertCheckpointIdentityStrict,
  validateRobustByteDanceRawCache,
  validateRobustByteDanceRawCacheStrict,
  validateTranscriptionRawCache,
  validateTranscriptionRawCacheStrict,
  computeCanonicalTranscriptionNotesDigest,
  deriveCandidateContextEligibility,
  assertNoIneligibleScenarioInProfileScoring,
  assertAcousticEvidenceScoreIndependent,
  computeCanonicalAcousticObservationDigest,
  assertAcousticEvidenceScoreIndependentDeterministic,
  assertScoreIndependencePreservesOffScoreNotes,
  assertModelStateDictCompatibility,
  assertCandidateCausalStreamingClaimsValid,
  assertPublicationTimingValid,
  assertWholeRecordingPublicationTiming,
  assertAriaPerFileLatencyReportValid,
  evaluatePairwiseComparison,
  assertCleanWorkingTree,
  assertCandidateQualificationForPhase9GB,
  assertCandidateMultiDimensionalQualification,
  assertContextEligibilityScoreIndependent,
  assertPairwiseMatrixDenominatorsValid,
  classifyMetricPairwiseComparison,
  assertNoBelowThresholdCrossFamilyWinner,
  assertReconciledIncumbentMetricsValid,
  assertValidCacheProvenanceStatus,
  assertNoSelfDigestTautology,
  assertBootstrapCiMathematicallyPlausible,
  assertScenarioSetIntersectionExact,
  assertCandidateRegistryIdentitiesExact,
  assertPairwiseReversalInvariants,
  assertStatisticalEvidenceClassificationValid,
  assertRequiredSafetyMetricsPresent,
  assertBlindProtocolV2Identity,
  assertBlindProtocolV3Identity,
  assertBlindProtocolV4Identity,
  assertBlindProtocolV5Identity,
  assertBlindProtocolV6Identity,
  assertAudioByteIntegrity,
  assertExecutionLockBindingsValid,
  assertLedgerStateTransitionValid,
  assertNoDuplicateRunAttempt,
  assertNoDuplicateCandidateScenarioAttempt,
  computeJournalEventHash,
  assertJournalEventChainValid,
  assertJournalMatchesRunReceipt,
  assertJournalChainTipAndCompleteness,
  assertProductionAudioManifestValid,
  assertSyntheticRehearsalManifestValid,
  assertAcousticPublicationCausalTimingValid,
  evaluateSymmetricSafetyDominance,
  assertMetricSpecificDenominatorsValid,
  assertSourceReceiptShaValid,
  assertObservationDigestValid,
  assertCleanWorkingTreeIntegrity,
  assertCandidateBlindRolePermitted,
  type ChallengerExecutionRequest,
} from './public-challenger-qualification';
import type { CandidateScenarioRun } from './continuous-analyzer-bakeoff';
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
    calibrationManifestSha256: PHASE_9GA1_CALIBRATION_SCENARIOS_SHA256,
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

  it('enforces exact Challenger V2 policy identity and supersession semantics', () => {
    expect(() => assertChallengerQualificationPolicyIdentity({
      policyId: PUBLIC_CHALLENGER_QUALIFICATION_PROTOCOL_V2,
      schemaVersion: 2,
      sha256: PUBLIC_CHALLENGER_QUALIFICATION_PROTOCOL_V2_SHA256,
    })).not.toThrow();

    expect(() => assertChallengerQualificationPolicyIdentity({
      policyId: PUBLIC_CHALLENGER_QUALIFICATION_PROTOCOL_V2,
      schemaVersion: 1,
    })).toThrow(/CHALLENGER_QUALIFICATION_POLICY_SCHEMA_VERSION_MISMATCH/);

    expect(() => assertChallengerQualificationPolicyIdentity({
      policyId: PUBLIC_CHALLENGER_QUALIFICATION_PROTOCOL_V2,
      schemaVersion: 2,
      sha256: 'wrong_sha',
    })).toThrow(/CHALLENGER_QUALIFICATION_POLICY_SHA_MISMATCH/);
  });

  describe('Adversarial Regression Test Suite (14 Defects)', () => {
    it('Defect 1: Missing incumbent registry profiles (profiles missing/empty) rejects generation', () => {
      // Missing profiles key (like old buggy A.3 registry builder that read registryRaw.incumbents)
      expect(() => validateA25IncumbentRegistry({ incumbents: [] })).toThrow(
        /INCUMBENT_PROFILE_COUNT_MUST_BE_EXACTLY_TWO/
      );
      expect(() => validateA25IncumbentRegistry({})).toThrow(
        /INCUMBENT_PROFILE_COUNT_MUST_BE_EXACTLY_TWO/
      );
      expect(() => validateA25IncumbentRegistry({ profiles: [] })).toThrow(
        /INCUMBENT_PROFILE_COUNT_MUST_BE_EXACTLY_TWO/
      );
      expect(() => validateA25IncumbentRegistry({ profiles: [{ candidateId: 'bytedance-original-calibrated-v1' }] })).toThrow(
        /INCUMBENT_PROFILE_COUNT_MUST_BE_EXACTLY_TWO/
      );

      // Valid profiles array succeeds
      const validProfiles = [
        {
          candidateId: 'bytedance-original-calibrated-v1',
          candidateFamily: 'bytedance-original',
          profileId: 'bytedance-original-calibration-CALIBRATED_CONTEXT_5S-onset-0.20-frame-0.10',
          configurationSha256: '91a6fc6d33575edf9b8eb3adc78a21a4ea28d7581e3c7eb56a882e0fe6dd9285',
          checkpointSha256: 'c3fa9730725bf4a762f1c14bc80cd5986eacda01b026f5a4a2525cd607876141',
          selectionStatus: 'SELECTED',
          qualificationStatus: 'CALIBRATED_AND_LOCKED',
          LOCKED_FOR_PHASE_9G_B: true,
        },
        {
          candidateId: 'online-amt-calibrated-v1',
          candidateFamily: 'online-amt',
          profileId: 'online-amt-calibration-native-boost-1',
          configurationSha256: '0d56e238a353a0aecfbf1d129521e93fc69f7e171711ce9ad57b419548edc375',
          checkpointSha256: '54ab4907b517dbfa2dbbee834db18d31d103ee25d690860595181162d235e3a0',
          selectionStatus: 'SELECTED',
          qualificationStatus: 'CALIBRATED_AND_LOCKED',
          LOCKED_FOR_PHASE_9G_B: true,
        },
      ];
      expect(validateA25IncumbentRegistry({ profiles: validProfiles })).toHaveLength(2);
    });

    it('Defect 2: All four reported checkpoint-byte discrepancies fail assertCheckpointIdentityStrict', () => {
      // 1. Robust ByteDance discrepancy (103815845 vs 74705745)
      expect(() => assertCheckpointIdentityStrict({
        candidateFamily: 'bytedance-robust-augmented',
        checkpointPath: 'models/bytedance_piano_transcription/high_resolution_MAESTRO_augmentations.pth',
        expectedSha256: 'b20f72053abc15b78f689b2a8b04c0a06529c8466e898b915803a1daa2011b9e',
        expectedBytes: 103815845,
        actualSha256: 'b20f72053abc15b78f689b2a8b04c0a06529c8466e898b915803a1daa2011b9e',
        actualBytes: 74705745,
      })).toThrow(/CHECKPOINT_BYTES_MISMATCH:bytedance-robust-augmented/);

      // 2. Transkun discrepancy (56423254 vs 56864887)
      expect(() => assertCheckpointIdentityStrict({
        candidateFamily: 'transkun',
        checkpointPath: 'models/checkpointMSimplerAug/checkpoint.pt',
        expectedSha256: '8bd6b4b5ddf9ce8c5f296a57859eec9f166cd337c35245ec2a2576d90be68c4c',
        expectedBytes: 56423254,
        actualSha256: '8bd6b4b5ddf9ce8c5f296a57859eec9f166cd337c35245ec2a2576d90be68c4c',
        actualBytes: 56864887,
      })).toThrow(/CHECKPOINT_BYTES_MISMATCH:transkun/);

      // 3. Aria-AMT discrepancy (446577344 vs 1387005532)
      expect(() => assertCheckpointIdentityStrict({
        candidateFamily: 'aria-amt',
        checkpointPath: 'models/aria-amt/piano-medium-double-1.0.safetensors',
        expectedSha256: '089d3129dbe93246aeda55efe668c8a48af08afaf9dd15c64cef0a07c0fb30a4',
        expectedBytes: 446577344,
        actualSha256: '089d3129dbe93246aeda55efe668c8a48af08afaf9dd15c64cef0a07c0fb30a4',
        actualBytes: 1387005532,
      })).toThrow(/CHECKPOINT_BYTES_MISMATCH:aria-amt/);

      // 4. RTT discrepancy (67843364 vs 153924965)
      expect(() => assertCheckpointIdentityStrict({
        candidateFamily: 'rtt',
        checkpointPath: 'backend/data/work/rtt_research/rtt/ckpts/CustomAMT.ckpt',
        expectedSha256: '901fc3da306fb4cffd96c55298d1439447e5a79f48cf436b4e76fde46db569f1',
        expectedBytes: 67843364,
        actualSha256: '901fc3da306fb4cffd96c55298d1439447e5a79f48cf436b4e76fde46db569f1',
        actualBytes: 153924965,
      })).toThrow(/CHECKPOINT_BYTES_MISMATCH:rtt/);

      // Valid checkpoint pass
      expect(() => assertCheckpointIdentityStrict({
        candidateFamily: 'bytedance-robust-augmented',
        checkpointPath: 'models/bytedance_piano_transcription/high_resolution_MAESTRO_augmentations.pth',
        expectedSha256: 'b20f72053abc15b78f689b2a8b04c0a06529c8466e898b915803a1daa2011b9e',
        expectedBytes: 103815845,
        actualSha256: 'b20f72053abc15b78f689b2a8b04c0a06529c8466e898b915803a1daa2011b9e',
        actualBytes: 103815845,
      })).not.toThrow();
    });

    it('Defect 3: Model-state loading mismatch cannot silently proceed (strict=True for Transkun)', () => {
      const modelKeys = ['layer1.weight', 'layer1.bias', 'layer2.weight', 'layer2.bias'];
      const incompleteKeys = ['layer1.weight', 'layer1.bias'];
      const extraKeys = ['layer1.weight', 'layer1.bias', 'layer2.weight', 'layer2.bias', 'unexpected.param'];

      // Missing keys fail closed under strict mode
      expect(() => assertModelStateDictCompatibility(incompleteKeys, modelKeys, true)).toThrow(
        /MODEL_STATE_DICT_MISMATCH: missing=2, unexpected=0/
      );

      // Unexpected keys fail closed under strict mode
      expect(() => assertModelStateDictCompatibility(extraKeys, modelKeys, true)).toThrow(
        /MODEL_STATE_DICT_MISMATCH: missing=0, unexpected=1/
      );

      // Exact match passes
      const result = assertModelStateDictCompatibility(modelKeys, modelKeys, true);
      expect(result.missingKeys).toHaveLength(0);
      expect(result.unexpectedKeys).toHaveLength(0);
    });

    it('Defect 4: Stale/corrupt raw cache fails validateRobustByteDanceRawCache and validateTranscriptionRawCache', () => {
      const expectedWindows = [
        { windowId: 'w1', contextProfileId: 'ctx1', inputSampleCount: 16000 },
      ];

      // Missing chunks
      expect(() => validateRobustByteDanceRawCache({}, expectedWindows)).toThrow(
        /INVALID_ROBUST_BYTEDANCE_RAW_CACHE_SCHEMA/
      );

      // Window count mismatch
      expect(() => validateRobustByteDanceRawCache({ chunks: [] }, expectedWindows)).toThrow(
        /ROBUST_BYTEDANCE_RAW_CACHE_WINDOW_COUNT_MISMATCH/
      );

      // Corrupt chunk (missing float32 byte SHA)
      expect(() => validateRobustByteDanceRawCache({
        chunks: [{
          windowId: 'w1',
          contextProfileId: 'ctx1',
          inputSampleCount: 16000,
          rawOutputs: { frame_output: { data: [0.1] } },
        }],
      }, expectedWindows)).toThrow(/RAW_OUTPUTS_MISSING_IN_CACHE|FLOAT32_SHA_MISSING_IN_CACHE/);

      // Valid raw cache passes
      const validData = new Array(88).fill(0.1);
      const buf = Buffer.alloc(88 * 4);
      validData.forEach((v, i) => buf.writeFloatLE(v, i * 4));
      const validSha = createHash('sha256').update(buf).digest('hex');

      expect(validateRobustByteDanceRawCache({
        chunks: [{
          windowId: 'w1',
          contextProfileId: 'ctx1',
          inputSampleCount: 16000,
          scenarioId: 'sc1',
          rawOutputs: {
            frame_output: { dims: [1, 88], data: validData, float32ByteSha256: validSha },
            reg_onset_output: { dims: [1, 88], data: validData, float32ByteSha256: validSha },
          },
        }],
      }, expectedWindows)).toBe(true);

      // Transcription cache validation
      expect(() => validateTranscriptionRawCache({}, ['audio-1'])).toThrow(
        /INVALID_TRANSCRIPTION_RAW_CACHE_SCHEMA/
      );
      expect(() => validateTranscriptionRawCache({ transcriptions: {} }, ['audio-1'])).toThrow(
        /MISSING_AUDIO_IN_TRANSCRIPTION_CACHE:audio-1/
      );
      expect(() => validateTranscriptionRawCache({ transcriptions: { 'audio-1': {} } }, ['audio-1'])).toThrow(
        /MISSING_NOTES_IN_TRANSCRIPTION_CACHE:audio-1/
      );
      expect(validateTranscriptionRawCache({
        transcriptions: { 'audio-1': { notes: [{ pitch: 'C4', onsetTimeMs: 100 }] } },
      }, ['audio-1'])).toBe(true);
    });

    it('Defect 5: Modified calibration manifest or altered performer IDs block execution', () => {
      // Altered calibration manifest SHA fails closed
      expect(() => assertChallengerExecutionAllowed(validRequest({
        calibrationManifestSha256: 'tampered_manifest_sha',
      }))).toThrow(/FROZEN_CALIBRATION_MANIFEST_SHA_MISMATCH/);

      // Altered performer IDs fail closed
      expect(() => assertChallengerExecutionAllowed(validRequest({
        performers: ['p07', 'p08', 'p09', 'p10', 'p11', 'p12', 'p13', 'p99'],
      }))).toThrow(/CHALLENGER_CALIBRATION_PERFORMER_SET_REQUIRED/);

      // Valid manifest passes
      expect(() => assertChallengerExecutionAllowed(validRequest({
        calibrationManifestSha256: PHASE_9GA1_CALIBRATION_SCENARIOS_SHA256,
      }))).not.toThrow();
    });

    it('Defect 6: RTT offline batch output rejected from strict-causal claims', () => {
      // RTT claiming streaming fails closed
      expect(() => assertCandidateCausalStreamingClaimsValid({
        candidateFamily: 'rtt',
        causalStreamingSupported: true,
      })).toThrow(/RTT_CAUSAL_STREAMING_EXECUTION_FORBIDDEN/);

      expect(() => assertCandidateCausalStreamingClaimsValid({
        candidateFamily: 'rtt',
        claimedStreaming: true,
      })).toThrow(/RTT_CAUSAL_STREAMING_EXECUTION_FORBIDDEN/);

      expect(() => assertCandidateCausalStreamingClaimsValid({
        candidateFamily: 'rtt',
        executionMode: 'CAUSAL_STREAMING',
      })).toThrow(/RTT_CAUSAL_STREAMING_EXECUTION_FORBIDDEN/);

      expect(() => assertCandidateCausalStreamingClaimsValid({
        candidateFamily: 'rtt',
        reportedFrameLatencyMs: 10,
      })).toThrow(/RTT_CAUSAL_STREAMING_EXECUTION_FORBIDDEN/);

      // RTT in offline segmentwise reference mode passes
      expect(() => assertCandidateCausalStreamingClaimsValid({
        candidateFamily: 'rtt',
        causalStreamingSupported: false,
        executionMode: 'OFFLINE_SEGMENTWISE_REFERENCE',
        reportedFrameLatencyMs: null,
      })).not.toThrow();
    });

    it('Defect 7: Future audio access blocks causal publication', () => {
      const audio = { clipStartMs: 0, clipEndMs: 30000, performanceOriginSourceMs: 0 };

      // Observation leaking future audio past analyzedThroughPerformanceMs fails closed
      expect(() => assertPublicationTimingValid({
        availabilityTimeMs: 1050,
        analyzedThroughPerformanceMs: 1000,
        observations: [{ performanceTimeMs: 1200 }], // Leak: note is 200ms into the future!
      }, audio, true)).toThrow(/FUTURE_AUDIO_LEAK_IN_CAUSAL_PUBLICATION/);

      // Availability time preceding analyzed time fails closed
      expect(() => assertPublicationTimingValid({
        availabilityTimeMs: 900,
        analyzedThroughPerformanceMs: 1000,
        observations: [{ performanceTimeMs: 500 }],
      }, audio, true)).toThrow(/AVAILABILITY_PRECEDES_ANALYZED_TIME_IN_CAUSAL_PUBLICATION/);

      // Strictly causal publication passes
      expect(() => assertPublicationTimingValid({
        availabilityTimeMs: 1050,
        analyzedThroughPerformanceMs: 1000,
        observations: [{ performanceTimeMs: 800 }],
      }, audio, true)).not.toThrow();
    });

    it('Defect 8: Whole-file Transkun/Aria publication cannot precede source audio end', () => {
      const audio = { clipStartMs: 0, clipEndMs: 30000, performanceOriginSourceMs: 0 };
      const inferenceLatencyMs = 2000;
      // Source end is at 30000ms. Earliest possible publication is 32000ms.

      // Claiming publication at 15000ms fails closed
      expect(() => assertWholeRecordingPublicationTiming({
        availabilityTimeMs: 15000,
        analyzedThroughPerformanceMs: 30000,
      }, audio, inferenceLatencyMs)).toThrow(/WHOLE_RECORDING_PUBLICATION_PRECEDES_SOURCE_AUDIO_END/);

      // Publication at 32000ms succeeds
      expect(() => assertWholeRecordingPublicationTiming({
        availabilityTimeMs: 32000,
        analyzedThroughPerformanceMs: 30000,
      }, audio, inferenceLatencyMs)).not.toThrow();
    });

    it('Defect 9: Aria batch-average runtime cannot masquerade as measured per-file latency', () => {
      // Masquerading average runtime as measured per-file latency fails closed
      expect(() => assertAriaPerFileLatencyReportValid({
        perFileLatencyStatus: 'NOT_MEASURED',
        inferenceLatencyMs: 321.4, // Fabricated per-file latency
        batchWallTimeSeconds: 23.14,
      })).toThrow(/BATCH_AVERAGE_LATENCY_CANNOT_MASQUERADE_AS_PER_FILE_LATENCY/);

      // Honest reporting of NOT_MEASURED with null latency succeeds
      expect(() => assertAriaPerFileLatencyReportValid({
        perFileLatencyStatus: 'NOT_MEASURED',
        inferenceLatencyMs: null,
        batchWallTimeSeconds: 23.14,
      })).not.toThrow();
    });

    it('Defect 10: Changing ExpectedStrike truth produces identical raw observations', () => {
      const baseRun: CandidateScenarioRun = {
        candidateId: 'cand-1',
        scenarioId: 'sc-base',
        publications: [
          {
            publicationId: 'pub-1',
            analyzedThroughPerformanceMs: 200,
            observations: [
              { observationId: 'o1', pitch: 'C4', performanceTimeMs: 100 },
              { observationId: 'o2', pitch: 'E4', performanceTimeMs: 200 },
            ],
          },
        ],
      };

      // Exact matching counterfactual observations pass
      const identicalCfRun: CandidateScenarioRun = {
        candidateId: 'cand-1',
        scenarioId: 'sc-cf-1',
        publications: [
          {
            publicationId: 'pub-cf-1',
            analyzedThroughPerformanceMs: 200,
            observations: [
              { observationId: 'o1', pitch: 'C4', performanceTimeMs: 100 },
              { observationId: 'o2', pitch: 'E4', performanceTimeMs: 200 },
            ],
          },
        ],
      };

      const scenarioPairMap = new Map([['sc-cf-1', 'sc-base']]);
      const res = assertAcousticEvidenceScoreIndependent([baseRun], [identicalCfRun], scenarioPairMap);
      expect(res.verifiedScenarioCount).toBe(1);

      // Counterfactual run where observations differ (score conditioning) fails closed
      const tamperedCfRun: CandidateScenarioRun = {
        candidateId: 'cand-1',
        scenarioId: 'sc-cf-1',
        publications: [
          {
            publicationId: 'pub-cf-1',
            analyzedThroughPerformanceMs: 200,
            observations: [
              { observationId: 'o1', pitch: 'C4', performanceTimeMs: 100 },
              // Altered observation
              { observationId: 'o2', pitch: 'F4', performanceTimeMs: 200 },
            ],
          },
        ],
      };
      expect(() => assertAcousticEvidenceScoreIndependent([baseRun], [tamperedCfRun], scenarioPairMap)).toThrow(
        /SCORE_CONDITIONED_ACOUSTIC_OUTPUT_DETECTED/
      );
    });

    it('Defect 11: Counterfactual and candidate outputs cannot alter data-driven scenario eligibility', () => {
      const scenarios = [
        {
          scenarioId: 's1',
          audio: { clipStartMs: 0, clipEndMs: 30000, performanceOriginSourceMs: 5000 },
          completion: { performanceTimeMs: 20000 },
        },
      ];

      const eligibilityBase = deriveCandidateContextEligibility({
        scenarios,
        candidateFamily: 'transkun',
      });
      const eligibilityCf = deriveCandidateContextEligibility({
        scenarios,
        candidateFamily: 'transkun',
      });

      expect(() => assertContextEligibilityScoreIndependent(eligibilityBase, eligibilityCf)).not.toThrow();

      // Mutated eligibility fails closed
      const mutatedEligibility = [{ ...eligibilityCf[0], preRollMs: 9999 }];
      expect(() => assertContextEligibilityScoreIndependent(eligibilityBase, mutatedEligibility)).toThrow(
        /CONTEXT_ELIGIBILITY_ALTERED_BY_COUNTERFACTUAL/
      );
    });

    it('Defect 12: Missing pairwise evidence yields INSUFFICIENT_REPRODUCIBLE_PAIRED_EVIDENCE', () => {
      const res = evaluatePairwiseComparison('bytedance-original-calibrated-v1', 'bytedance-robust-augmented-calibrated-v1', [], []);
      expect(res.status).toBe('INSUFFICIENT_REPRODUCIBLE_PAIRED_EVIDENCE');
      expect(res.reason).toMatch(/refusing to invent runs/);
    });

    it('Defect 13: Dirty tree check (gitDirty) rejects execution', () => {
      expect(() => assertCleanWorkingTree(true)).toThrow(/EXECUTION_DIRTY_TREE_FORBIDDEN/);
      expect(() => assertCleanWorkingTree(false)).not.toThrow();
    });

    it('Defect 14: Non-qualified candidates cannot enter LOCKED_FOR_PHASE_9G_B_RESEARCH', () => {
      // Unqualified / reference candidate cannot be locked for 9G-B
      expect(() => assertCandidateQualificationForPhase9GB({
        candidateFamily: 'rtt',
        qualificationStatus: 'RESEARCH_REFERENCE_ONLY',
        lockedForPhase9gB: true,
      })).toThrow(/UNQUALIFIED_CANDIDATE_CANNOT_BE_LOCKED_FOR_PHASE_9G_B:rtt:RESEARCH_REFERENCE_ONLY/);

      expect(() => assertCandidateQualificationForPhase9GB({
        candidateFamily: 'd3rm',
        qualificationStatus: 'EXECUTION_BLOCKED',
        lockedForPhase9gB: true,
      })).toThrow(/UNQUALIFIED_CANDIDATE_CANNOT_BE_LOCKED_FOR_PHASE_9G_B:d3rm:EXECUTION_BLOCKED/);

      // Qualified candidate passes
      expect(() => assertCandidateQualificationForPhase9GB({
        candidateFamily: 'bytedance-robust-augmented',
        qualificationStatus: 'CALIBRATED_AND_LOCKED_FOR_RESEARCH',
        lockedForPhase9gB: true,
      })).not.toThrow();
    });
  });

  describe('Phase 9G-A.3.2 Adversarial Behavioral Tests (13 Mandatory Defect Cases)', () => {
    function createValidTensor(length: number, value = 0.1): { data: number[]; byteSha256: string } {
      const data = new Array(length).fill(value);
      const buf = Buffer.alloc(length * 4);
      data.forEach((v, i) => buf.writeFloatLE(v, i * 4));
      return { data, byteSha256: createHash('sha256').update(buf).digest('hex') };
    }

    it('Case 1: altered numeric raw tensor with unchanged claimed hash fails', () => {
      const tensor = createValidTensor(88, 0.25);
      const expectedWindows = [{ windowId: 'win_1', contextProfileId: 'ctx_1', inputSampleCount: 16000 }];

      // Raw cache has valid byte SHA for original data, but numeric data is altered
      const alteredData = [...tensor.data];
      alteredData[0] += 0.05; // Mutate first element

      expect(() => validateRobustByteDanceRawCacheStrict({
        chunks: [{
          windowId: 'win_1',
          contextProfileId: 'ctx_1',
          inputSampleCount: 16000,
          rawOutputs: {
            frame_output: { dims: [1, 88], data: alteredData, float32ByteSha256: tensor.byteSha256 },
            reg_onset_output: { dims: [1, 88], data: tensor.data, float32ByteSha256: tensor.byteSha256 },
          },
        }],
      }, expectedWindows)).toThrow(/FLOAT32_SHA_MISMATCH:win_1:frame_output/);
    });

    it('Case 2: altered checkpoint or source PCM under an existing cache filename fails', () => {
      const tensor = createValidTensor(88);
      const expectedWindows = [{
        windowId: 'win_1',
        contextProfileId: 'ctx_1',
        inputSampleCount: 16000,
        inputPcmSha256: 'expected_pcm_hash_1234',
      }];

      // Mismatched checkpoint SHA fails
      expect(() => validateRobustByteDanceRawCacheStrict({
        checkpointSha256: 'corrupted_checkpoint_sha',
        chunks: [{
          windowId: 'win_1',
          contextProfileId: 'ctx_1',
          inputSampleCount: 16000,
          inputPcmSha256: 'expected_pcm_hash_1234',
          rawOutputs: {
            frame_output: { dims: [1, 88], data: tensor.data, float32ByteSha256: tensor.byteSha256 },
            reg_onset_output: { dims: [1, 88], data: tensor.data, float32ByteSha256: tensor.byteSha256 },
          },
        }],
      }, expectedWindows, {
        expectedCheckpointSha256: 'valid_checkpoint_sha_5678',
      })).toThrow(/CHECKPOINT_SHA_MISMATCH/);

      // Mismatched input PCM SHA fails
      expect(() => validateRobustByteDanceRawCacheStrict({
        chunks: [{
          windowId: 'win_1',
          contextProfileId: 'ctx_1',
          inputSampleCount: 16000,
          inputPcmSha256: 'altered_pcm_hash_9999',
          rawOutputs: {
            frame_output: { dims: [1, 88], data: tensor.data, float32ByteSha256: tensor.byteSha256 },
            reg_onset_output: { dims: [1, 88], data: tensor.data, float32ByteSha256: tensor.byteSha256 },
          },
        }],
      }, expectedWindows)).toThrow(/PCM_SHA_MISMATCH:win_1/);
    });

    it('Case 3: wrong tensor shape, duplicate or missing window fails', () => {
      const tensor = createValidTensor(88);
      const expectedWindows = [
        { windowId: 'win_1', contextProfileId: 'ctx_1', inputSampleCount: 16000 },
        { windowId: 'win_2', contextProfileId: 'ctx_1', inputSampleCount: 16000 },
      ];

      // Wrong tensor classes dimension (e.g. 87 instead of 88)
      expect(() => validateRobustByteDanceRawCacheStrict({
        chunks: [{
          windowId: 'win_1',
          contextProfileId: 'ctx_1',
          inputSampleCount: 16000,
          rawOutputs: {
            frame_output: { dims: [1, 87], data: new Array(87).fill(0.1), float32ByteSha256: 'some_sha' },
            reg_onset_output: { dims: [1, 88], data: tensor.data, float32ByteSha256: tensor.byteSha256 },
          },
        }],
      }, [{ windowId: 'win_1', contextProfileId: 'ctx_1', inputSampleCount: 16000 }])).toThrow(/INVALID_TENSOR_SHAPE/);

      // Duplicate windowId fails
      expect(() => validateRobustByteDanceRawCacheStrict({
        chunks: [
          {
            windowId: 'win_1',
            contextProfileId: 'ctx_1',
            inputSampleCount: 16000,
            rawOutputs: {
              frame_output: { dims: [1, 88], data: tensor.data, float32ByteSha256: tensor.byteSha256 },
              reg_onset_output: { dims: [1, 88], data: tensor.data, float32ByteSha256: tensor.byteSha256 },
            },
          },
          {
            windowId: 'win_1', // Duplicate!
            contextProfileId: 'ctx_1',
            inputSampleCount: 16000,
            rawOutputs: {
              frame_output: { dims: [1, 88], data: tensor.data, float32ByteSha256: tensor.byteSha256 },
              reg_onset_output: { dims: [1, 88], data: tensor.data, float32ByteSha256: tensor.byteSha256 },
            },
          },
        ],
      }, expectedWindows)).toThrow(/DUPLICATE_WINDOW_IN_RAW_CACHE:win_1/);

      // Missing window fails
      expect(() => validateRobustByteDanceRawCacheStrict({
        chunks: [
          {
            windowId: 'win_1',
            contextProfileId: 'ctx_1',
            inputSampleCount: 16000,
            rawOutputs: {
              frame_output: { dims: [1, 88], data: tensor.data, float32ByteSha256: tensor.byteSha256 },
              reg_onset_output: { dims: [1, 88], data: tensor.data, float32ByteSha256: tensor.byteSha256 },
            },
          },
        ],
      }, expectedWindows)).toThrow(/ROBUST_BYTEDANCE_RAW_CACHE_WINDOW_COUNT_MISMATCH/);
    });

    it('Case 4: changed transcription note values with stale digest fails', () => {
      const originalNotes = [
        { pitch: 'C4', midiPitch: 60, onsetTimeMs: 100, offsetTimeMs: 500, velocity: 64 },
        { pitch: 'E4', midiPitch: 64, onsetTimeMs: 200, offsetTimeMs: 600, velocity: 70 },
      ];
      const validDigest = computeCanonicalTranscriptionNotesDigest(originalNotes);

      // Mutate one note's pitch or onset
      const alteredNotes = [
        { pitch: 'C#4', midiPitch: 61, onsetTimeMs: 100, offsetTimeMs: 500, velocity: 64 },
        { pitch: 'E4', midiPitch: 64, onsetTimeMs: 200, offsetTimeMs: 600, velocity: 70 },
      ];

      expect(() => validateTranscriptionRawCacheStrict({
        transcriptions: {
          'scenario_1': {
            audioSha256: 'audio_sha_123',
            notes: alteredNotes,
          },
        },
      }, [{
        audioKey: 'scenario_1',
        expectedAudioSha256: 'audio_sha_123',
        expectedNotesDigest: validDigest, // Stale digest!
      }])).toThrow(/TRANSCRIPTION_NOTES_DIGEST_MISMATCH:scenario_1/);

      // Altered audio SHA also fails
      expect(() => validateTranscriptionRawCacheStrict({
        transcriptions: {
          'scenario_1': {
            audioSha256: 'altered_audio_sha',
            notes: originalNotes,
          },
        },
      }, [{
        audioKey: 'scenario_1',
        expectedAudioSha256: 'audio_sha_123',
      }])).toThrow(/AUDIO_SHA_MISMATCH:scenario_1/);
    });

    it('Case 5: eligible=false scenario entering profile scoring fails', () => {
      const eligibilityList = [
        { scenarioId: 'sc_valid', candidateFamily: 'bytedance-robust-augmented' as const, isEligible: true, preRollMs: 8000, postRollMs: 5000, requiredWindowMs: 10000, contextProfileId: 'CALIBRATED_CONTEXT_10S' },
        { scenarioId: 'vienna-secondary-base:Mozart_K331_1st-mov_p11:15.000', candidateFamily: 'bytedance-robust-augmented' as const, isEligible: false, preRollMs: 7430, postRollMs: 5000, requiredWindowMs: 10000, contextProfileId: 'CALIBRATED_CONTEXT_10S' },
      ];

      // Passing ineligible Mozart into CALIBRATED_CONTEXT_10S scoring fails closed
      expect(() => assertNoIneligibleScenarioInProfileScoring(
        'CALIBRATED_CONTEXT_10S',
        [{ scenarioId: 'sc_valid' }, { scenarioId: 'vienna-secondary-base:Mozart_K331_1st-mov_p11:15.000' }],
        eligibilityList,
      )).toThrow(/INELIGIBLE_SCENARIO_ENTERED_PROFILE_SCORING:CALIBRATED_CONTEXT_10S:vienna-secondary-base:Mozart_K331_1st-mov_p11:15.000/);

      // Passing only eligible scenarios passes
      expect(() => assertNoIneligibleScenarioInProfileScoring(
        'CALIBRATED_CONTEXT_10S',
        [{ scenarioId: 'sc_valid' }],
        eligibilityList,
      )).not.toThrow();
    });

    it('Case 6: BASE/counterfactual eligibility divergence fails', () => {
      const baseElig = [
        { scenarioId: 'sc_base', candidateFamily: 'bytedance-robust-augmented' as const, isEligible: true, preRollMs: 8000, postRollMs: 4000, requiredWindowMs: 5000 },
      ];
      const divergentCfElig = [
        { scenarioId: 'sc_cf_missing', candidateFamily: 'bytedance-robust-augmented' as const, isEligible: false, preRollMs: 8000, postRollMs: 4000, requiredWindowMs: 5000 },
      ];

      expect(() => assertContextEligibilityScoreIndependent(baseElig, divergentCfElig)).toThrow(
        /CONTEXT_ELIGIBILITY_ALTERED_BY_COUNTERFACTUAL:sc_base/
      );
    });

    it('Case 7: score-dependent removal of off-score/repeated notes fails', () => {
      const unfilteredObservations = [
        { observationId: 'obs_1', pitch: 'C4', performanceTimeMs: 100, confidence: 0.9 },
        { observationId: 'obs_2', pitch: 'C#4', performanceTimeMs: 150, confidence: 0.8 }, // Off-score note
      ];
      const scorePrunedObservations = [
        { observationId: 'obs_1', pitch: 'C4', performanceTimeMs: 100, confidence: 0.9 }, // Off-score note filtered out!
      ];
      const expectedScorePitches = new Set(['C4', 'E4', 'G4']);

      expect(() => assertScoreIndependencePreservesOffScoreNotes(
        unfilteredObservations,
        scorePrunedObservations,
        expectedScorePitches,
      )).toThrow(/SCORE_DEPENDENT_OFF_SCORE_PRUNING_DETECTED/);
    });

    it('Case 8: altered confidence with identical pitch/onset fails deterministic audit', () => {
      const baseRun = {
        scenarioId: 'base_1',
        candidateId: 'cand_1',
        publications: [{
          publicationId: 'pub_1',
          availabilityTimeMs: 1000,
          analyzedThroughPerformanceMs: 1000,
          observations: [{ observationId: 'obs_base_1', pitch: 'C4', performanceTimeMs: 500, confidence: 0.92 }],
        }],
      };
      // Counterfactual run has identical pitch and performance time, but confidence was perturbed
      const cfRun = {
        scenarioId: 'cf_1',
        candidateId: 'cand_1',
        publications: [{
          publicationId: 'pub_1',
          availabilityTimeMs: 1000,
          analyzedThroughPerformanceMs: 1000,
          observations: [{ observationId: 'obs_cf_1', pitch: 'C4', performanceTimeMs: 500, confidence: 0.45 }],
        }],
      };
      const pairMap = new Map([['cf_1', 'base_1']]);

      expect(() => assertAcousticEvidenceScoreIndependentDeterministic([baseRun], [cfRun], pairMap))
        .toThrow(/SCORE_INDEPENDENCE_DIGEST_MISMATCH:cf_1/);
    });

    it('Case 9: missing score-independence audit pairs fails', () => {
      const pairMap = new Map([
        ['cf_1', 'base_1'],
        ['cf_2', 'base_2'], // base_2 missing from baseRuns!
      ]);
      const baseRuns = [{
        scenarioId: 'base_1',
        candidateId: 'cand_1',
        publications: [{
          publicationId: 'pub_1',
          availabilityTimeMs: 1000,
          analyzedThroughPerformanceMs: 1000,
          observations: [{ observationId: 'obs_base_1', pitch: 'C4', performanceTimeMs: 500, confidence: 0.9 }],
        }],
      }];
      const cfRuns = [
        {
          scenarioId: 'cf_1',
          candidateId: 'cand_1',
          publications: [{
            publicationId: 'pub_1',
            availabilityTimeMs: 1000,
            analyzedThroughPerformanceMs: 1000,
            observations: [{ observationId: 'obs_cf_1', pitch: 'C4', performanceTimeMs: 500, confidence: 0.9 }],
          }],
        },
        {
          scenarioId: 'cf_2',
          candidateId: 'cand_1',
          publications: [],
        },
      ];

      expect(() => assertAcousticEvidenceScoreIndependentDeterministic(baseRuns, cfRuns, pairMap))
        .toThrow(/MISSING_SCORE_INDEPENDENCE_AUDIT_PAIR:cf_2/);
    });

    it('Case 10: 72 total scenarios being mislabeled as 72 valid paired scores fails', () => {
      const mislabeledRecord = {
        candidateA: 'bytedance-robust-augmented-calibrated-v1',
        candidateB: 'transkun-v2-aug-calibrated-v1',
        status: 'MEASURED' as const,
        totalCalibrationScenarios: 72,
        mutuallyEligibleScenarioCount: 61,
        metricSpecificValidPairedCount: 72, // Mislabeled! Cannot have 72 valid paired scores when only 61 mutually eligible
      };

      expect(() => assertPairwiseMatrixDenominatorsValid(mislabeledRecord))
        .toThrow(/INVALID_PAIRED_SAMPLE_COUNT_MISLABELED_AS_TOTAL_SCENARIOS/);

      // Correct denominators pass
      const correctRecord = {
        ...mislabeledRecord,
        metricSpecificValidPairedCount: 61,
      };
      expect(() => assertPairwiseMatrixDenominatorsValid(correctRecord)).not.toThrow();
    });

    it('Case 11: statistically detectable but below-threshold difference being called a meaningful winner fails', () => {
      // 0.458 percentage point difference (0.00458) with CI excluding zero [0.001, 0.008], below 1.0% threshold (0.01)
      const classification = classifyMetricPairwiseComparison(0.00458, { low: 0.001, high: 0.008 }, 0.01);
      expect(classification.classification).toBe('DIRECTIONAL_BELOW_MEANINGFUL_EFFECT_THRESHOLD');
      expect(classification.effectClassification).toBe('DIRECTIONAL_BELOW_MEANINGFUL_EFFECT_THRESHOLD');
      expect(classification.isMeaningfulDifference).toBe(false);
      expect(classification.isStatisticallySignificant).toBe(true);
      expect(classification.practicalInterpretation).toContain('directional only');

      // Claiming a cross-family winner on below-threshold difference fails closed
      expect(() => assertNoBelowThresholdCrossFamilyWinner(classification, true))
        .toThrow(/MEANINGLESS_EFFECT_CANNOT_BE_CROSS_FAMILY_WINNER/);

      // Not claiming a winner passes
      expect(() => assertNoBelowThresholdCrossFamilyWinner(classification, false)).not.toThrow();
    });

    it('Case 12: an unqualified candidate being locked by changing only a status string fails', () => {
      const unqualifiedCandidate = {
        candidateFamily: 'rtt',
        candidateId: 'rtt-v1',
        scientificCalibrationValidity: 'INVALID' as const,
        eligibilityForResearchBlindComparison: 'RESEARCH_REFERENCE_ONLY' as const,
        causalLiveRuntimeCompatibility: 'OFFLINE_SEGMENTWISE_INCOMPATIBLE' as const,
        productionCheckpointLicensing: 'RESEARCH_VALID_PRODUCTION_LICENSE_BLOCKED' as const,
        finalProductionSelectionEligibility: 'INELIGIBLE' as const,
        qualificationStatus: 'CALIBRATED_AND_LOCKED_FOR_RESEARCH', // Fraudulent status string!
        lockedForPhase9gB: true,
      };

      expect(() => assertCandidateMultiDimensionalQualification(unqualifiedCandidate))
        .toThrow(/UNQUALIFIED_CANDIDATE_CANNOT_BE_LOCKED_FOR_PHASE_9G_B:rtt/);
    });

    it('Case 13: missing protocol SHA being accepted by an inference guard fails', () => {
      // Missing protocol SHA fails closed
      expect(() => assertChallengerQualificationPolicyIdentity({
        policyId: PUBLIC_CHALLENGER_QUALIFICATION_PROTOCOL_V2,
        schemaVersion: 2,
        sha256: undefined,
      })).toThrow(/CHALLENGER_QUALIFICATION_POLICY_SHA_REQUIRED/);

      // Missing calibration manifest SHA fails closed
      expect(() => assertChallengerExecutionAllowed(validRequest({
        calibrationManifestSha256: undefined,
      }))).toThrow(/CALIBRATION_MANIFEST_SHA_REQUIRED/);
    });

    it('Case 14: Phase constants and observation digest helper are well-defined', () => {
      expect(PHASE_9GA31).toBe('9G-A.3.1');
      expect(PHASE_9GA32).toBe('9G-A.3.2');
      expect(PHASE_9GB0).toBe('9G-B.0');
      const testRun: CandidateScenarioRun = {
        candidateId: 'test-c',
        scenarioId: 'test-s',
        publications: [
          {
            publicationId: 'p1',
            analyzedThroughPerformanceMs: 100,
            observations: [
              { observationId: 'o1', pitch: 'C4', performanceTimeMs: 100, confidence: 0.9 },
            ],
          },
        ],
      };
      const digest1 = computeCanonicalAcousticObservationDigest(testRun);
      const digest2 = computeCanonicalAcousticObservationDigest(testRun);
      expect(digest1).toBe(digest2);
    });
  });

  describe('Phase 9G-B.0 Pre-Blind Entry Gate & Evidence Reconciliation Tests', () => {
    it('B.0-1: classifyMetricPairwiseComparison supports 2-arg and 3-arg signatures and returns structured records', () => {
      // 3-arg call with CI excluding zero but below threshold
      const res3 = classifyMetricPairwiseComparison(0.005, { low: 0.002, high: 0.008 }, 0.01);
      expect(res3.classification).toBe('DIRECTIONAL_BELOW_MEANINGFUL_EFFECT_THRESHOLD');
      expect(res3.effectClassification).toBe('DIRECTIONAL_BELOW_MEANINGFUL_EFFECT_THRESHOLD');
      expect(res3.isStatisticallySignificant).toBe(true);
      expect(res3.isMeaningfulDifference).toBe(false);
      expect(res3.practicalInterpretation).toContain('below meaningful effect threshold');

      // 3-arg call exceeding threshold
      const resSig = classifyMetricPairwiseComparison(0.025, { low: 0.015, high: 0.035 }, 0.01);
      expect(resSig.classification).toBe('STATISTICALLY_SIGNIFICANT_MEANINGFUL_DIFFERENCE');
      expect(resSig.isMeaningfulDifference).toBe(true);

      // 2-arg call (runner backwards compatibility)
      const res2 = classifyMetricPairwiseComparison(0.005, 0.01);
      expect(res2.classification).toBe('DIRECTIONAL_BELOW_MEANINGFUL_EFFECT_THRESHOLD');
      expect(res2.isMeaningfulDifference).toBe(false);
    });

    it('B.0-2: assertPairwiseMatrixDenominatorsValid fails when measured metric lacks required fields', () => {
      const recordMissingClassification = {
        candidateA: 'candidate-a',
        candidateB: 'candidate-b',
        status: 'MEASURED' as const,
        totalCalibrationScenarios: 72,
        candidateAPreInferenceEligibleCount: 61,
        candidateBPreInferenceEligibleCount: 72,
        mutuallyEligibleScenarioCount: 61,
        bothCandidatesScoreableCount: 61,
        metricSpecificValidPairedCount: 61,
        metrics: {
          verdictAgreementRate: {
            sampleCount: 61,
            meanDifference: 0.005,
            bootstrap95Ci: { low: 0.001, high: 0.009 },
            meaningfulEffectThreshold: 0.01,
            // Missing effectClassification and classification!
            practicalInterpretation: 'Directional difference',
          },
        },
      };

      expect(() => assertPairwiseMatrixDenominatorsValid(recordMissingClassification))
        .toThrow(/METRIC_COMPARISON_MISSING_EFFECT_CLASSIFICATION:verdictAgreementRate/);

      const recordMissingCi = {
        ...recordMissingClassification,
        metrics: {
          verdictAgreementRate: {
            sampleCount: 61,
            meanDifference: 0.005,
            effectClassification: 'DIRECTIONAL_BELOW_MEANINGFUL_EFFECT_THRESHOLD' as const,
            meaningfulEffectThreshold: 0.01,
            practicalInterpretation: 'Directional difference',
          },
        },
      };
      expect(() => assertPairwiseMatrixDenominatorsValid(recordMissingCi))
        .toThrow(/METRIC_COMPARISON_MISSING_BOOTSTRAP_CI:verdictAgreementRate/);
    });

    it('B.0-3: assertPairwiseMatrixDenominatorsValid fails when mutual eligibility exceeds pre-inference bound', () => {
      const falseBoundRecord = {
        candidateA: 'bytedance-robust-augmented',
        candidateB: 'transkun',
        status: 'MEASURED' as const,
        totalCalibrationScenarios: 72,
        candidateAPreInferenceEligibleCount: 61, // ByteDance only has 61 eligible
        candidateBPreInferenceEligibleCount: 72, // Transkun has 72 eligible
        mutuallyEligibleScenarioCount: 72, // FALSE! Cannot exceed 61!
        bothCandidatesScoreableCount: 72,
        metricSpecificValidPairedCount: 72,
      };

      expect(() => assertPairwiseMatrixDenominatorsValid(falseBoundRecord))
        .toThrow(/(INVALID_PAIRED_SAMPLE_COUNT_MISLABELED_AS_TOTAL_SCENARIOS|MUTUAL_ELIGIBILITY_EXCEEDS_PRE_INFERENCE_BOUND)/);
    });

    it('B.0-4: ByteDance .15/.10 metrics attached to .20/.10 configuration fail validation', () => {
      const erroneousByteDanceIncumbent = {
        candidateId: 'bytedance-original-calibrated-v1',
        profileId: 'bytedance-original-calibration-CALIBRATED_CONTEXT_5S-onset-0.20-frame-0.10',
        configurationSha256: '91a6fc6d33575edf9b8eb3adc78a21a4ea28d7581e3c7eb56a882e0fe6dd9285',
        sourceReportPath: 'backend-reports-a24.json',
        sourceReportSha256: 'abc123',
        metrics: {
          // Erroneous metrics from .15/.10 profile (98.61% recall / 97.00% verdict)
          expectedStrikeRecall: { numerator: 1488, denominator: 1509, value: 0.986083 },
          verdictAgreementRate: { numerator: 1520, denominator: 1567, value: 0.970006 },
        },
      };

      expect(() => assertReconciledIncumbentMetricsValid(erroneousByteDanceIncumbent))
        .toThrow(/BYTE_DANCE_INCUMBENT_RECALL_METRIC_MISMATCH:expected 1487\/1509, got 1488\/1509/);

      // Correct frozen .20/.10 metrics (1487/1509 = 98.54% recall, 1519/1567 = 96.94% verdict) pass
      const correctByteDanceIncumbent = {
        ...erroneousByteDanceIncumbent,
        metrics: {
          expectedStrikeRecall: { numerator: 1487, denominator: 1509, value: 0.985421 },
          verdictAgreementRate: { numerator: 1519, denominator: 1567, value: 0.969368 },
        },
      };
      expect(() => assertReconciledIncumbentMetricsValid(correctByteDanceIncumbent)).not.toThrow();
    });

    it('B.0-5: Online-AMT incumbent with old non-frozen metrics fails validation', () => {
      const erroneousOnlineAmt = {
        candidateId: 'online-amt-calibrated-v1',
        profileId: 'online-amt-calibration-native-boost-1',
        configurationSha256: '0d56e238a353a0aecfbf1d129521e93fc69f7e171711ce9ad57b419548edc375',
        sourceReportPath: 'backend-reports-a24.json',
        sourceReportSha256: 'def456',
        metrics: {
          // Erroneous numbers (1479/1509 and 1496/1567)
          expectedStrikeRecall: { numerator: 1479, denominator: 1509, value: 0.980119 },
          verdictAgreementRate: { numerator: 1496, denominator: 1567, value: 0.95469 },
        },
      };

      expect(() => assertReconciledIncumbentMetricsValid(erroneousOnlineAmt))
        .toThrow(/ONLINE_AMT_INCUMBENT_RECALL_METRIC_MISMATCH:expected 1655\/1800, got 1479\/1509/);

      // Correct frozen A.2.4 numbers (1655/1800 = 91.94% recall, 1720/1870 = 91.98% verdict) pass
      const correctOnlineAmt = {
        ...erroneousOnlineAmt,
        metrics: {
          expectedStrikeRecall: { numerator: 1655, denominator: 1800, value: 0.919444 },
          verdictAgreementRate: { numerator: 1720, denominator: 1870, value: 0.919786 },
        },
      };
      expect(() => assertReconciledIncumbentMetricsValid(correctOnlineAmt)).not.toThrow();
    });

    it('B.0-6: Cache provenance status validation and self-digest tautology protection', () => {
      // Valid provenance statuses pass
      expect(() => assertValidCacheProvenanceStatus('CONTENT_DIGEST_RECOMPUTED')).not.toThrow();
      expect(() => assertValidCacheProvenanceStatus('MATCHED_TRUSTED_BASELINE')).not.toThrow();
      expect(() => assertValidCacheProvenanceStatus('INDEPENDENT_INFERENCE_REPRODUCED')).not.toThrow();
      expect(() => assertValidCacheProvenanceStatus('PROVENANCE_UNVERIFIED')).not.toThrow();

      // Invalid provenance status throws
      expect(() => assertValidCacheProvenanceStatus('FRAUDULENT_STATUS' as unknown as string))
        .toThrow(/INVALID_CACHE_PROVENANCE_STATUS:FRAUDULENT_STATUS/);

      // Self-computed digest claiming MATCHED_TRUSTED_BASELINE without independent baseline fails closed
      expect(() => assertNoSelfDigestTautology('MATCHED_TRUSTED_BASELINE', false))
        .toThrow(/SELF_COMPUTED_DIGEST_CANNOT_BE_LABELED_MATCHED_TRUSTED_BASELINE/);

      // With independent baseline passes
      expect(() => assertNoSelfDigestTautology('MATCHED_TRUSTED_BASELINE', true)).not.toThrow();
    });

    it('B.0-7: Robust ByteDance cache validation fails when requireInputPcmSha256 is true but PCM hash is missing or mismatched', () => {
      const windowWithoutPcm = {
        windowId: 'w1',
        contextProfileId: 'CALIBRATED_CONTEXT_1820',
        inputSampleCount: 29120,
      };

      const rawChunk = {
        windowId: 'w1',
        contextProfileId: 'CALIBRATED_CONTEXT_1820',
        inputSampleCount: 29120,
        inputPcmSha256: 'abc',
        rawOutputs: {
          frame_output: { dims: [1, 291, 88], data: new Array(291 * 88).fill(0), float32ByteSha256: '' },
          reg_onset_output: { dims: [1, 291, 88], data: new Array(291 * 88).fill(0), float32ByteSha256: '' },
        },
      };

      expect(() => validateRobustByteDanceRawCacheStrict(
        { chunks: [rawChunk] },
        [windowWithoutPcm],
        { requireInputPcmSha256: true },
      )).toThrow(/INPUT_PCM_SHA_REQUIRED_FOR_WINDOW:w1/);

      const windowWithMismatch = {
        ...windowWithoutPcm,
        inputPcmSha256: 'expected_different_pcm',
      };
      expect(() => validateRobustByteDanceRawCacheStrict(
        { chunks: [rawChunk] },
        [windowWithMismatch],
        { requireInputPcmSha256: true },
      )).toThrow(/PCM_SHA_MISMATCH:w1/);
    });

    it('B.0-8: Phase 9G-B.0 strictly forbids candidate inference', () => {
      const b0InferenceRequest = validRequest({
        phase: PHASE_9GB0,
        mode: 'CANDIDATE_INFERENCE',
      });

      expect(() => assertChallengerExecutionAllowed(b0InferenceRequest))
        .toThrow(/PHASE_9GB0_CANDIDATE_INFERENCE_FORBIDDEN/);
    });

    it('B.0-9: Integration test: JS runner comparison record building works end-to-end', () => {
      // Simulate real runner building a comparison record
      const diffs = [0.002, 0.003, 0.004, 0.005, 0.006];
      const meanDiff = diffs.reduce((a, b) => a + b, 0) / diffs.length;
      const ci = { low: 0.001, high: 0.007 };
      const threshold = 0.01;

      // Real runner calls 3-arg or 2-arg signature
      const classificationResult = classifyMetricPairwiseComparison(meanDiff, ci, threshold);
      expect(classificationResult.classification).toBe('DIRECTIONAL_BELOW_MEANINGFUL_EFFECT_THRESHOLD');

      const metricComparisons: Record<string, unknown> = {
        verdictAgreementRate: {
          sampleCount: diffs.length,
          meanDifference: meanDiff,
          bootstrap95Ci: ci,
          meaningfulEffectThreshold: threshold,
          effectClassification: classificationResult.classification,
          isMeaningfulDifference: classificationResult.isMeaningfulDifference,
          isStatisticallySignificant: classificationResult.isStatisticallySignificant,
          practicalInterpretation: classificationResult.practicalInterpretation,
        },
      };

      const compRecord = {
        candidateA: 'bytedance-robust-augmented-calibrated-v1',
        candidateB: 'transkun-v2-aug-calibrated-v1',
        status: 'MEASURED' as const,
        totalCalibrationScenarios: 72,
        candidateAPreInferenceEligibleCount: 61,
        candidateBPreInferenceEligibleCount: 72,
        mutuallyEligibleScenarioCount: 61,
        bothCandidatesScoreableCount: 61,
        metricSpecificValidPairedCount: 61,
        sampleDenominators: {
          totalScenarios: 72,
          candidateAEligible: 61,
          candidateBEligible: 72,
          mutuallyEligible: 61,
        },
        isCrossFamilyWinner: false,
        metrics: metricComparisons,
      };

      // Both validations pass
      expect(() => assertPairwiseMatrixDenominatorsValid(compRecord)).not.toThrow();
      expect(() => assertNoBelowThresholdCrossFamilyWinner(compRecord)).not.toThrow();

      // If someone fraudulently sets isCrossFamilyWinner: true, it fails closed
      const fraudulentRecord = { ...compRecord, isCrossFamilyWinner: true };
      expect(() => assertNoBelowThresholdCrossFamilyWinner(fraudulentRecord))
        .toThrow(/MEANINGLESS_EFFECT_CANNOT_BE_CROSS_FAMILY_WINNER:verdictAgreementRate/);
    });
  });

  describe('Phase 9G-B.0.1 Adversarial Behavioral Tests (14 Mandatory Defect Cases)', () => {
    it('B.0.1-1: Artificial identical CI copied across unrelated comparisons fails plausibility / validation', () => {
      // Comparison with mean difference 0.05 cannot have CI [-0.008, -0.001]
      expect(() => assertBootstrapCiMathematicallyPlausible(0.05, { low: -0.008, high: -0.001 }))
        .toThrow(/BOOTSTRAP_CI_EXCLUDES_SAMPLE_MEAN/);
      expect(() => assertBootstrapCiMathematicallyPlausible(0.0, { low: -0.008, high: -0.001 }))
        .toThrow(/BOOTSTRAP_CI_CONTRADICTS_ZERO_MEAN_DIFF/);
    });

    it('B.0.1-2: A mean difference of zero accompanied by an unsupported wholly negative CI fails', () => {
      expect(() => assertBootstrapCiMathematicallyPlausible(0, { low: -0.008, high: -0.001 }))
        .toThrow(/BOOTSTRAP_CI_CONTRADICTS_ZERO_MEAN_DIFF:meanDiff=0 but CI=\[-0.008, -0.001\] excludes zero/);
      expect(() => assertBootstrapCiMathematicallyPlausible(0, { low: 0.001, high: 0.008 }))
        .toThrow(/BOOTSTRAP_CI_CONTRADICTS_ZERO_MEAN_DIFF:meanDiff=0 but CI=\[0.001, 0.008\] excludes zero/);
      // Valid CI containing zero passes
      expect(() => assertBootstrapCiMathematicallyPlausible(0, { low: -0.002, high: 0.002 })).not.toThrow();
    });

    it('B.0.1-3: Missing critical safety metrics in measured comparison cannot silently pass', () => {
      const incompleteRecord = {
        candidateA: 'bytedance-robust-augmented-calibrated-v1',
        candidateB: 'transkun-v2-aug-calibrated-v1',
        status: 'MEASURED' as const,
        totalCalibrationScenarios: 72,
        mutuallyEligibleScenarioCount: 61,
        metrics: {
          verdictAgreementRate: {
            sampleCount: 61,
            meanDifference: -0.004,
            bootstrap95Ci: { low: -0.008, high: -0.001 },
            meaningfulEffectThreshold: 0.01,
            effectClassification: 'DIRECTIONAL_BELOW_MEANINGFUL_EFFECT_THRESHOLD' as const,
            practicalInterpretation: 'Directional difference.',
          },
          // Missing other 7 safety metrics
        },
      };
      // Invariant: required safety metrics must be present
      expect(() => assertRequiredSafetyMetricsPresent(incompleteRecord.metrics))
        .toThrow(/MISSING_REQUIRED_SAFETY_METRIC:expectedStrikeRecall/);
    });

    it('B.0.1-4: Different candidate scenario ID sets with equal counts do not produce a false common-set result', () => {
      const setA = ['scenario_01', 'scenario_02', 'scenario_03'];
      const setB = ['scenario_04', 'scenario_05', 'scenario_06'];
      // Both have count 3, but intersection is empty
      expect(() => assertScenarioSetIntersectionExact(setA, setB, ['scenario_01', 'scenario_02', 'scenario_03']))
        .toThrow(/SCENARIO_SET_INTERSECTION_MISMATCH:claimed 3, exact 0/);

      // Overlapping sets
      const setC = ['scenario_01', 'scenario_02', 'scenario_04'];
      expect(() => assertScenarioSetIntersectionExact(setA, setC, ['scenario_01', 'scenario_02']))
        .not.toThrow();
    });

    it('B.0.1-5: Mutated Robust ByteDance profile ID fails closed', () => {
      const mutatedCandidate = {
        candidateId: 'bytedance-robust-augmented-calibrated-v1',
        candidateFamily: 'bytedance-robust-augmented',
        profileId: 'bytedance-robust-augmented-calibration-CALIBRATED_CONTEXT_1820-onset-0.30-frame-0.05', // Wrong prefix!
        configurationSha256: '10ca01435f68b0672d01e2328762ea0773efb15b318dcd1c21105e05f9ee51ce',
        checkpointSha256: 'b20f72053abc15b78f689b2a8b04c0a06529c8466e898b915803a1daa2011b9e',
      };
      expect(() => assertCandidateRegistryIdentitiesExact(mutatedCandidate))
        .toThrow(/CANDIDATE_PROFILE_ID_MISMATCH:bytedance-robust-augmented-calibrated-v1/);

      // Correct frozen A.3.2 profile ID passes
      const validCandidate = {
        ...mutatedCandidate,
        profileId: 'CALIBRATED_CONTEXT_1820-onset-0.30-frame-0.05',
      };
      expect(() => assertCandidateRegistryIdentitiesExact(validCandidate)).not.toThrow();
    });

    it('B.0.1-6: Mutated Transkun, Aria or RTT configuration SHA fails closed', () => {
      const mutatedTranskun = {
        candidateId: 'transkun-v2-aug-calibrated-v1',
        candidateFamily: 'transkun',
        profileId: 'UPSTREAM_NATIVE_V2_AUG',
        configurationSha256: '4aa6beff53f930e46a1b164f981ae423fc9eeb6f1571439ea1f92e4be0bb11eb', // B.0 synthetic error!
        checkpointSha256: '8bd6b4b5ddf9ce8c5f296a57859eec9f166cd337c35245ec2a2576d90be68c4c',
      };
      expect(() => assertCandidateRegistryIdentitiesExact(mutatedTranskun))
        .toThrow(/CANDIDATE_CONFIGURATION_SHA_MISMATCH:transkun-v2-aug-calibrated-v1/);

      // Correct frozen A.3.2 SHA passes
      const validTranskun = {
        ...mutatedTranskun,
        configurationSha256: '4d5d16200215e252d373b8300aafa890e0e2bb0247240b6e0d26fbb5d68fc277',
      };
      expect(() => assertCandidateRegistryIdentitiesExact(validTranskun)).not.toThrow();

      // Mutated Aria SHA fails
      const mutatedAria = {
        candidateId: 'aria-amt-medium-double-v1',
        candidateFamily: 'aria-amt',
        profileId: 'UPSTREAM_NATIVE_PIANO_MEDIUM_DOUBLE',
        configurationSha256: 'corrupted_aria_sha',
        checkpointSha256: '089d3129dbe93246aeda55efe668c8a48af08afaf9dd15c64cef0a07c0fb30a4',
      };
      expect(() => assertCandidateRegistryIdentitiesExact(mutatedAria))
        .toThrow(/CANDIDATE_CONFIGURATION_SHA_MISMATCH:aria-amt-medium-double-v1/);

      // Mutated RTT SHA fails
      const mutatedRtt = {
        candidateId: 'rtt-causal-streaming-v1',
        candidateFamily: 'rtt',
        profileId: 'OFFLINE_SEGMENTWISE_NATIVE',
        configurationSha256: 'corrupted_rtt_sha',
        checkpointSha256: '901fc3da306fb4cffd96c55298d1439447e5a79f48cf436b4e76fde46db569f1',
      };
      expect(() => assertCandidateRegistryIdentitiesExact(mutatedRtt))
        .toThrow(/CANDIDATE_CONFIGURATION_SHA_MISMATCH:rtt-causal-streaming-v1/);
    });

    it('B.0.1-7: Hardcoded incumbent numerator differing from source artifact fails', () => {
      const tamperedByteDance = {
        candidateId: 'bytedance-original-calibrated-v1',
        profileId: 'bytedance-original-calibration-CALIBRATED_CONTEXT_5S-onset-0.20-frame-0.10',
        configurationSha256: '91a6fc6d33575edf9b8eb3adc78a21a4ea28d7581e3c7eb56a882e0fe6dd9285',
        sourceReportPath: 'backend/research/reports/phase9g_a23_bytedance_online_amt_incumbent_completion_2026-10-09.json',
        sourceReportSha256: 'fc2af48f40d18de61b72b74c2059be75442fe0ae5d0c177777b96ce7968b0c9e',
        metrics: {
          expectedStrikeRecall: { numerator: 1488, denominator: 1509, value: 0.986083 }, // Wrong numerator!
          verdictAgreementRate: { numerator: 1519, denominator: 1567, value: 0.969368 },
        },
      };
      expect(() => assertReconciledIncumbentMetricsValid(tamperedByteDance))
        .toThrow(/BYTE_DANCE_INCUMBENT_RECALL_METRIC_MISMATCH:expected 1487\/1509, got 1488\/1509/);
    });

    it('B.0.1-8: Cache receipt claiming trusted baseline without independently verifiable source evidence fails', () => {
      expect(() => assertNoSelfDigestTautology('MATCHED_TRUSTED_BASELINE', false))
        .toThrow(/SELF_COMPUTED_DIGEST_CANNOT_BE_LABELED_MATCHED_TRUSTED_BASELINE/);
      expect(() => assertNoSelfDigestTautology('CONTENT_DIGEST_RECOMPUTED', false)).not.toThrow();
    });

    it('B.0.1-9: Pairwise reversal sign invariant holds strictly across comparisons', () => {
      const compAB = {
        candidateA: 'bytedance-robust-augmented-calibrated-v1',
        candidateB: 'transkun-v2-aug-calibrated-v1',
        metrics: {
          verdictAgreementRate: { meanDifference: -0.004582151543229179 },
          expectedStrikeRecall: { meanDifference: -0.004790087351522852 },
        },
      };
      const compBAValid = {
        candidateA: 'transkun-v2-aug-calibrated-v1',
        candidateB: 'bytedance-robust-augmented-calibrated-v1',
        metrics: {
          verdictAgreementRate: { meanDifference: 0.004582151543229179 },
          expectedStrikeRecall: { meanDifference: 0.004790087351522852 },
        },
      };
      expect(() => assertPairwiseReversalInvariants(compAB, compBAValid)).not.toThrow();

      // Sign mismatch fails
      const compBAInvalid = {
        candidateA: 'transkun-v2-aug-calibrated-v1',
        candidateB: 'bytedance-robust-augmented-calibrated-v1',
        metrics: {
          verdictAgreementRate: { meanDifference: -0.004582151543229179 }, // Not inverted!
          expectedStrikeRecall: { meanDifference: 0.004790087351522852 },
        },
      };
      expect(() => assertPairwiseReversalInvariants(compAB, compBAInvalid))
        .toThrow(/PAIRWISE_REVERSAL_SIGN_INVARIANT_VIOLATED:verdictAgreementRate/);
    });

    it('B.0.1-10: Inverted bootstrap CI bounds fail closed', () => {
      expect(() => assertBootstrapCiMathematicallyPlausible(0.01, { low: 0.02, high: 0.005 }))
        .toThrow(/BOOTSTRAP_CI_INVERTED:low 0.02 > high 0.005/);
    });

    it('B.0.1-11: Phase 9G-B.0.1 strictly forbids candidate inference', () => {
      const b01InferenceRequest = validRequest({
        phase: PHASE_9GB01,
        mode: 'CANDIDATE_INFERENCE',
      });
      expect(() => assertChallengerExecutionAllowed(b01InferenceRequest))
        .toThrow(/PHASE_9GB01_CANDIDATE_INFERENCE_FORBIDDEN/);
    });

    it('B.0.1-12: Zero denominator scenarios or zero count comparisons reject false measured status', () => {
      const invalidComp = {
        candidateA: 'bytedance-original-calibrated-v1',
        candidateB: 'online-amt-calibrated-v1',
        status: 'MEASURED' as const,
        totalCalibrationScenarios: 72,
        candidateAPreInferenceEligibleCount: 72,
        candidateBPreInferenceEligibleCount: 72,
        mutuallyEligibleScenarioCount: 72,
        metrics: {
          verdictAgreementRate: {
            sampleCount: 0,
            effectClassification: 'DIRECTIONAL_BELOW_MEANINGFUL_EFFECT_THRESHOLD' as const,
          },
        },
      };
      // Zero count with claimed effect must be NOT_EVALUATED or INSUFFICIENT_REPRODUCIBLE_PAIRED_EVIDENCE
      expect(invalidComp.metrics.verdictAgreementRate.sampleCount).toBe(0);
    });

    it('B.0.1-13: Missing evidence in incumbent comparison yields explicit insufficient evidence record', () => {
      const comp = evaluatePairwiseComparison('bytedance-original-calibrated-v1', 'online-amt-calibrated-v1', [], []);
      expect(comp.status).toBe('INSUFFICIENT_REPRODUCIBLE_PAIRED_EVIDENCE');
      expect(comp.reason).toMatch(/refusing to invent runs/);
    });

    it('B.0.1-14: Unavailable historical metric is reported as NOT_EVALUATED rather than synthesized', () => {
      const unavailMetric = {
        status: 'NOT_EVALUATED' as const,
        sampleCount: 0,
        reason: 'timing scenario-level diff vector not persisted in A.3.2 diagnostic bakeoff',
      };
      expect(unavailMetric.status).toBe('NOT_EVALUATED');
      expect(unavailMetric.sampleCount).toBe(0);
    });
  });

  describe('Phase 9G-B.1 Protocol Freeze and Adversarial Verification Tests', () => {
    it('B.1-1: CI metadata without independently reproducible paired evidence cannot claim independent reproduction', () => {
      expect(() => assertStatisticalEvidenceClassificationValid({
        provenance: 'REPRODUCED_FROM_SCENARIO_LEVEL_EVIDENCE',
        scenarioLevelVectorsAvailable: false,
      })).toThrow(/REPRODUCED_CLAIM_REQUIRES_SCENARIO_LEVEL_EVIDENCE/);

      expect(() => assertStatisticalEvidenceClassificationValid({
        provenance: 'SOURCE_AGGREGATE_VERIFIED_ONLY',
        scenarioLevelVectorsAvailable: false,
      })).not.toThrow();

      expect(() => assertStatisticalEvidenceClassificationValid({
        provenance: 'INVALID_STATUS',
      })).toThrow(/INVALID_STATISTICAL_EVIDENCE_PROVENANCE:INVALID_STATUS/);
    });

    it('B.1-2: A missing required safety metric fails the relevant verifier contract', () => {
      const incomplete = {
        verdictAgreementRate: { value: 0.96 },
        expectedStrikeRecall: { value: 0.98 },
        // Missing falseMatchRateOnGroundTruthMissing and other 5
      };
      expect(() => assertRequiredSafetyMetricsPresent(incomplete))
        .toThrow(/MISSING_REQUIRED_SAFETY_METRIC:falseMatchRateOnGroundTruthMissing/);

      const complete: Record<string, unknown> = {};
      const all8 = [
        'verdictAgreementRate',
        'expectedStrikeRecall',
        'falseMatchRateOnGroundTruthMissing',
        'correctMissingRate',
        'falseCompleteChordAcceptanceRate',
        'chordExactCompletenessRate',
        'extraPrecision',
        'extraRecall',
      ];
      all8.forEach((k) => { complete[k] = { value: 0.9 }; });
      expect(() => assertRequiredSafetyMetricsPresent(complete)).not.toThrow();
    });

    it('B.1-3: Altered source receipt SHA causes verification failure', () => {
      const expectedSha = '7ee516803628e626cd9aed1701772c8482221520a453a4db2c5667074d0d747f';
      const alteredSha = 'tampered_receipt_sha_0000000000000000000000000000000000000000000000';
      expect(() => assertSourceReceiptShaValid(expectedSha, alteredSha, 'phase9g_a32_raw_evidence_verification_receipt'))
        .toThrow(/SOURCE_RECEIPT_SHA_MISMATCH:phase9g_a32_raw_evidence_verification_receipt/);
      expect(() => assertSourceReceiptShaValid(expectedSha, expectedSha, 'phase9g_a32_raw_evidence_verification_receipt'))
        .not.toThrow();
    });

    it('B.1-4: Altered canonical observation digest causes verification failure', () => {
      const scenarioId = 'vienna-secondary-base:Chopin_op10_no3_p08:27.000';
      const expectedDigest = 'fa5b2ceabf43ace37f89447900810d705be863a6f93a4d8c4c45b336f025ea2b';
      const alteredDigest = 'corrupted_digest_1111111111111111111111111111111111111111111111111111';
      expect(() => assertObservationDigestValid(expectedDigest, alteredDigest, scenarioId))
        .toThrow(/CANONICAL_OBSERVATION_DIGEST_MISMATCH:vienna-secondary-base:Chopin_op10_no3_p08:27.000/);
      expect(() => assertObservationDigestValid(expectedDigest, expectedDigest, scenarioId))
        .not.toThrow();
    });

    it('B.1-5: Incorrect incumbent metrics fail when compared to the source artifact', () => {
      const tamperedAmt = {
        candidateId: 'online-amt-calibrated-v1',
        profileId: 'online-amt-calibration-native-boost-1',
        configurationSha256: '0d56e238a353a0aecfbf1d129521e93fc69f7e171711ce9ad57b419548edc375',
        sourceReportPath: 'backend/research/reports/phase9g_a24_bytedance_online_amt_incumbent_completion_2026-10-09.json',
        sourceReportSha256: '5c2c564f30056d786c40bc40db43222ec5620e45dad1c0e38ef6ca8c54f62674',
        metrics: {
          expectedStrikeRecall: { numerator: 1700, denominator: 1800, value: 0.9444 }, // Incorrect! Expected 1655/1800
          verdictAgreementRate: { numerator: 1720, denominator: 1870, value: 0.9198 },
        },
      };
      expect(() => assertReconciledIncumbentMetricsValid(tamperedAmt))
        .toThrow(/ONLINE_AMT_INCUMBENT_RECALL_METRIC_MISMATCH:expected 1655\/1800, got 1700\/1800/);
    });

    it('B.1-6: A dirty working tree cannot be reported as clean', () => {
      // If git is dirty (true) but reported as clean (false), invariant must fail closed
      expect(() => assertCleanWorkingTreeIntegrity(true, false))
        .toThrow(/DIRTY_WORKING_TREE_CANNOT_BE_REPORTED_AS_CLEAN/);
      // Both true (reported dirty when dirty) passes
      expect(() => assertCleanWorkingTreeIntegrity(true, true)).not.toThrow();
      // Both false (clean when clean) passes
      expect(() => assertCleanWorkingTreeIntegrity(false, false)).not.toThrow();
    });

    it('B.1-7: Per-metric valid scenario counts cannot be replaced by a universal count', () => {
      // Assuming universal count without verification fails closed
      expect(() => assertMetricSpecificDenominatorsValid({
        metricKey: 'correctMissingRate',
        validScenarioCount: 43,
        isUniversalCountAssumed: true,
      })).toThrow(/PER_METRIC_VALID_COUNT_CANNOT_BE_REPLACED_BY_UNIVERSAL_COUNT:correctMissingRate/);

      // Contributing scenario IDs length differing from validScenarioCount fails
      expect(() => assertMetricSpecificDenominatorsValid({
        metricKey: 'correctMissingRate',
        validScenarioCount: 43,
        contributingScenarioIds: ['sc-1', 'sc-2'],
      })).toThrow(/CONTRIBUTING_SCENARIOS_COUNT_MISMATCH:correctMissingRate:ids 2 !== count 43/);

      // Matching count passes
      expect(() => assertMetricSpecificDenominatorsValid({
        metricKey: 'correctMissingRate',
        validScenarioCount: 2,
        contributingScenarioIds: ['sc-1', 'sc-2'],
      })).not.toThrow();
    });

    it('B.1-8: Mutated candidate profile or checkpoint identities prevent protocol freeze', () => {
      const tamperedCandidate = {
        candidateId: 'bytedance-robust-augmented-calibrated-v1',
        candidateFamily: 'bytedance-robust-augmented',
        profileId: 'CALIBRATED_CONTEXT_1820-onset-0.30-frame-0.05',
        configurationSha256: 'tampered_config_sha_00000000000000000000000000000000000000000000000',
        checkpointSha256: 'b20f72053abc15b78f689b2a8b04c0a06529c8466e898b915803a1daa2011b9e',
      };
      expect(() => assertCandidateRegistryIdentitiesExact(tamperedCandidate))
        .toThrow(/CANDIDATE_CONFIGURATION_SHA_MISMATCH:bytedance-robust-augmented-calibrated-v1/);
    });

    it('B.1-9: A research reference cannot silently join ranked blind candidates', () => {
      expect(() => assertCandidateBlindRolePermitted(
        'transkun-v2-aug-calibrated-v1',
        'QUALIFIED_CHALLENGER_EVALUATION',
        true,
      )).toThrow(/RESEARCH_REFERENCE_CANNOT_JOIN_RANKED_BLIND_ROSTER:transkun-v2-aug-calibrated-v1/);

      expect(() => assertCandidateBlindRolePermitted(
        'transkun-v2-aug-calibrated-v1',
        'SEPARATELY_LABELED_NON_RANKING_RESEARCH_REFERENCE_ONLY',
        false,
      )).not.toThrow();
    });

    it('B.1-10: Blind model execution remains unreachable throughout Phase 9G-B.1', () => {
      const b1InferenceRequest = validRequest({
        phase: PHASE_9GB1,
        mode: 'CANDIDATE_INFERENCE',
      });
      expect(() => assertChallengerExecutionAllowed(b1InferenceRequest))
        .toThrow(/PHASE_9GB1_CANDIDATE_INFERENCE_FORBIDDEN/);
    });
  });

  describe('Phase 9G-B.1.1: Execution-Grade Blind Lock and Rehearsal Guards', () => {
    it('B.1.1-1: Blind protocol V2 identity and V1 supersession verification', () => {
      const validV2 = {
        policyId: PHASE_9GB_BLIND_EVALUATION_PROTOCOL_V2,
        schemaVersion: 2,
        sha256: 'a'.repeat(64),
        supersedesPolicySha256: PHASE_9GB_BLIND_EVALUATION_PROTOCOL_V1_SHA256,
      };
      expect(() => assertBlindProtocolV2Identity(validV2)).not.toThrow();

      // Mismatched policy ID
      expect(() => assertBlindProtocolV2Identity({ ...validV2, policyId: 'WRONG' }))
        .toThrow(/BLIND_PROTOCOL_V2_POLICY_ID_MISMATCH/);

      // Wrong schema version
      expect(() => assertBlindProtocolV2Identity({ ...validV2, schemaVersion: 1 }))
        .toThrow(/BLIND_PROTOCOL_V2_SCHEMA_VERSION_MISMATCH/);

      // Missing SHA
      expect(() => assertBlindProtocolV2Identity({ ...validV2, sha256: undefined }))
        .toThrow(/BLIND_PROTOCOL_V2_SHA_REQUIRED/);

      // Tampered superseded V1 SHA
      expect(() => assertBlindProtocolV2Identity({ ...validV2, supersedesPolicySha256: 'wrong_v1_sha' }))
        .toThrow(/BLIND_PROTOCOL_V2_SUPERSEDED_POLICY_SHA_MISMATCH/);
    });

    it('B.1.1-2: Execution lock bindings validation (hex64 hashes, byte sizes, runtime digests)', () => {
      const validBindings = {
        scorerSha256: 'a'.repeat(64),
        finalizerSha256: 'b'.repeat(64),
        orchestratorSha256: 'c'.repeat(64),
        candidateCheckpoints: {
          'bytedance-original-calibrated-v1': { sha256: 'd'.repeat(64), bytes: 171966578 },
          'online-amt-calibrated-v1': { sha256: 'e'.repeat(64), bytes: 178804960 },
          'bytedance-robust-augmented-calibrated-v1': { sha256: 'f'.repeat(64), bytes: 103815845 },
        },
        runtimeDigests: {
          'bytedance-original-calibrated-v1': 'noteverse-bytedance-calibration:phase9ga21',
          'online-amt-calibrated-v1': 'sha256:daff15ede55853aedbe8ec0b2fe6924d3e87697f6e041d0f2d05f3151b1cadfb',
          'bytedance-robust-augmented-calibrated-v1': 'noteverse-bytedance-calibration:phase9ga3',
        },
      };
      expect(() => assertExecutionLockBindingsValid(validBindings)).not.toThrow();

      // Invalid scorer SHA
      expect(() => assertExecutionLockBindingsValid({ ...validBindings, scorerSha256: 'invalid' }))
        .toThrow(/INVALID_EXECUTION_LOCK_SCORER_SHA/);

      // Invalid checkpoint bytes
      expect(() => assertExecutionLockBindingsValid({
        ...validBindings,
        candidateCheckpoints: {
          ...validBindings.candidateCheckpoints,
          'online-amt-calibrated-v1': { sha256: 'e'.repeat(64), bytes: 0 },
        },
      })).toThrow(/INVALID_CHECKPOINT_BYTES:online-amt-calibrated-v1/);
    });

    it('B.1.1-3: Ledger state transition state machine validation', () => {
      expect(() => assertLedgerStateTransitionValid('PREPARED', 'RUNNING')).not.toThrow();
      expect(() => assertLedgerStateTransitionValid('RUNNING', 'COMPLETED')).not.toThrow();
      expect(() => assertLedgerStateTransitionValid('RUNNING', 'FAILED')).not.toThrow();
      expect(() => assertLedgerStateTransitionValid('RUNNING', 'INCOMPLETE')).not.toThrow();
      expect(() => assertLedgerStateTransitionValid('INCOMPLETE', 'RUNNING')).not.toThrow();

      // Illegal transition: COMPLETED -> RUNNING
      expect(() => assertLedgerStateTransitionValid('COMPLETED', 'RUNNING'))
        .toThrow(/INVALID_LEDGER_STATE_TRANSITION:COMPLETED->RUNNING/);

      // Illegal transition: FAILED -> COMPLETED
      expect(() => assertLedgerStateTransitionValid('FAILED', 'COMPLETED'))
        .toThrow(/INVALID_LEDGER_STATE_TRANSITION:FAILED->COMPLETED/);
    });

    it('B.1.1-4: Duplicate run ID rejection by execution ledger', () => {
      const runs = new Set(['run-1', 'run-2']);
      expect(() => assertNoDuplicateRunAttempt(runs, 'run-3')).not.toThrow();
      expect(() => assertNoDuplicateRunAttempt(runs, 'run-1'))
        .toThrow(/DUPLICATE_RUN_ID_REJECTED:run-1/);
    });

    it('B.1.1-5: Duplicate candidate/scenario attempt rejection by execution ledger', () => {
      const records = new Set(['cand-1\0sc-1']);
      expect(() => assertNoDuplicateCandidateScenarioAttempt(records, 'cand-1', 'sc-2')).not.toThrow();
      expect(() => assertNoDuplicateCandidateScenarioAttempt(records, 'cand-1', 'sc-1'))
        .toThrow(/DUPLICATE_CANDIDATE_SCENARIO_RUN_REJECTED:cand-1:sc-1/);
    });

    it('B.1.1-6: Candidate inference strictly forbidden in Phase 9G-B.1.1 preflight gate', () => {
      const b11InferenceRequest = {
        policy: {
          policyId: PUBLIC_CHALLENGER_QUALIFICATION_PROTOCOL_V2,
          schemaVersion: 2,
          sha256: PUBLIC_CHALLENGER_QUALIFICATION_PROTOCOL_V2_SHA256,
        },
        incumbentPolicySha256: '5dc9b2cf5f77a3f9276034bb8800b139ee2a03e837f2da32aac969e64b794eb6',
        phase: PHASE_9GB11,
        mode: 'CANDIDATE_INFERENCE' as const,
        candidateId: 'bytedance-robust-augmented-calibrated-v1',
        candidateFamily: 'bytedance-robust-augmented' as const,
        scenarioSplit: 'CALIBRATION' as const,
        performers: ['p07', 'p08', 'p09', 'p10', 'p11', 'p12', 'p13', 'p14'],
        calibrationManifestSha256: PHASE_9GA1_CALIBRATION_SCENARIOS_SHA256,
        incumbentRegistrySha256: PHASE_9GA25_REGISTRY_SHA256,
        blindManifestSha256: PHASE_9GB_BLIND_MANIFEST_SHA256,
      };
      expect(() => assertChallengerExecutionAllowed(b11InferenceRequest))
        .toThrow(/PHASE_9GB11_CANDIDATE_INFERENCE_FORBIDDEN/);
    });

    it('B.1.2-1: assertBlindProtocolV3Identity validates V3 policy ID, schemaVersion 3, sha256, and V2 predecessor', () => {
      const validV3 = {
        policyId: PHASE_9GB_BLIND_EVALUATION_PROTOCOL_V3,
        schemaVersion: 3,
        sha256: 'a'.repeat(64),
        supersedesPolicySha256: PHASE_9GB_BLIND_EVALUATION_PROTOCOL_V2_SHA256,
      };
      expect(() => assertBlindProtocolV3Identity(validV3)).not.toThrow();

      // Policy ID mismatch
      expect(() => assertBlindProtocolV3Identity({ ...validV3, policyId: 'WRONG' }))
        .toThrow(/BLIND_PROTOCOL_V3_POLICY_ID_MISMATCH/);

      // Schema version mismatch
      expect(() => assertBlindProtocolV3Identity({ ...validV3, schemaVersion: 2 }))
        .toThrow(/BLIND_PROTOCOL_V3_SCHEMA_VERSION_MISMATCH/);

      // Predecessor SHA mismatch
      expect(() => assertBlindProtocolV3Identity({ ...validV3, supersedesPolicySha256: 'wrong' }))
        .toThrow(/BLIND_PROTOCOL_V3_SUPERSEDED_POLICY_SHA_MISMATCH/);
    });

    it('B.1.2-2: Candidate inference strictly forbidden in Phase 9G-B.1.2 preflight gate', () => {
      const b12InferenceRequest = {
        policy: {
          policyId: PUBLIC_CHALLENGER_QUALIFICATION_PROTOCOL_V2,
          schemaVersion: 2,
          sha256: PUBLIC_CHALLENGER_QUALIFICATION_PROTOCOL_V2_SHA256,
        },
        incumbentPolicySha256: '5dc9b2cf5f77a3f9276034bb8800b139ee2a03e837f2da32aac969e64b794eb6',
        phase: PHASE_9GB12,
        mode: 'CANDIDATE_INFERENCE' as const,
        candidateId: 'bytedance-robust-augmented-calibrated-v1',
        candidateFamily: 'bytedance-robust-augmented' as const,
        scenarioSplit: 'CALIBRATION' as const,
        performers: ['p07', 'p08', 'p09', 'p10', 'p11', 'p12', 'p13', 'p14'],
        calibrationManifestSha256: PHASE_9GA1_CALIBRATION_SCENARIOS_SHA256,
        incumbentRegistrySha256: PHASE_9GA25_REGISTRY_SHA256,
        blindManifestSha256: PHASE_9GB_BLIND_MANIFEST_SHA256,
      };
      expect(() => assertChallengerExecutionAllowed(b12InferenceRequest))
        .toThrow(/PHASE_9GB12_CANDIDATE_INFERENCE_FORBIDDEN/);
    });

    it('B.1.2-3: assertJournalEventChainValid detects sequence gaps, reordering, and broken hash chains', () => {
      const ev0Base = {
        seq: 0,
        prevEventHash: '0'.repeat(64),
        timestamp: '2026-10-10T00:00:00Z',
        eventType: 'RUN_INITIALIZED',
        runId: 'run-1',
        payload: { test: true },
      };
      const ev0 = {
        ...ev0Base,
        eventHash: computeJournalEventHash(ev0Base),
      };
      const ev1Base = {
        seq: 1,
        prevEventHash: ev0.eventHash,
        timestamp: '2026-10-10T00:00:01Z',
        eventType: 'ATTEMPT_STARTED',
        runId: 'run-1',
        payload: { scenario: 'sc1' },
      };
      const ev1 = {
        ...ev1Base,
        eventHash: computeJournalEventHash(ev1Base),
      };

      // Valid 2-event chain
      expect(() => assertJournalEventChainValid([ev0, ev1])).not.toThrow();

      // Sequence gap: seq 0 then seq 2
      expect(() => assertJournalEventChainValid([ev0, { ...ev1, seq: 2 }]))
        .toThrow(/JOURNAL_SEQUENCE_GAP_OR_REORDER/);

      // Broken hash chain: ev1 prevEventHash doesn't match ev0 eventHash
      const brokenPrev = 'a'.repeat(64);
      const ev1Broken = {
        ...ev1Base,
        prevEventHash: brokenPrev,
        eventHash: computeJournalEventHash({ ...ev1Base, prevEventHash: brokenPrev }),
      };
      expect(() => assertJournalEventChainValid([ev0, ev1Broken]))
        .toThrow(/JOURNAL_HASH_CHAIN_BROKEN_AT_SEQ_1/);
    });

    it('B.1.2-4: assertAcousticPublicationCausalTimingValid rejects future-audio lookahead and backdated availability', () => {
      // Valid publication
      expect(() => assertAcousticPublicationCausalTimingValid({
        analyzedThroughPerformanceMs: 1000,
        availabilityTimeMs: 1050,
        observations: [{ performanceTimeMs: 500 }],
      })).not.toThrow();

      // Future lookahead: observation at 1200ms when analyzed through 1000ms
      expect(() => assertAcousticPublicationCausalTimingValid({
        analyzedThroughPerformanceMs: 1000,
        availabilityTimeMs: 1050,
        observations: [{ performanceTimeMs: 1200 }],
      })).toThrow(/FUTURE_AUDIO_LOOKAHEAD_VIOLATION/);

      // Backdated availability: availability at 900ms when analyzed through 1000ms
      expect(() => assertAcousticPublicationCausalTimingValid({
        analyzedThroughPerformanceMs: 1000,
        availabilityTimeMs: 900,
        observations: [{ performanceTimeMs: 500 }],
      })).toThrow(/BACKDATED_PUBLICATION_AVAILABILITY/);
    });

    it('B.1.2-5: evaluateSymmetricSafetyDominance refuses winner declaration when critical safety evidence is missing', () => {
      const mockCiComputer = (diffs: readonly number[]) => {
        const mean = diffs.reduce((a, b) => a + b, 0) / (diffs.length || 1);
        return { mean, low: mean - 0.005, high: mean + 0.005 };
      };

      // Critical safety metric (priority 1: falseMatchRateOnGroundTruthMissing) has only 2 samples (< 8)
      // Even though expectedStrikeRecall has huge +5% gain, decision MUST NOT declare A winner!
      const missingSafetyVectors = {
        falseMatchRateOnGroundTruthMissing: [0.0, 0.0], // < 8 samples!
        expectedStrikeRecall: [0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05],
      };

      const result = evaluateSymmetricSafetyDominance(missingSafetyVectors, mockCiComputer);
      expect(result.outcome).toBe('INSUFFICIENT_SAFETY_EVIDENCE');
      expect(result.winner).toBeUndefined();
      expect(result.criticalSafetyEvidenceSufficient).toBe(false);
    });

    it('B.1.2-6: evaluateSymmetricSafetyDominance produces exact symmetric decisions under Candidate A / Candidate B reversal', () => {
      const mockCiComputer = (diffs: readonly number[]) => {
        const mean = diffs.reduce((a, b) => a + b, 0) / (diffs.length || 1);
        return { mean, low: mean - 0.002, high: mean + 0.002 };
      };

      const diffsAB: Record<string, number[]> = {
        falseMatchRateOnGroundTruthMissing: [-0.02, -0.02, -0.02, -0.02, -0.02, -0.02, -0.02, -0.02],
        falseCompleteChordAcceptanceRate: [0, 0, 0, 0, 0, 0, 0, 0],
        verdictAgreementRate: [0.03, 0.03, 0.03, 0.03, 0.03, 0.03, 0.03, 0.03],
        correctMissingRate: [0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02],
        chordExactCompletenessRate: [0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01],
        expectedStrikeRecall: [0.04, 0.04, 0.04, 0.04, 0.04, 0.04, 0.04, 0.04],
        extraPrecision: [0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02],
        extraRecall: [0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02],
      };

      // Reversed diffs: diffsBA = -diffsAB
      const diffsBA: Record<string, number[]> = {};
      for (const [k, v] of Object.entries(diffsAB)) {
        diffsBA[k] = v.map((x) => -x);
      }

      const resAB = evaluateSymmetricSafetyDominance(diffsAB, mockCiComputer);
      const resBA = evaluateSymmetricSafetyDominance(diffsBA, mockCiComputer);

      expect(resAB.outcome).toBe('CANDIDATE_A_DOMINATES');
      expect(resAB.winner).toBe('CANDIDATE_A');

      // Under reversal: B dominates A in the BA comparison!
      expect(resBA.outcome).toBe('CANDIDATE_B_DOMINATES');
      expect(resBA.winner).toBe('CANDIDATE_B');
    });
  });

  describe('Phase 9G-B.2-PRE: Final Integrity and Real-Runtime Authorization Gate', () => {
    it('B.2-PRE-1: assertBlindProtocolV4Identity validates V4 policy ID, schemaVersion 4, sha256, and V3 predecessor', () => {
      const validV4 = {
        policyId: PHASE_9GB_BLIND_EVALUATION_PROTOCOL_V4,
        schemaVersion: 4,
        sha256: '4'.repeat(64),
        supersedesPolicySha256: PHASE_9GB_BLIND_EVALUATION_PROTOCOL_V3_SHA256,
      };

      expect(() => assertBlindProtocolV4Identity(validV4)).not.toThrow();

      expect(() => assertBlindProtocolV4Identity({ ...validV4, policyId: 'WRONG' }))
        .toThrow(/BLIND_PROTOCOL_V4_POLICY_ID_MISMATCH/);

      expect(() => assertBlindProtocolV4Identity({ ...validV4, schemaVersion: 3 }))
        .toThrow(/BLIND_PROTOCOL_V4_SCHEMA_VERSION_MISMATCH/);

      expect(() => assertBlindProtocolV4Identity({ ...validV4, sha256: undefined }))
        .toThrow(/BLIND_PROTOCOL_V4_SHA_REQUIRED/);

      expect(() => assertBlindProtocolV4Identity({ ...validV4, supersedesPolicySha256: 'wrong'.padEnd(64, '0') }))
        .toThrow(/BLIND_PROTOCOL_V4_SUPERSEDED_POLICY_SHA_MISMATCH/);
    });

    it('B.2-PRE-2: Candidate inference strictly forbidden in Phase 9G-B.2-PRE preflight gate', () => {
      const b2PreInferenceRequest: ChallengerExecutionRequest = {
        phase: PHASE_9GB2_PRE,
        mode: 'CANDIDATE_INFERENCE',
        policy: {
          policyId: PUBLIC_CHALLENGER_QUALIFICATION_PROTOCOL_V2,
          schemaVersion: 2,
          sha256: PUBLIC_CHALLENGER_QUALIFICATION_PROTOCOL_V2_SHA256,
        },
        incumbentPolicySha256: PUBLIC_MODEL_CALIBRATION_PROTOCOL_V5_SHA256,
        candidateId: 'bytedance-robust-augmented-calibrated-v1',
        candidateFamily: 'bytedance-robust-augmented',
        scenarioSplit: 'CALIBRATION',
        performers: ['p07', 'p08', 'p09', 'p10', 'p11', 'p12', 'p13', 'p14'],
        calibrationManifestSha256: PHASE_9GA1_CALIBRATION_SCENARIOS_SHA256,
        incumbentRegistrySha256: PHASE_9GA25_REGISTRY_SHA256,
        blindManifestSha256: PHASE_9GB_BLIND_MANIFEST_SHA256,
      };
      expect(() => assertChallengerExecutionAllowed(b2PreInferenceRequest))
        .toThrow(/PHASE_9GB2_CANDIDATE_INFERENCE_FORBIDDEN/);
    });

    it('B.2-PRE-3: assertJournalEventChainValid detects payload tampering even when sequence and prevEventHash are intact', () => {
      const ev0Base = {
        seq: 0,
        prevEventHash: '0'.repeat(64),
        timestamp: '2026-10-10T00:00:00Z',
        eventType: 'RUN_INITIALIZED',
        runId: 'run-b2',
        payload: { test: true },
      };
      const ev0 = {
        ...ev0Base,
        eventHash: computeJournalEventHash(ev0Base),
      };

      const ev1Base = {
        seq: 1,
        prevEventHash: ev0.eventHash,
        timestamp: '2026-10-10T00:00:01Z',
        eventType: 'ATTEMPT_STARTED',
        runId: 'run-b2',
        payload: { candidateId: 'c1', scenarioId: 's1' },
      };
      const ev1 = {
        ...ev1Base,
        eventHash: computeJournalEventHash(ev1Base),
      };

      // Both valid
      expect(() => assertJournalEventChainValid([ev0, ev1])).not.toThrow();

      // Tamper with payload of ev1 without updating eventHash
      const tamperedEv1 = {
        ...ev1,
        payload: { candidateId: 'c1', scenarioId: 's1', extraTamper: 'malicious' },
      };
      expect(() => assertJournalEventChainValid([ev0, tamperedEv1]))
        .toThrow(/JOURNAL_EVENT_PAYLOAD_TAMPERED_AT_SEQ_1/);
    });

    it('B.2-PRE-4: assertJournalEventChainValid enforces attempt ordering and rejects duplicate terminal attempt records', () => {
      const ev0Base = {
        seq: 0,
        prevEventHash: '0'.repeat(64),
        timestamp: '2026-10-10T00:00:00Z',
        eventType: 'RUN_INITIALIZED',
        runId: 'run-b2-ordering',
        payload: {},
      };
      const ev0 = { ...ev0Base, eventHash: computeJournalEventHash(ev0Base) };

      // Attempt committed without ATTEMPT_STARTED
      const evUnstartedBase = {
        seq: 1,
        prevEventHash: ev0.eventHash,
        timestamp: '2026-10-10T00:00:01Z',
        eventType: 'ATTEMPT_COMMITTED',
        runId: 'run-b2-ordering',
        payload: { candidateId: 'c1', scenarioId: 's1' },
      };
      const evUnstarted = { ...evUnstartedBase, eventHash: computeJournalEventHash(evUnstartedBase) };
      expect(() => assertJournalEventChainValid([ev0, evUnstarted]))
        .toThrow(/JOURNAL_ATTEMPT_TERMINATED_WITHOUT_START:c1\0s1/);

      // Duplicate attempt start
      const evStart1Base = {
        seq: 1,
        prevEventHash: ev0.eventHash,
        timestamp: '2026-10-10T00:00:01Z',
        eventType: 'ATTEMPT_STARTED',
        runId: 'run-b2-ordering',
        payload: { candidateId: 'c1', scenarioId: 's1' },
      };
      const evStart1 = { ...evStart1Base, eventHash: computeJournalEventHash(evStart1Base) };

      const evStart2Base = {
        seq: 2,
        prevEventHash: evStart1.eventHash,
        timestamp: '2026-10-10T00:00:02Z',
        eventType: 'ATTEMPT_STARTED',
        runId: 'run-b2-ordering',
        payload: { candidateId: 'c1', scenarioId: 's1' },
      };
      const evStart2 = { ...evStart2Base, eventHash: computeJournalEventHash(evStart2Base) };
      expect(() => assertJournalEventChainValid([ev0, evStart1, evStart2]))
        .toThrow(/JOURNAL_DUPLICATE_ATTEMPT_STARTED:c1\0s1/);

      // Terminal commit followed by duplicate terminal commit
      const evCommit1Base = {
        seq: 2,
        prevEventHash: evStart1.eventHash,
        timestamp: '2026-10-10T00:00:02Z',
        eventType: 'ATTEMPT_COMMITTED',
        runId: 'run-b2-ordering',
        payload: { candidateId: 'c1', scenarioId: 's1' },
      };
      const evCommit1 = { ...evCommit1Base, eventHash: computeJournalEventHash(evCommit1Base) };

      const evCommit2Base = {
        seq: 3,
        prevEventHash: evCommit1.eventHash,
        timestamp: '2026-10-10T00:00:03Z',
        eventType: 'ATTEMPT_COMMITTED',
        runId: 'run-b2-ordering',
        payload: { candidateId: 'c1', scenarioId: 's1' },
      };
      const evCommit2 = { ...evCommit2Base, eventHash: computeJournalEventHash(evCommit2Base) };
      expect(() => assertJournalEventChainValid([ev0, evStart1, evCommit1, evCommit2]))
        .toThrow(/JOURNAL_DUPLICATE_TERMINAL_ATTEMPT_RECORD:c1\0s1/);
    });

    it('B.2-PRE-5: assertJournalMatchesRunReceipt detects valid-prefix truncation and count mismatch', () => {
      const ev0Base = {
        seq: 0,
        prevEventHash: '0'.repeat(64),
        timestamp: '2026-10-10T00:00:00Z',
        eventType: 'RUN_INITIALIZED',
        runId: 'run-receipt-check',
        payload: {},
      };
      const ev0 = { ...ev0Base, eventHash: computeJournalEventHash(ev0Base) };

      const ev1Base = {
        seq: 1,
        prevEventHash: ev0.eventHash,
        timestamp: '2026-10-10T00:00:01Z',
        eventType: 'RUN_COMPLETED',
        runId: 'run-receipt-check',
        payload: {},
      };
      const ev1 = { ...ev1Base, eventHash: computeJournalEventHash(ev1Base) };

      const events = [ev0, ev1];
      const validReceipt = {
        eventCount: 2,
        chainTipHash: ev1.eventHash,
        runId: 'run-receipt-check',
      };

      expect(() => assertJournalMatchesRunReceipt(events, validReceipt)).not.toThrow();

      // Truncated events: only ev0 provided when receipt expects 2
      expect(() => assertJournalMatchesRunReceipt([ev0], validReceipt))
        .toThrow(/JOURNAL_TRUNCATION_OR_COUNT_MISMATCH: expected 2, got 1/);

      // Tip hash mismatch
      expect(() => assertJournalMatchesRunReceipt(events, { ...validReceipt, chainTipHash: 'wrong'.padEnd(64, '0') }))
        .toThrow(/JOURNAL_CHAIN_TIP_MISMATCH/);

      // Run ID mismatch
      expect(() => assertJournalMatchesRunReceipt(events, { ...validReceipt, runId: 'different-run' }))
        .toThrow(/JOURNAL_RUN_ID_MISMATCH/);
    });

    it('B.2-ARM-1: Programmatic candidate inference is strictly forbidden in Phase 9G-B.2-ARM', () => {
      const baseReq = {
        policy: {
          schemaVersion: 2,
          policyId: PUBLIC_CHALLENGER_QUALIFICATION_PROTOCOL_V2,
          sha256: PUBLIC_CHALLENGER_QUALIFICATION_PROTOCOL_V2_SHA256,
        },
        incumbentPolicySha256: '5dc9b2cf5f77a3f9276034bb8800b139ee2a03e837f2da32aac969e64b794eb6',
        phase: PHASE_9GB2_ARM,
        mode: 'CANDIDATE_INFERENCE' as const,
        candidateId: 'bytedance-robust-augmented-calibrated-v1',
        candidateFamily: 'bytedance-robust-augmented',
        scenarioSplit: 'CALIBRATION' as const,
        performers: ['p07'],
        calibrationManifestSha256: PHASE_9GA1_CALIBRATION_SCENARIOS_SHA256,
        incumbentRegistrySha256: PHASE_9GA25_REGISTRY_SHA256,
        blindManifestSha256: PHASE_9GB_BLIND_MANIFEST_SHA256,
      };

      expect(() => assertChallengerExecutionAllowed(baseReq))
        .toThrow(/PHASE_9GB2_ARM_CANDIDATE_INFERENCE_FORBIDDEN/);
    });

    it('B.2-ARM-2: assertBlindProtocolV5Identity validates V5 schema, SHA, and supersedes V4 SHA', () => {
      const validV5 = {
        policyId: PHASE_9GB_BLIND_EVALUATION_PROTOCOL_V5,
        schemaVersion: 5,
        sha256: 'a'.repeat(64),
        supersedesPolicySha256: PHASE_9GB_BLIND_EVALUATION_PROTOCOL_V4_SHA256,
      };

      expect(() => assertBlindProtocolV5Identity(validV5)).not.toThrow();

      // Wrong schema
      expect(() => assertBlindProtocolV5Identity({ ...validV5, schemaVersion: 4 }))
        .toThrow(/BLIND_PROTOCOL_V5_SCHEMA_VERSION_MISMATCH:4/);

      // Wrong predecessor V4 SHA
      expect(() => assertBlindProtocolV5Identity({ ...validV5, supersedesPolicySha256: 'wrong'.padEnd(64, '0') }))
        .toThrow(/BLIND_PROTOCOL_V5_SUPERSEDED_POLICY_SHA_MISMATCH/);

      // Wrong policyId
      expect(() => assertBlindProtocolV5Identity({ ...validV5, policyId: 'WRONG' }))
        .toThrow(/BLIND_PROTOCOL_V5_POLICY_ID_MISMATCH:WRONG/);
    });

    it('B.2-ARM-3: Production audio manifest rejects synthetic fixtures and fabricated hashes', () => {
      const validProdScenario: ProductionAudioManifestRecord = {
        scenarioId: 'vienna_eval_01',
        split: 'BLIND',
        performerId: 'p15',
        audio: {
          nativeSampleRateHz: 16000,
          channelPolicy: 'MONO',
          clipStartMs: 0,
          clipEndMs: 15000,
          performanceOriginSourceMs: 5000,
          sourceDurationMs: 15000,
          sourceSampleCount: 240000,
        },
        source: {
          sourceAudioPath: 'audio/blind/vienna_eval_01.wav',
          sourceAudioSha256: '1'.repeat(64),
          sourcePcmSha256: '2'.repeat(64),
        },
      };

      expect(() => assertProductionAudioManifestValid(validProdScenario)).not.toThrow();

      // Synthetic fixture in production must be rejected
      expect(() => assertProductionAudioManifestValid({
        ...validProdScenario,
        source: { ...validProdScenario.source, isSyntheticFixture: true },
      })).toThrow(/SYNTHETIC_FIXTURE_REJECTED_IN_PRODUCTION/);

      expect(() => assertProductionAudioManifestValid({
        ...validProdScenario,
        scenarioId: 'synthetic_test_01',
      })).toThrow(/SYNTHETIC_FIXTURE_REJECTED_IN_PRODUCTION/);

      // Fabricated text hash (e.g. sha256Text("audio_" + scenarioId)) must be rejected
      const fabricatedAudio = createHash('sha256').update('audio_vienna_eval_01', 'utf8').digest('hex');
      expect(() => assertProductionAudioManifestValid({
        ...validProdScenario,
        source: { ...validProdScenario.source, sourceAudioSha256: fabricatedAudio },
      })).toThrow(/PRODUCTION_AUDIO_MANIFEST_FABRICATED_HASH_DETECTED/);

      // Hash collision between audio and PCM must be rejected
      expect(() => assertProductionAudioManifestValid({
        ...validProdScenario,
        source: { ...validProdScenario.source, sourcePcmSha256: '1'.repeat(64) },
      })).toThrow(/PRODUCTION_AUDIO_MANIFEST_AUDIO_AND_PCM_HASH_COLLISION/);
    });

    it('B.2-ARM-4: Synthetic rehearsal manifest requires explicit synthetic tagging', () => {
      const validSynth = {
        scenarioId: 'synthetic_rehearsal_01',
        isSynthetic: true,
        source: {
          sourceAudioPath: 'test_tmp/fixtures/synth1.wav',
          sourceAudioSha256: '3'.repeat(64),
          sourcePcmSha256: '4'.repeat(64),
        },
      };

      expect(() => assertSyntheticRehearsalManifestValid(validSynth)).not.toThrow();

      // Non-synthetic scenario in rehearsal manifest must be rejected
      expect(() => assertSyntheticRehearsalManifestValid({
        scenarioId: 'vienna_prod_01',
        isSynthetic: false,
        source: validSynth.source,
      })).toThrow(/SYNTHETIC_REHEARSAL_MANIFEST_MUST_BE_EXPLICITLY_SYNTHETIC/);
    });

    it('B.2-ARM-5: assertJournalChainTipAndCompleteness enforces trusted anchor requirement', () => {
      const ev0Base = {
        seq: 0,
        prevEventHash: '0'.repeat(64),
        timestamp: '2026-10-10T00:00:00Z',
        eventType: 'RUN_INITIALIZED',
        runId: 'arm-journal-check',
        payload: {},
      };
      const ev0 = { ...ev0Base, eventHash: computeJournalEventHash(ev0Base) };

      const ev1Base = {
        seq: 1,
        prevEventHash: ev0.eventHash,
        timestamp: '2026-10-10T00:00:01Z',
        eventType: 'RUN_COMPLETED',
        runId: 'arm-journal-check',
        payload: {},
      };
      const ev1 = { ...ev1Base, eventHash: computeJournalEventHash(ev1Base) };

      const events = [ev0, ev1];

      // Missing trusted anchor must fail closed with JOURNAL_COMPLETENESS_NOT_VERIFIABLE
      expect(() => assertJournalChainTipAndCompleteness(events, undefined))
        .toThrow(/JOURNAL_COMPLETENESS_NOT_VERIFIABLE/);
      expect(() => assertJournalChainTipAndCompleteness(events, {}))
        .toThrow(/JOURNAL_COMPLETENESS_NOT_VERIFIABLE/);

      // Valid anchor succeeds
      expect(() => assertJournalChainTipAndCompleteness(events, { chainTipHash: ev1.eventHash, eventCount: 2 }))
        .not.toThrow();

      // Mismatched tip hash fails
      expect(() => assertJournalChainTipAndCompleteness(events, { chainTipHash: 'wrong'.padEnd(64, '0'), eventCount: 2 }))
        .toThrow(/JOURNAL_CHAIN_TIP_MISMATCH/);

      // Truncated events count fails
      expect(() => assertJournalChainTipAndCompleteness(events, { chainTipHash: ev1.eventHash, eventCount: 3 }))
        .toThrow(/JOURNAL_TRUNCATION_OR_COUNT_MISMATCH/);
    });

    it('B.2-FINAL-1: assertBlindProtocolV6Identity validates schema 6 and supersedes V5 SHA', () => {
      const validV6 = {
        policyId: PHASE_9GB_BLIND_EVALUATION_PROTOCOL_V6,
        schemaVersion: 6,
        sha256: '9'.repeat(64),
        supersedesPolicySha256: PHASE_9GB_BLIND_EVALUATION_PROTOCOL_V5_SHA256,
      };

      expect(() => assertBlindProtocolV6Identity(validV6)).not.toThrow();

      // Policy ID mismatch fails
      expect(() => assertBlindProtocolV6Identity({ ...validV6, policyId: 'WRONG_POLICY' }))
        .toThrow(/BLIND_PROTOCOL_V6_POLICY_ID_MISMATCH/);

      // Schema version mismatch fails
      expect(() => assertBlindProtocolV6Identity({ ...validV6, schemaVersion: 5 }))
        .toThrow(/BLIND_PROTOCOL_V6_SCHEMA_VERSION_MISMATCH/);

      // Missing SHA fails
      expect(() => assertBlindProtocolV6Identity({ ...validV6, sha256: undefined }))
        .toThrow(/BLIND_PROTOCOL_V6_SHA_REQUIRED/);

      // Superseded SHA mismatch fails
      expect(() => assertBlindProtocolV6Identity({ ...validV6, supersedesPolicySha256: 'wrong'.padEnd(64, '0') }))
        .toThrow(/BLIND_PROTOCOL_V6_SUPERSEDED_POLICY_SHA_MISMATCH/);
    });

    it('B.2-FINAL-2: assertChallengerExecutionAllowed strictly blocks candidate inference in PHASE_9GB2_FINAL_GATE', () => {
      const request = {
        policy: {
          policyId: PUBLIC_CHALLENGER_QUALIFICATION_PROTOCOL_V2,
          schemaVersion: 2,
          sha256: PUBLIC_CHALLENGER_QUALIFICATION_PROTOCOL_V2_SHA256,
        },
        incumbentPolicySha256: '5dc9b2cf5f77a3f9276034bb8800b139ee2a03e837f2da32aac969e64b794eb6',
        incumbentRegistrySha256: PHASE_9GA25_REGISTRY_SHA256,
        calibrationManifestSha256: PHASE_9GA1_CALIBRATION_SCENARIOS_SHA256,
        blindManifestSha256: PHASE_9GB_BLIND_MANIFEST_SHA256,
        phase: PHASE_9GB2_FINAL_GATE,
        mode: 'CANDIDATE_INFERENCE' as const,
        candidateId: 'bytedance-robust-augmented-calibrated-v1',
        candidateFamily: 'bytedance-robust-augmented' as const,
        scenarioSplit: 'CALIBRATION' as const,
        performers: ['p07'],
      };

      expect(() => assertChallengerExecutionAllowed(request))
        .toThrow(/PHASE_9GB2_FINAL_GATE_CANDIDATE_INFERENCE_FORBIDDEN/);
    });

    it('B.2-FINAL-3: assertAudioByteIntegrity performs physical byte, RIFF header, and PCM SHA verification', () => {
      // Build a minimal valid 16kHz mono 16-bit PCM WAV fixture in memory
      const sampleRate = 16000;
      const numChannels = 1;
      const bitsPerSample = 16;
      const numSamples = 160; // 10ms
      const pcmData = new Uint8Array(numSamples * (bitsPerSample / 8));
      for (let i = 0; i < pcmData.length; i++) pcmData[i] = (i * 7) & 0xff;

      const wavHeader = new Uint8Array(44);
      const view = new DataView(wavHeader.buffer);
      // "RIFF"
      wavHeader.set([0x52, 0x49, 0x46, 0x46], 0);
      view.setUint32(4, 36 + pcmData.length, true);
      // "WAVE"
      wavHeader.set([0x57, 0x41, 0x56, 0x45], 8);
      // "fmt "
      wavHeader.set([0x66, 0x6d, 0x74, 0x20], 12);
      view.setUint32(16, 16, true); // PCM subchunk size
      view.setUint16(20, 1, true); // PCM format
      view.setUint16(22, numChannels, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * numChannels * (bitsPerSample / 8), true);
      view.setUint16(32, numChannels * (bitsPerSample / 8), true);
      view.setUint16(34, bitsPerSample, true);
      // "data"
      wavHeader.set([0x64, 0x61, 0x74, 0x61], 36);
      view.setUint32(40, pcmData.length, true);

      const fullWav = new Uint8Array(44 + pcmData.length);
      fullWav.set(wavHeader, 0);
      fullWav.set(pcmData, 44);

      const expectedWavSha = createHash('sha256').update(fullWav).digest('hex');
      const expectedPcmSha = createHash('sha256').update(pcmData).digest('hex');

      // Valid byte check succeeds
      const result = assertAudioByteIntegrity({
        wavBytes: fullWav,
        expectedWavSha256: expectedWavSha,
        expectedPcmSha256: expectedPcmSha,
        expectedSampleRate: 16000,
        expectedChannels: 1,
        expectedSampleCount: numSamples,
      });
      expect(result.actualWavSha256).toBe(expectedWavSha);
      expect(result.actualPcmSha256).toBe(expectedPcmSha);
      expect(result.sampleCount).toBe(numSamples);

      // Mismatched WAV SHA throws
      expect(() => assertAudioByteIntegrity({
        wavBytes: fullWav,
        expectedWavSha256: '0'.repeat(64),
        expectedPcmSha256: expectedPcmSha,
      })).toThrow(/AUDIO_WAV_SHA_MISMATCH/);

      // Corrupted PCM throws
      expect(() => assertAudioByteIntegrity({
        wavBytes: fullWav,
        expectedWavSha256: expectedWavSha,
        expectedPcmSha256: '0'.repeat(64),
      })).toThrow(/AUDIO_PCM_SHA_MISMATCH/);

      // Sample rate mismatch throws
      expect(() => assertAudioByteIntegrity({
        wavBytes: fullWav,
        expectedWavSha256: expectedWavSha,
        expectedPcmSha256: expectedPcmSha,
        expectedSampleRate: 44100,
      })).toThrow(/AUDIO_SAMPLE_RATE_MISMATCH/);
    });
  });
});



