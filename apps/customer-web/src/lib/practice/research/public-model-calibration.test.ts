import { describe, expect, it } from 'vitest';

import {
  BYTEDANCE_PHASE_9GA_CONTEXT_GEOMETRIES,
  ONLINE_AMT_TIMING_CALIBRATION_V1,
  PUBLIC_MODEL_CALIBRATION_PROTOCOL_V2_SHA256,
  PUBLIC_MODEL_CALIBRATION_PROTOCOL_V4_SHA256,
  PUBLIC_MODEL_CALIBRATION_PROTOCOL_V5_SHA256,
  assertCandidateExecutorReachableForPhase9G,
  assertPhase9GExecutionAllowed,
  assertPublicModelCalibrationPolicyIdentity,
  assertViennaPublicProxyExecutionAllowed,
  decideCandidateSpecificAcousticEvidenceReuse,
  onlineAmtTimingCorrectionForInScopePhysicalTruthForTest,
  planByteDanceV4ContextWindowsForTest,
  resolveCalibrationGate2ExactProfile,
  runGuardedViennaCandidateExecutorsForTest,
  selectCalibrationProfile,
  type CalibrationProfileScenarioScore,
} from './public-model-calibration';

const policy = {
  path: 'backend/research/policies/public_model_calibration_protocol_v5_2026-10-09.json',
  sha256: PUBLIC_MODEL_CALIBRATION_PROTOCOL_V5_SHA256,
  policyId: 'PUBLIC_MODEL_CALIBRATION_PROTOCOL_V5',
  schemaVersion: 5,
};

function request(overrides = {}) {
  return {
    phase: '9G-A',
    mode: 'CANDIDATE_INFERENCE' as const,
    scenarioSplit: 'CALIBRATION',
    performers: ['p07', 'p08', 'p09', 'p10', 'p11', 'p12', 'p13', 'p14'],
    policy,
    ...overrides,
  };
}

function score(
  profileId: string,
  scenarioId: string,
  family: CalibrationProfileScenarioScore['family'],
  value: number,
  metric: keyof CalibrationProfileScenarioScore['metrics'] = 'falseMatchRateOnGroundTruthMissing',
  denominator = 1,
): CalibrationProfileScenarioScore {
  return {
    profileId,
    scenarioId,
    family,
    metrics: {
      [metric]: { value, numerator: value * denominator, denominator },
    },
  };
}

function profileScores(profileId: string, values: readonly number[], family: CalibrationProfileScenarioScore['family'] = 'COUNTERFACTUAL_MISSING_NOTE') {
  return values.map((value, index) => score(profileId, `s${index}`, family, value));
}

function allMetricScores(profileId: string, values: readonly number[], family: CalibrationProfileScenarioScore['family'], metric: Parameters<typeof score>[4]) {
  return values.map((value, index) => score(profileId, `s${index}`, family, value, metric));
}

describe('public model calibration protocol V5', () => {
  it('retains V2/V4 as historical evidence but accepts only the exact V5 policy identity for current execution', () => {
    expect(PUBLIC_MODEL_CALIBRATION_PROTOCOL_V2_SHA256).toMatch(/^[a-f0-9]{64}$/);
    expect(PUBLIC_MODEL_CALIBRATION_PROTOCOL_V4_SHA256).toMatch(/^[a-f0-9]{64}$/);
    expect(PUBLIC_MODEL_CALIBRATION_PROTOCOL_V5_SHA256).toMatch(/^[a-f0-9]{64}$/);
    expect(() => assertPublicModelCalibrationPolicyIdentity(policy)).not.toThrow();
    expect(() => assertPublicModelCalibrationPolicyIdentity({ ...policy, sha256: 'a'.repeat(64) }))
      .toThrow(/POLICY_SHA_MISMATCH/);
    expect(() => assertPublicModelCalibrationPolicyIdentity({ ...policy, policyId: 'PUBLIC_MODEL_CALIBRATION_PROTOCOL_V4' }))
      .toThrow(/POLICY_ID_MISMATCH/);
    expect(() => assertPublicModelCalibrationPolicyIdentity({ ...policy, schemaVersion: 4 }))
      .toThrow(/POLICY_SCHEMA_MISMATCH/);
  });

  it('allows Phase 9G-A candidate inference only for p07-p14 CALIBRATION', () => {
    expect(() => assertCandidateExecutorReachableForPhase9G(request())).not.toThrow();
    expect(() => assertCandidateExecutorReachableForPhase9G(request({ scenarioSplit: 'EVALUATION' })))
      .toThrow(/REQUIRES_CALIBRATION/);
    expect(() => assertCandidateExecutorReachableForPhase9G(request({ performers: ['p99'] })))
      .toThrow(/CALIBRATION_PERFORMER_SET_REQUIRED/);
  });

  it('globally rejects blind candidate inference before executor reachability', () => {
    const blind = request({
      phase: '9F-B3',
      performers: ['p15', 'p16', 'p17', 'p18', 'p19', 'p20', 'p21', 'p22'],
    });
    expect(() => assertViennaPublicProxyExecutionAllowed(blind))
      .toThrow(/PHASE_9GA_BLIND_EVALUATION_INFERENCE_FORBIDDEN/);
    expect(() => assertCandidateExecutorReachableForPhase9G(request({
      performers: ['p07', 'p15'],
    }))).toThrow(/PHASE_9GA_BLIND_EVALUATION_INFERENCE_FORBIDDEN/);
  });

  it('proves executor-call counters stay zero for blind, mixed, and TRUTH_ONLY requests', () => {
    let byteDanceCalls = 0;
    let onlineAmtCalls = 0;
    const executors = {
      byteDance: () => { byteDanceCalls += 1; },
      onlineAmt: () => { onlineAmtCalls += 1; },
    };
    expect(runGuardedViennaCandidateExecutorsForTest(request(), executors)).toEqual({
      byteDanceExecutorCalls: 1,
      onlineAmtExecutorCalls: 1,
    });
    expect(byteDanceCalls).toBe(1);
    expect(onlineAmtCalls).toBe(1);

    for (const invalid of [
      request({ performers: ['p15', 'p16', 'p17', 'p18', 'p19', 'p20', 'p21', 'p22'] }),
      request({ performers: ['p07', 'p15'] }),
    ]) {
      expect(() => runGuardedViennaCandidateExecutorsForTest(invalid, executors))
        .toThrow(/PHASE_9GA_BLIND_EVALUATION_INFERENCE_FORBIDDEN/);
    }
    expect(byteDanceCalls).toBe(1);
    expect(onlineAmtCalls).toBe(1);

    const truthOnly = request({
      mode: 'TRUTH_ONLY',
      scenarioSplit: 'EVALUATION',
      performers: ['p15', 'p16', 'p17', 'p18', 'p19', 'p20', 'p21', 'p22'],
    });
    expect(runGuardedViennaCandidateExecutorsForTest(truthOnly, executors)).toEqual({
      byteDanceExecutorCalls: 0,
      onlineAmtExecutorCalls: 0,
    });
    expect(byteDanceCalls).toBe(1);
    expect(onlineAmtCalls).toBe(1);
  });

  it('allows blind TRUTH_ONLY manifest construction and forbids candidate execution there', () => {
    const truthOnly = request({
      mode: 'TRUTH_ONLY',
      scenarioSplit: 'EVALUATION',
      performers: ['p15', 'p16', 'p17', 'p18', 'p19', 'p20', 'p21', 'p22'],
    });
    expect(() => assertPhase9GExecutionAllowed(truthOnly)).not.toThrow();
    expect(() => assertCandidateExecutorReachableForPhase9G(truthOnly)).toThrow(/CANDIDATE_EXECUTOR_FORBIDDEN/);
  });

  it('freezes ByteDance 3s/5s/10s context geometry exactly', () => {
    expect(BYTEDANCE_PHASE_9GA_CONTEXT_GEOMETRIES.find((item) => item.profileId === 'CALIBRATED_CONTEXT_1820'))
      .toMatchObject({ modelInputMs: 1820, futureContextMs: 220, commitWidthMs: 600 });
    expect(BYTEDANCE_PHASE_9GA_CONTEXT_GEOMETRIES.find((item) => item.profileId === 'CALIBRATED_CONTEXT_3S'))
      .toMatchObject({ modelInputMs: 3000, nominalOwnedRegionMs: 1500, interiorPastContextMs: 750, maximumFutureContextMs: 750, terminalWindowPolicy: 'RIGHT_ANCHORED_TERMINAL_FUTURE_BOUND_V1' });
    expect(BYTEDANCE_PHASE_9GA_CONTEXT_GEOMETRIES.find((item) => item.profileId === 'CALIBRATED_CONTEXT_5S'))
      .toMatchObject({ modelInputMs: 5000, nominalOwnedRegionMs: 2500, interiorPastContextMs: 1250, maximumFutureContextMs: 1250, terminalWindowPolicy: 'RIGHT_ANCHORED_TERMINAL_FUTURE_BOUND_V1' });
    expect(BYTEDANCE_PHASE_9GA_CONTEXT_GEOMETRIES.find((item) => item.profileId === 'CALIBRATED_CONTEXT_10S'))
      .toMatchObject({ modelInputMs: 10000, nominalOwnedRegionMs: 5000, interiorPastContextMs: 2500, maximumFutureContextMs: 2500, terminalWindowPolicy: 'RIGHT_ANCHORED_TERMINAL_FUTURE_BOUND_V1' });
  });

  it('right-anchors terminal partial ByteDance windows while allowing terminal past expansion', () => {
    const context = BYTEDANCE_PHASE_9GA_CONTEXT_GEOMETRIES.find((item) => item.profileId === 'CALIBRATED_CONTEXT_5S')!;
    const plans = planByteDanceV4ContextWindowsForTest(6100, context);
    const terminal = plans.at(-1)!;
    expect(terminal.commitStartPerformanceMs).toBe(5000);
    expect(terminal.commitEndPerformanceMs).toBe(6100);
    expect(terminal.inputEndPerformanceMs - terminal.commitEndPerformanceMs).toBe(1250);
    expect(terminal.inputEndPerformanceMs - terminal.inputStartPerformanceMs).toBe(5000);
    expect(terminal.commitStartPerformanceMs - terminal.inputStartPerformanceMs).toBeGreaterThan(context.interiorPastContextMs!);
  });

  it('keeps interior ByteDance windows at exact past/future geometry', () => {
    const context = BYTEDANCE_PHASE_9GA_CONTEXT_GEOMETRIES.find((item) => item.profileId === 'CALIBRATED_CONTEXT_3S')!;
    const [first] = planByteDanceV4ContextWindowsForTest(3000, context);
    expect(first.commitEndPerformanceMs - first.commitStartPerformanceMs).toBe(1500);
    expect(first.commitStartPerformanceMs - first.inputStartPerformanceMs).toBe(750);
    expect(first.inputEndPerformanceMs - first.commitEndPerformanceMs).toBe(750);
  });

  it('freezes Online-AMT timing calibration as one deterministic algorithm', () => {
    expect(ONLINE_AMT_TIMING_CALIBRATION_V1.algorithmId).toBe('ONLINE_AMT_TIMING_CALIBRATION_V1');
    expect(ONLINE_AMT_TIMING_CALIBRATION_V1.rawTimingCorrectionMs).toBe(0);
    expect(ONLINE_AMT_TIMING_CALIBRATION_V1.matchWindowMs).toBe(250);
    expect(ONLINE_AMT_TIMING_CALIBRATION_V1.forbiddenInputs).toContain('BLIND_EVALUATION data');
  });

  it('excludes post-scope physical attacks from Online-AMT timing correction matching', () => {
    const candidate = [
      { pitch: 'C4', rawDecisionTimeMs: 90 },
      { pitch: 'C4', rawDecisionTimeMs: 180 },
    ];
    const withoutPostScope = onlineAmtTimingCorrectionForInScopePhysicalTruthForTest(
      candidate,
      [{ pitch: 'C4', performanceTimeMs: 100 }],
      150,
    );
    const withPostScope = onlineAmtTimingCorrectionForInScopePhysicalTruthForTest(
      candidate,
      [{ pitch: 'C4', performanceTimeMs: 100 }, { pitch: 'C4', performanceTimeMs: 175 }],
      150,
    );
    expect(withPostScope.timingCorrectionMs).toBe(withoutPostScope.timingCorrectionMs);
    expect(withPostScope.matchedPostScopePhysicalPairCount).toBe(0);
  });

  it('keeps late candidate decisions for in-scope terminal attacks eligible for timing calibration', () => {
    const result = onlineAmtTimingCorrectionForInScopePhysicalTruthForTest(
      [{ pitch: 'C4', rawDecisionTimeMs: 180 }],
      [{ pitch: 'C4', performanceTimeMs: 100 }],
      150,
    );
    expect(result.timingCorrectionMs).toBe(-80);
    expect(result.lateInScopeDecisionPairCount).toBe(1);
  });

  it('applies the 100ms latency threshold to each survivor instead of the total spread', () => {
    const result = resolveCalibrationGate2ExactProfile([
      { profileId: 'a', contextProfileId: '5S', modelInputMs: 5000, finalizedFeedbackAgeP95Ms: 1000, configurationSha256: 'a' },
      { profileId: 'b', contextProfileId: '5S', modelInputMs: 5000, finalizedFeedbackAgeP95Ms: 1050, configurationSha256: 'b' },
      { profileId: 'c', contextProfileId: '5S', modelInputMs: 5000, finalizedFeedbackAgeP95Ms: 5000, configurationSha256: 'c' },
    ]);
    expect(result.profilesAfterLatency).toEqual(['a', 'b']);
    expect(result.latencyRows.find((row) => row.profileId === 'c')?.latencyDominated).toBe(true);
    expect(result.latencyRows.find((row) => row.profileId === 'b')?.latencyDominated).toBe(false);
  });

  it.each([
    [0, true],
    [50, true],
    [100, false],
  ])('resolves same-context threshold ties at latency delta %ims with the neutral hash only when needed', (delta, neutralHashSurvives) => {
    const result = resolveCalibrationGate2ExactProfile([
      { profileId: 'a', contextProfileId: '5S', modelInputMs: 5000, finalizedFeedbackAgeP95Ms: 1000, configurationSha256: 'a' },
      { profileId: 'b', contextProfileId: '5S', modelInputMs: 5000, finalizedFeedbackAgeP95Ms: 1000 + delta, configurationSha256: 'b' },
    ]);
    if (neutralHashSurvives) {
      expect(result.reason).toBe('NON_PERFORMANCE_NEUTRAL_HASH');
      expect(result.neutralTieKeys).toHaveLength(2);
    } else {
      expect(result.profilesAfterLatency).toEqual(['a']);
      expect(result.reason).toBe('GATE2_FINALIZED_FEEDBACK_AGE_P95_MS');
      expect(result.neutralTieKeys).toHaveLength(0);
    }
  });

  it('uses the smaller context before neutral threshold resolution', () => {
    const result = resolveCalibrationGate2ExactProfile([
      { profileId: 'long', contextProfileId: '10S', modelInputMs: 10000, finalizedFeedbackAgeP95Ms: 1000, configurationSha256: 'long' },
      { profileId: 'short', contextProfileId: '5S', modelInputMs: 5000, finalizedFeedbackAgeP95Ms: 1050, configurationSha256: 'short' },
    ]);
    expect(result.selectedProfileId).toBe('short');
    expect(result.reason).toBe('GATE2_CONTEXT_SIZE_TIE_BREAK');
    expect(result.neutralTieKeys).toHaveLength(0);
  });

  it('is input-order independent for neutral tie resolution', () => {
    const profiles = [
      { profileId: 'a', contextProfileId: '5S', modelInputMs: 5000, finalizedFeedbackAgeP95Ms: 1000, configurationSha256: 'a' },
      { profileId: 'b', contextProfileId: '5S', modelInputMs: 5000, finalizedFeedbackAgeP95Ms: 1000, configurationSha256: 'b' },
      { profileId: 'c', contextProfileId: '5S', modelInputMs: 5000, finalizedFeedbackAgeP95Ms: 1000, configurationSha256: 'c' },
    ];
    const forward = resolveCalibrationGate2ExactProfile(profiles);
    const reverse = resolveCalibrationGate2ExactProfile([...profiles].reverse());
    expect(reverse).toEqual(forward);
  });

  it('compares independently supplied base and target candidate configuration identities for reuse', () => {
    const baseExecutionIdentity = {
      candidateId: 'bytedance-score-aware-chunked-dev-v1',
      candidateConfigurationSha256: 'base',
      modelIdentity: 'model',
      runtimeProfileIdentity: 'runtime',
    };
    const targetExecutionIdentity = { ...baseExecutionIdentity, candidateConfigurationSha256: 'target' };
    const decision = decideCandidateSpecificAcousticEvidenceReuse({
      candidateId: 'bytedance-score-aware-chunked-dev-v1',
      sameSourceAudioSha: true,
      samePerformanceOrigin: true,
      sameCompletion: true,
      sameGeometrySha: true,
      baseExecutionIdentity,
      targetExecutionIdentity,
    });
    expect(decision.baseCandidateConfigurationSha256).toBe('base');
    expect(decision.targetCandidateConfigurationSha256).toBe('target');
    expect(decision.sameFrozenCandidateConfiguration).toBe(false);
    expect(decision.status).toBe('ACOUSTIC_EVIDENCE_REUSE_REJECTED');
  });

  it('allows candidate-specific reuse decisions to differ', () => {
    const identity = (candidateId: string) => ({
      candidateId,
      candidateConfigurationSha256: `${candidateId}-config`,
      modelIdentity: `${candidateId}-model`,
      runtimeProfileIdentity: `${candidateId}-runtime`,
    });
    const byteDance = decideCandidateSpecificAcousticEvidenceReuse({
      candidateId: 'bytedance-score-aware-chunked-dev-v1',
      sameSourceAudioSha: true,
      samePerformanceOrigin: true,
      sameCompletion: true,
      sameGeometrySha: false,
      baseExecutionIdentity: identity('bytedance-score-aware-chunked-dev-v1'),
      targetExecutionIdentity: identity('bytedance-score-aware-chunked-dev-v1'),
    });
    const onlineAmt = decideCandidateSpecificAcousticEvidenceReuse({
      candidateId: 'online-amt-stateful-modern-compat-dev-v1',
      sameSourceAudioSha: true,
      samePerformanceOrigin: true,
      sameCompletion: true,
      sameGeometrySha: true,
      baseExecutionIdentity: identity('online-amt-stateful-modern-compat-dev-v1'),
      targetExecutionIdentity: identity('online-amt-stateful-modern-compat-dev-v1'),
    });
    expect(byteDance.status).toBe('ACOUSTIC_EVIDENCE_REUSE_REJECTED');
    expect(onlineAmt.status).toBe('ACOUSTIC_EVIDENCE_REUSED_IDENTICAL_INPUT');
  });

  it('selects calibration profiles with direct paired scenario-level bootstrap', () => {
    const scores = [
      ...profileScores('safe', Array.from({ length: 12 }, () => 0.10)),
      ...profileScores('unsafe', Array.from({ length: 12 }, () => 0.13)),
    ];
    const result = selectCalibrationProfile(scores);
    expect(result.selectedProfileId).toBe('safe');
    expect(result.decisions[0].pairwiseComparisons[0]).toMatchObject({
      leftProfileId: 'safe',
      rightProfileId: 'unsafe',
      pairedScenarioCount: 12,
    });
  });

  it('excludes zero-denominator scenario metrics instead of converting them to zero', () => {
    const scores = [
      score('a', 'zero-denom', 'COUNTERFACTUAL_MISSING_NOTE', 0, 'falseMatchRateOnGroundTruthMissing', 0),
      score('b', 'zero-denom', 'COUNTERFACTUAL_MISSING_NOTE', 1, 'falseMatchRateOnGroundTruthMissing', 0),
    ];
    const result = selectCalibrationProfile(scores);
    expect(result.decisions[0].pairwiseComparisons[0]).toMatchObject({
      pairedScenarioCount: 0,
      meanDifferenceLeftMinusRight: null,
    });
    expect(result.decisions[0].dominatedProfileIds).toEqual([]);
  });

  it('is permutation invariant for three or more profiles', () => {
    const scores = [
      ...profileScores('a', Array.from({ length: 12 }, () => 0.10)),
      ...profileScores('b', Array.from({ length: 12 }, () => 0.11)),
      ...profileScores('c', Array.from({ length: 12 }, () => 0.13)),
      ...profileScores('d', Array.from({ length: 12 }, () => 0.12)),
    ];
    const expected = selectCalibrationProfile(scores).remainingProfileIds;
    for (const order of [['d', 'c', 'b', 'a'], ['b', 'd', 'a', 'c'], ['c', 'a', 'd', 'b']]) {
      const permuted = order.flatMap((profileId) => scores.filter((item) => item.profileId === profileId));
      expect(selectCalibrationProfile(permuted).remainingProfileIds).toEqual(expected);
      expect(selectCalibrationProfile(permuted).decisions.map((item) => item.remainingProfileIds)).toEqual(
        selectCalibrationProfile(scores).decisions.map((item) => item.remainingProfileIds),
      );
    }
  });

  it('uses direct paired dominance instead of pooled event-rate weighting', () => {
    const scores: CalibrationProfileScenarioScore[] = [];
    for (let index = 0; index < 12; index += 1) {
      scores.push(score('pooled-favorite', `s${index}`, 'COUNTERFACTUAL_MISSING_NOTE', index === 0 ? 0 : 0.20, 'falseMatchRateOnGroundTruthMissing', index === 0 ? 1000 : 1));
      scores.push(score('paired-favorite', `s${index}`, 'COUNTERFACTUAL_MISSING_NOTE', index === 0 ? 0.10 : 0.05, 'falseMatchRateOnGroundTruthMissing', index === 0 ? 1 : 1));
    }
    const aggregates = selectCalibrationProfile(scores).absoluteAggregates
      .filter((item) => item.metric === 'criticalFalseMatchRate');
    expect(aggregates.find((item) => item.profileId === 'pooled-favorite')?.value)
      .toBeLessThan(aggregates.find((item) => item.profileId === 'paired-favorite')?.value ?? 1);
    expect(selectCalibrationProfile(scores).selectedProfileId).toBe('paired-favorite');
  });

  it('treats contradictory pairwise dominance cycles as ties at that priority', () => {
    const scores = [
      ...profileScores('a', [0.10, 0.10, 0.10, 0.10, 0.10, 0.10, 0.10, 0.10], 'COUNTERFACTUAL_MISSING_NOTE'),
      ...profileScores('b', [0.20, 0.20, 0.20, 0.20, 0.20, 0.20, 0.20, 0.20], 'COUNTERFACTUAL_MISSING_NOTE'),
      ...Array.from({ length: 8 }, (_, index) => score('b', `t${index}`, 'COUNTERFACTUAL_WRONG_SEMITONE', 0.10)),
      ...Array.from({ length: 8 }, (_, index) => score('c', `t${index}`, 'COUNTERFACTUAL_WRONG_SEMITONE', 0.20)),
      ...Array.from({ length: 8 }, (_, index) => score('c', `u${index}`, 'COUNTERFACTUAL_INCOMPLETE_CHORD', 0.10)),
      ...Array.from({ length: 8 }, (_, index) => score('a', `u${index}`, 'COUNTERFACTUAL_INCOMPLETE_CHORD', 0.20)),
    ];
    const firstDecision = selectCalibrationProfile(scores).decisions[0];
    expect(firstDecision.cycleTreatedAsTie).toBe(true);
    expect(firstDecision.remainingProfileIds).toEqual(['a', 'b', 'c']);
  });

  it('uses later priorities only when safety evidence is statistically tied', () => {
    const leftSafety = Array.from({ length: 12 }, (_, index) => 0.10 + (index % 2) * 0.04);
    const rightSafety = Array.from({ length: 12 }, (_, index) => 0.11 + (index % 2) * 0.04);
    const scores = [
      ...profileScores('left', leftSafety),
      ...profileScores('right', rightSafety),
      ...allMetricScores('left', Array.from({ length: 12 }, () => 0.80), 'BASE_ORIGINAL', 'verdictAgreementRate'),
      ...allMetricScores('right', Array.from({ length: 12 }, () => 0.86), 'BASE_ORIGINAL', 'verdictAgreementRate'),
    ];
    expect(selectCalibrationProfile(scores).selectedProfileId).toBe('right');
  });

  it('does not allow latency to override Gate-1 selection', () => {
    const scores = [
      ...allMetricScores('accurate-slow', Array.from({ length: 12 }, () => 0.90), 'BASE_ORIGINAL', 'verdictAgreementRate'),
      ...allMetricScores('fast-weak', Array.from({ length: 12 }, () => 0.86), 'BASE_ORIGINAL', 'verdictAgreementRate'),
    ];
    expect(selectCalibrationProfile(scores).selectedProfileId).toBe('accurate-slow');
  });
});
