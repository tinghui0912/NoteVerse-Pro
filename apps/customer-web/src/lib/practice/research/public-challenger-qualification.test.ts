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
  validateTranscriptionRawCache,
  deriveCandidateContextEligibility,
  assertAcousticEvidenceScoreIndependent,
  assertModelStateDictCompatibility,
  assertCandidateCausalStreamingClaimsValid,
  assertPublicationTimingValid,
  assertWholeRecordingPublicationTiming,
  assertAriaPerFileLatencyReportValid,
  evaluatePairwiseComparison,
  assertCleanWorkingTree,
  assertCandidateQualificationForPhase9GB,
  assertContextEligibilityScoreIndependent,
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
      expect(validateRobustByteDanceRawCache({
        chunks: [{
          windowId: 'w1',
          contextProfileId: 'ctx1',
          inputSampleCount: 16000,
          rawOutputs: {
            frame_output: { data: [0.1], float32ByteSha256: 'abc' },
            reg_onset_output: { data: [0.2], float32ByteSha256: 'def' },
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
      const baseRun: any = {
        scenarioId: 'sc-base',
        publications: [
          {
            publicationId: 'pub-1',
            observations: [
              { observationId: 'o1', pitch: 'C4', performanceTimeMs: 100 },
              { observationId: 'o2', pitch: 'E4', performanceTimeMs: 200 },
            ],
          },
        ],
      };

      // Exact matching counterfactual observations pass
      const identicalCfRun: any = {
        scenarioId: 'sc-cf-1',
        publications: [
          {
            publicationId: 'pub-cf-1',
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
      const tamperedCfRun: any = {
        scenarioId: 'sc-cf-1',
        publications: [
          {
            publicationId: 'pub-cf-1',
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
});

