import { describe, expect, it } from 'vitest';

import {
  BYTEDANCE_PHASE_9GA_CONTEXT_GEOMETRIES,
  ONLINE_AMT_TIMING_CALIBRATION_V1,
  assertCandidateExecutorReachableForPhase9G,
  assertPhase9GExecutionAllowed,
  selectCalibrationProfile,
  type CalibrationProfileEvidence,
} from './public-model-calibration';

const policy = {
  path: 'public_model_calibration_protocol_v1_2026-10-09.json',
  sha256: 'a'.repeat(64),
  policyId: 'PUBLIC_MODEL_CALIBRATION_PROTOCOL_V1',
  schemaVersion: 1,
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

function metric(meanDifference: number, low: number, high: number, pairedScenarioCount = 12) {
  return {
    meanDifference,
    bootstrap95Ci: { low, high },
    pairedScenarioCount,
  };
}

function profile(profileId: string, overrides: Partial<CalibrationProfileEvidence['metrics']> = {}): CalibrationProfileEvidence {
  const tied = metric(0.5, 0.49, 0.51, 12);
  return {
    profileId,
    metrics: {
      criticalFalseMatchRate: tied,
      incompleteChordFalseCompleteRate: tied,
      baseVerdictAgreementRate: tied,
      criticalCorrectMissingRate: tied,
      baseChordExactCompletenessRate: tied,
      baseExpectedStrikeRecall: tied,
      extraNoteExtraPrecision: tied,
      extraNoteExtraRecall: tied,
      baseTimingMedianMs: metric(10, 9, 11, 12),
      baseTimingP95Ms: metric(30, 29, 31, 12),
      ...overrides,
    },
  };
}

describe('public model calibration protocol', () => {
  it('allows Phase 9G-A candidate inference only for p07-p14 CALIBRATION', () => {
    expect(() => assertCandidateExecutorReachableForPhase9G(request())).not.toThrow();
    expect(() => assertCandidateExecutorReachableForPhase9G(request({
      performers: ['p07', 'p08', 'p09', 'p10', 'p11', 'p12', 'p13', 'p15'],
    }))).toThrow(/PHASE_9GA_BLIND_EVALUATION_INFERENCE_FORBIDDEN/);
    expect(() => assertCandidateExecutorReachableForPhase9G(request({
      scenarioSplit: 'EVALUATION',
    }))).toThrow(/REQUIRES_CALIBRATION/);
    expect(() => assertCandidateExecutorReachableForPhase9G(request({
      performers: ['p99'],
    }))).toThrow(/CALIBRATION_PERFORMER_SET_REQUIRED/);
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

  it('validates policy identity and hash shape before execution', () => {
    expect(() => assertPhase9GExecutionAllowed(request({ policy: { ...policy, sha256: 'bad' } })))
      .toThrow(/POLICY_SHA_INVALID/);
    expect(() => assertPhase9GExecutionAllowed(request({ policy: { ...policy, policyId: 'wrong' } })))
      .toThrow(/POLICY_ID_MISMATCH/);
  });

  it('freezes ByteDance 3s/5s/10s context geometry exactly', () => {
    expect(BYTEDANCE_PHASE_9GA_CONTEXT_GEOMETRIES.find((item) => item.profileId === 'INTERMEDIATE_CONTEXT_3S'))
      .toMatchObject({ modelInputMs: 3000, ownedCentralRegionMs: 1500, pastContextMs: 750, futureContextMs: 750 });
    expect(BYTEDANCE_PHASE_9GA_CONTEXT_GEOMETRIES.find((item) => item.profileId === 'INTERMEDIATE_CONTEXT_5S'))
      .toMatchObject({ modelInputMs: 5000, ownedCentralRegionMs: 2500, pastContextMs: 1250, futureContextMs: 1250 });
    expect(BYTEDANCE_PHASE_9GA_CONTEXT_GEOMETRIES.find((item) => item.profileId === 'UPSTREAM_10S_REFERENCE'))
      .toMatchObject({ modelInputMs: 10000, ownedCentralRegionMs: 5000, pastContextMs: 2500, futureContextMs: 2500 });
  });

  it('freezes Online-AMT timing calibration as one deterministic algorithm', () => {
    expect(ONLINE_AMT_TIMING_CALIBRATION_V1.algorithmId).toBe('ONLINE_AMT_TIMING_CALIBRATION_V1');
    expect(ONLINE_AMT_TIMING_CALIBRATION_V1.rawTimingCorrectionMs).toBe(0);
    expect(ONLINE_AMT_TIMING_CALIBRATION_V1.matchWindowMs).toBe(250);
    expect(ONLINE_AMT_TIMING_CALIBRATION_V1.forbiddenInputs).toContain('BLIND_EVALUATION data');
  });

  it('selects calibration profiles order-independently with safety first', () => {
    const safe = profile('safe', { criticalFalseMatchRate: metric(0.10, 0.09, 0.11) });
    const unsafe = profile('unsafe', { criticalFalseMatchRate: metric(0.13, 0.12, 0.14), baseVerdictAgreementRate: metric(0.9, 0.89, 0.91) });
    expect(selectCalibrationProfile([unsafe, safe]).selectedProfileId).toBe('safe');
    expect(selectCalibrationProfile([safe, unsafe]).selectedProfileId).toBe('safe');
  });

  it('treats safety evidence with crossing confidence interval as tied', () => {
    const left = profile('left', { criticalFalseMatchRate: metric(0.10, 0.05, 0.15), baseVerdictAgreementRate: metric(0.80, 0.79, 0.81) });
    const right = profile('right', { criticalFalseMatchRate: metric(0.11, 0.04, 0.16), baseVerdictAgreementRate: metric(0.84, 0.83, 0.85) });
    expect(selectCalibrationProfile([left, right]).selectedProfileId).toBe('right');
  });

  it('does not let latency beat a Gate-1 accuracy difference', () => {
    const accurateSlow = { ...profile('accurate-slow', { baseVerdictAgreementRate: metric(0.90, 0.89, 0.91) }), latency: { medianMs: 100, p95Ms: 150 } };
    const fastWeak = { ...profile('fast-weak', { baseVerdictAgreementRate: metric(0.86, 0.85, 0.87) }), latency: { medianMs: 1, p95Ms: 2 } };
    expect(selectCalibrationProfile([fastWeak, accurateSlow]).selectedProfileId).toBe('accurate-slow');
  });

  it('keeps all profiles when Gate-1 evidence is effectively tied', () => {
    const result = selectCalibrationProfile([profile('a'), profile('b')]);
    expect(result.status).toBe('GATE_1_TIE');
    expect(result.remainingProfileIds).toEqual(['a', 'b']);
  });
});
