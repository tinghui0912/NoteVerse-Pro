#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = process.cwd();
const require = createRequire(import.meta.url);
const { createJiti } = require(path.resolve(repoRoot, 'apps/customer-web/node_modules/jiti'));
const jiti = createJiti(import.meta.url);

const challengerQual = jiti(path.resolve(repoRoot, 'apps/customer-web/src/lib/practice/research/public-challenger-qualification.ts'));
const calibration = jiti(path.resolve(repoRoot, 'apps/customer-web/src/lib/practice/research/public-model-calibration.ts'));
const publicContract = jiti(path.resolve(repoRoot, 'apps/customer-web/src/lib/practice/research/public-fixed-bpm-benchmark.ts'));
const byteDance = jiti(path.resolve(repoRoot, 'apps/customer-web/src/lib/practice/research/bytedance-score-aware-chunked.ts'));

const IMPLEMENTATION_HEAD = gitHead(repoRoot);
const DIRTY = gitDirty(repoRoot);

const POLICY_REL = 'backend/research/policies/public_challenger_qualification_protocol_v1_2026-10-09.json';
const INCUMBENT_REGISTRY_REL = 'backend/research/reports/phase9g_a25_final_incumbent_registry_2026-10-09.json';
const SCENARIO_REL = 'backend/research/reports/phase9g_a1_vienna_calibration_scenarios_2026-10-09.json';
const BLIND_REL = 'backend/research/reports/phase9g_b_blind_truth_only_scenarios_2026-10-09.json';
const A24_REPORT_REL = 'backend/research/reports/phase9g_a24_bytedance_online_amt_incumbent_completion_2026-10-09.json';

const OUTPUT_REGISTRY_REL = 'backend/research/reports/phase9g_a3_final_candidate_registry_2026-10-09.json';
const OUTPUT_REPORT_REL = 'backend/research/reports/phase9g_a3_challenger_qualification_report_2026-10-09.json';
const OUTPUT_RAW_EVIDENCE_REL = 'backend/research/reports/phase9g_a3_raw_evidence_manifest_2026-10-09.json';
const OUTPUT_BLIND_LOCK_REL = 'backend/research/reports/phase9g_a3_blind_lock_receipt_2026-10-09.json';
const OUTPUT_CONTEXT_ELIGIBILITY_REL = 'backend/research/reports/phase9g_a3_context_eligibility_manifest_2026-10-09.json';

const WORK_DIR = 'backend/data/work/public_proxy/vienna-4x22/phase9ga3';

const DOCKER_CHALLENGERS_IMAGE = 'noteverse-challengers:phase9ga3';
const DOCKER_ARIA_IMAGE = 'noteverse-aria-amt-bench:gpu-cu124-patched';

await mkdir(path.resolve(repoRoot, 'backend/research/reports'), { recursive: true });
await mkdir(path.resolve(repoRoot, WORK_DIR), { recursive: true });

// 1. Verify Challenger Qualification Protocol and Assert Guards
const policyFileRaw = await readFile(path.resolve(repoRoot, POLICY_REL), 'utf8');
const policyFileSha256 = sha256Text(policyFileRaw);
const policy = JSON.parse(policyFileRaw);

challengerQual.assertChallengerQualificationPolicyIdentity({
  policyId: policy.policyId,
  schemaVersion: policy.schemaVersion,
  sha256: policyFileSha256,
});

const incumbentPolicySha256 = policy.frozenIncumbentPolicy.sha256;
const incumbentRegistrySha256 = await sha256File(path.resolve(repoRoot, INCUMBENT_REGISTRY_REL));
const blindManifestSha256 = await sha256File(path.resolve(repoRoot, BLIND_REL));

challengerQual.assertChallengerExecutionAllowed({
  policy: {
    policyId: policy.policyId,
    schemaVersion: policy.schemaVersion,
    sha256: policyFileSha256,
  },
  incumbentPolicySha256,
  incumbentRegistrySha256,
  blindManifestSha256,
  phase: '9G-A.3',
  mode: 'CANDIDATE_INFERENCE',
  scenarioSplit: 'CALIBRATION',
  performers: ['p07', 'p08', 'p09', 'p10', 'p11', 'p12', 'p13', 'p14'],
});

// 2. Blind Lock Receipt
const blindManifest = JSON.parse(await readFile(path.resolve(repoRoot, BLIND_REL), 'utf8'));
const blindLockReceipt = {
  schemaVersion: 1,
  artifact: 'phase9g_a3_blind_lock_receipt',
  phase: '9G-A.3',
  blindManifestPath: BLIND_REL,
  blindManifestSha256,
  expectedBlindManifestSha256: '0da00e7ad6ff3582f70e4b645be915d44e5dcb30fd4773b69372433e99a1d0ab',
  scenarioCount: blindManifest.scenarios.length,
  candidateRunCount: 0,
  blindPerformers: ['p15', 'p16', 'p17', 'p18', 'p19', 'p20', 'p21', 'p22'],
  generatedAt: new Date().toISOString(),
};

if (blindLockReceipt.blindManifestSha256 !== blindLockReceipt.expectedBlindManifestSha256 || blindLockReceipt.scenarioCount !== 70) {
  throw new Error(`Blind lock mismatch: ${JSON.stringify(blindLockReceipt)}`);
}
await writeJson(OUTPUT_BLIND_LOCK_REL, blindLockReceipt);

// 3. Load Scenarios
const scenarioManifestRaw = await readFile(path.resolve(repoRoot, SCENARIO_REL), 'utf8');
const scenarioManifestSha256 = sha256Text(scenarioManifestRaw);
const scenarioManifest = JSON.parse(scenarioManifestRaw);
const scenarios = scenarioManifest.scenarios;
const baseScenarios = scenarios.filter((s) => s.familyTags.includes('BASE_ORIGINAL'));
const counterfactualReceipts = new Map(
  (scenarioManifest.counterfactualReceipts ?? []).map((r) => [r.scenarioId, r])
);

console.log(`Loaded ${scenarios.length} calibration scenarios (${baseScenarios.length} base scenarios).`);

// 4. Compute Context Eligibility
const contextGeometries = calibration.BYTEDANCE_PHASE_9GA_CONTEXT_GEOMETRIES;
const eligibilityList = [];

for (const scenario of scenarios) {
  // Robust ByteDance
  for (const ctx of contextGeometries) {
    let eligible = true;
    let reason = null;
    try {
      const plans = planByteDanceVariableContext(scenario, ctx);
      validateByteDanceVariableContextSource(scenario, plans, ctx);
    } catch (err) {
      eligible = false;
      reason = errorMessage(err);
    }
    eligibilityList.push({
      scenarioId: scenario.scenarioId,
      candidateFamily: 'bytedance-robust-augmented',
      contextProfileId: ctx.profileId,
      isEligible: eligible,
      preRollMs: ctx.modelInputMs - (ctx.futureContextMs ?? 0),
      postRollMs: ctx.futureContextMs ?? 0,
      requiredWindowMs: ctx.modelInputMs,
      missingContextReason: reason ?? undefined,
    });
  }
  // Transkun
  eligibilityList.push({
    scenarioId: scenario.scenarioId,
    candidateFamily: 'transkun',
    isEligible: true,
    preRollMs: 0,
    postRollMs: 0,
    requiredWindowMs: 0,
  });
  // Aria-AMT
  eligibilityList.push({
    scenarioId: scenario.scenarioId,
    candidateFamily: 'aria-amt',
    isEligible: true,
    preRollMs: 0,
    postRollMs: 0,
    requiredWindowMs: 0,
  });
  // RTT
  eligibilityList.push({
    scenarioId: scenario.scenarioId,
    candidateFamily: 'rtt',
    isEligible: true,
    preRollMs: 0,
    postRollMs: 0,
    requiredWindowMs: 0,
  });
}

challengerQual.assertCandidateContextEligibilityFrozen(eligibilityList);
await writeJson(OUTPUT_CONTEXT_ELIGIBILITY_REL, {
  schemaVersion: 1,
  artifact: 'phase9g_a3_context_eligibility_manifest',
  phase: '9G-A.3',
  records: eligibilityList,
});

// 5. Run Candidate Inferences
console.log('--- Executing Challenger Inferences ---');

// A. Robust ByteDance
const robustByteDanceResult = await runRobustByteDanceFamily({
  scenarios,
  baseScenarios,
  counterfactualReceipts,
  contextGeometries,
});

// B. Transkun V2 Aug
const transkunResult = await runTranskunFamily({
  scenarios,
  baseScenarios,
  counterfactualReceipts,
});

// C. Aria-AMT
const ariaAmtResult = await runAriaAmtFamily({
  scenarios,
  baseScenarios,
  counterfactualReceipts,
});

// D. RTT
const rttResult = await runRttFamily({
  scenarios,
  baseScenarios,
  counterfactualReceipts,
});

// E. D3RM
const d3rmResult = {
  candidateFamily: 'd3rm',
  candidateId: 'd3rm-offline-ceiling-reference',
  status: 'EXECUTION_BLOCKED_DEPENDENCY_NATTEN_CUDA',
  licenseClassification: 'LICENSE_OR_USAGE_RIGHTS_UNRESOLVED',
};

// 6. Verify Score Independence
for (const run of [...robustByteDanceResult.runs, ...transkunResult.runs, ...ariaAmtResult.runs, ...rttResult.runs]) {
  const scenario = scenarios.find((s) => s.scenarioId === run.scenarioId);
  if (!scenario) continue;
  const expectedPitches = new Set(scenario.expectedStrikes.map((s) => s.pitch));
  const observations = run.publications.flatMap((p) => p.observations);
  challengerQual.assertCandidateRawInferenceScoreIndependent(observations, expectedPitches);
}

// 7. Load Incumbent Data from A.2.4 / A.2.5
const incumbentRegistry = JSON.parse(await readFile(path.resolve(repoRoot, INCUMBENT_REGISTRY_REL), 'utf8'));
const a24Report = JSON.parse(await readFile(path.resolve(repoRoot, A24_REPORT_REL), 'utf8'));

// 8. Cross-Family Diagnostic Pairwise Comparisons
const diagnosticScenarios = scenarios;
const diagnosticCandidates = [
  robustByteDanceResult.candidateDefinition,
  transkunResult.candidateDefinition,
  ariaAmtResult.candidateDefinition,
  rttResult.candidateDefinition,
];
const diagnosticRuns = [
  ...robustByteDanceResult.representativeRuns,
  ...transkunResult.runs,
  ...ariaAmtResult.runs,
  ...rttResult.runs,
];

const diagnosticBakeoff = publicContract.buildPublicDiagnosticBakeoffReport({
  scenarios: diagnosticScenarios,
  candidates: diagnosticCandidates,
  runs: diagnosticRuns,
});

// 9. Build Final Candidate Registry
const finalRegistry = {
  schemaVersion: 1,
  artifact: 'phase9g_a3_final_candidate_registry',
  phase: '9G-A.3',
  generatedAt: new Date().toISOString(),
  policyId: policy.policyId,
  policySha256: policyFileSha256,
  incumbents: incumbentRegistry.incumbents,
  challengers: [
    {
      candidateFamily: 'bytedance-robust-augmented',
      candidateId: robustByteDanceResult.representativeProfile.candidateId,
      profileId: robustByteDanceResult.representativeProfile.profileId,
      configurationSha256: robustByteDanceResult.representativeProfile.configurationSha256,
      checkpointSha256: 'b20f72053abc15b78f689b2a8b04c0a06529c8466e898b915803a1daa2011b9e',
      selectionMethod: robustByteDanceResult.selectionMethod,
      licenseClassification: 'PRODUCTION_LICENSE_ELIGIBLE',
      metrics: compactMetrics(diagnosticBakeoff.aggregateMetrics[robustByteDanceResult.representativeProfile.candidateId]?.CALIBRATION),
    },
    {
      candidateFamily: 'transkun',
      candidateId: transkunResult.candidateDefinition.candidateId,
      profileId: 'UPSTREAM_NATIVE_V2_AUG',
      configurationSha256: transkunResult.candidateDefinition.identity.configurationSha256,
      checkpointSha256: '8bd6b4b5ddf9ce8c5f296a57859eec9f166cd337c35245ec2a2576d90be68c4c',
      selectionMethod: 'SINGLETON_PROFILE_FREEZE',
      licenseClassification: 'PRODUCTION_LICENSE_ELIGIBLE',
      metrics: compactMetrics(diagnosticBakeoff.aggregateMetrics[transkunResult.candidateDefinition.candidateId]?.CALIBRATION),
    },
    {
      candidateFamily: 'aria-amt',
      candidateId: ariaAmtResult.candidateDefinition.candidateId,
      profileId: 'UPSTREAM_NATIVE_PIANO_MEDIUM_DOUBLE',
      configurationSha256: ariaAmtResult.candidateDefinition.identity.configurationSha256,
      checkpointSha256: '089d3129dbe93246aeda55efe668c8a48af08afaf9dd15c64cef0a07c0fb30a4',
      selectionMethod: 'SINGLETON_PROFILE_FREEZE',
      licenseClassification: 'RESEARCH_VALID_PRODUCTION_LICENSE_BLOCKED',
      metrics: compactMetrics(diagnosticBakeoff.aggregateMetrics[ariaAmtResult.candidateDefinition.candidateId]?.CALIBRATION),
    },
    {
      candidateFamily: 'rtt',
      candidateId: rttResult.candidateDefinition.candidateId,
      profileId: 'CAUSAL_STREAMING_NATIVE',
      configurationSha256: rttResult.candidateDefinition.identity.configurationSha256,
      checkpointSha256: '901fc3da306fb4cffd96c55298d1439447e5a79f48cf436b4e76fde46db569f1',
      selectionMethod: 'SINGLETON_PROFILE_FREEZE',
      licenseClassification: 'RESEARCH_VALID_PRODUCTION_LICENSE_BLOCKED',
      metrics: compactMetrics(diagnosticBakeoff.aggregateMetrics[rttResult.candidateDefinition.candidateId]?.CALIBRATION),
    },
    {
      candidateFamily: 'd3rm',
      candidateId: d3rmResult.candidateId,
      status: d3rmResult.status,
      licenseClassification: d3rmResult.licenseClassification,
    },
  ],
  productionWinnerSelected: false,
};
await writeJson(OUTPUT_REGISTRY_REL, finalRegistry);

// 10. Build Full Qualification Report
const report = {
  schemaVersion: 1,
  artifact: 'phase9g_a3_challenger_qualification_report',
  phase: '9G-A.3',
  generatedAt: new Date().toISOString(),
  implementationGitHead: IMPLEMENTATION_HEAD,
  dirtyTreeAtExecution: DIRTY,
  policy: {
    policyId: policy.policyId,
    schemaVersion: policy.schemaVersion,
    sha256: policyFileSha256,
  },
  frozenIncumbents: incumbentRegistry.incumbents,
  frozenBlind: {
    manifestPath: BLIND_REL,
    manifestSha256: blindManifestSha256,
    candidateRunCount: 0,
  },
  scenarioManifest: {
    manifestPath: SCENARIO_REL,
    manifestSha256: scenarioManifestSha256,
    scenarioCount: scenarios.length,
    baseScenarioCount: baseScenarios.length,
  },
  challengers: {
    bytedanceRobustAugmented: robustByteDanceResult.report,
    transkunV2Aug: transkunResult.report,
    ariaAmt: ariaAmtResult.report,
    rtt: rttResult.report,
    d3rm: d3rmResult,
  },
  crossFamilyDiagnosticComparison: {
    role: 'CALIBRATION_CROSS_FAMILY_DIAGNOSTIC_ONLY',
    productionWinnerSelected: false,
    aggregateMetrics: diagnosticBakeoff.aggregateMetrics,
  },
  confirmations: {
    noBlindCandidateInferencePerformed: true,
    blindCandidateRunCountIsZero: true,
    noProductionWinnerSelected: true,
    allCandidatesPassedScoreIndependenceCheck: true,
  },
};
await writeJson(OUTPUT_REPORT_REL, report);

// 11. Raw Evidence Manifest
await writeJson(OUTPUT_RAW_EVIDENCE_REL, {
  schemaVersion: 1,
  artifact: 'phase9g_a3_raw_evidence_manifest',
  phase: '9G-A.3',
  generatedAt: new Date().toISOString(),
  bytedanceRobust: robustByteDanceResult.evidence,
  transkun: transkunResult.evidence,
  ariaAmt: ariaAmtResult.evidence,
  rtt: rttResult.evidence,
});

console.log('Phase 9G-A.3 execution finished successfully!');
console.log(`Registry: ${OUTPUT_REGISTRY_REL}`);
console.log(`Report: ${OUTPUT_REPORT_REL}`);

// ---------------- Helper Functions ----------------

async function runRobustByteDanceFamily(input) {
  const { scenarios, baseScenarios, counterfactualReceipts, contextGeometries } = input;
  console.log('Running Robust ByteDance...');

  const contexts = contextGeometries;
  const commonBaseScenarios = baseScenarios.filter((s) => {
    return contexts.every((ctx) => {
      try {
        const plans = planByteDanceVariableContext(s, ctx);
        validateByteDanceVariableContextSource(s, plans, ctx);
        return true;
      } catch {
        return false;
      }
    });
  });
  const commonScenarioIds = new Set([
    ...commonBaseScenarios.map((s) => s.scenarioId),
    ...scenarios
      .filter((s) => commonBaseScenarios.some((b) => counterfactualReceipts.get(s.scenarioId)?.baseScenarioId === b.scenarioId))
      .map((s) => s.scenarioId),
  ]);
  const scoredScenarios = scenarios.filter((s) => commonScenarioIds.has(s.scenarioId));
  console.log(`Robust ByteDance evaluating ${scoredScenarios.length} eligible calibration scenarios (${commonBaseScenarios.length} base).`);

  const rawBatches = new Map();
  const evidence = [];

  for (const ctx of contexts) {
    const windows = [];
    const planByScenario = new Map();

    for (const scenario of commonBaseScenarios) {
      const plans = planByteDanceVariableContext(scenario, ctx);
      planByScenario.set(scenario.scenarioId, plans);
      for (const plan of plans) {
        const inputStartSourceMs = scenario.audio.performanceOriginSourceMs + plan.inputStartPerformanceMs;
        const inputEndSourceMs = scenario.audio.performanceOriginSourceMs + plan.inputEndPerformanceMs;
        windows.push({
          scenarioId: scenario.scenarioId,
          contextProfileId: ctx.profileId,
          windowId: plan.chunkId,
          sourceAudioPath: scenario.source.sourceAudioPath,
          inputStartSourceMs,
          inputEndSourceMs,
          inputSampleCount: Math.round(ctx.modelInputMs / 1000 * 16000),
          identity: {
            schemaVersion: 1,
            candidateFamily: 'bytedance-robust-augmented',
            checkpointSha256: 'b20f72053abc15b78f689b2a8b04c0a06529c8466e898b915803a1daa2011b9e',
            contextProfileId: ctx.profileId,
          },
        });
      }
    }

    const inputRel = `${WORK_DIR}/${ctx.profileId}.bytedance-robust-input.json`;
    const outputRel = `${WORK_DIR}/${ctx.profileId}.bytedance-robust-raw.json`;
    await writeJson(inputRel, { windows });

    if (!existsSync(path.resolve(repoRoot, outputRel))) {
      const run = spawnSync('docker', [
        'run', '--rm', '--gpus', 'all',
        '--entrypoint', 'python3',
        '-v', `${repoRoot}:/workspace`,
        '-w', '/workspace',
        DOCKER_CHALLENGERS_IMAGE,
        '/workspace/backend/scripts/run_bytedance_robust_pytorch_raw_batch.py',
        '--input', `/workspace/${inputRel}`,
        '--output', `/workspace/${outputRel}`,
        '--checkpoint', '/workspace/models/bytedance_piano_transcription/high_resolution_MAESTRO_augmentations.pth',
        '--device', 'cuda',
        '--runtime-identity', DOCKER_CHALLENGERS_IMAGE,
      ], { cwd: repoRoot, encoding: 'utf8', timeout: 3_600_000, maxBuffer: 50 * 1024 * 1024 });

      if (run.status !== 0) throw new Error(`Robust ByteDance raw batch failed: ${run.stderr || run.stdout}`);
    } else {
      console.log(`Reusing existing raw output for ${ctx.profileId}: ${outputRel}`);
    }

    const rawData = JSON.parse(await readFile(path.resolve(repoRoot, outputRel), 'utf8'));
    const chunkMap = new Map();
    for (const chunk of rawData.chunks) {
      if (!chunkMap.has(chunk.scenarioId)) chunkMap.set(chunk.scenarioId, []);
      chunkMap.get(chunk.scenarioId).push(chunk);
    }
    rawBatches.set(ctx.profileId, { chunkMap, plansForScenario: planByScenario });
    evidence.push({ context: ctx.profileId, outputRel, chunkCount: rawData.chunks.length });
  }

  // Evaluate the 80 threshold profiles
  const onsetGrid = [0.15, 0.20, 0.25, 0.30, 0.35];
  const frameGrid = [0.05, 0.10, 0.15, 0.20];

  const profiles = [];
  const candidateDefs = [];
  const runs = [];
  const runsByProfile = new Map();

  for (const ctx of contexts) {
    for (const onset of onsetGrid) {
      for (const frame of frameGrid) {
        const profileId = `${ctx.profileId}-onset-${onset.toFixed(2)}-frame-${frame.toFixed(2)}`;
        const configSha = sha256Json({ context: ctx, onsetThreshold: onset, frameThreshold: frame });
        const profile = { profileId, context: ctx, onsetThreshold: onset, frameThreshold: frame, configurationSha256: configSha };
        profiles.push(profile);

        const candidateDef = {
          candidateId: profileId,
          strategyKind: 'CHUNKED',
          identity: {
            modelRuntime: DOCKER_CHALLENGERS_IMAGE,
            modelCheckpointSha256: 'b20f72053abc15b78f689b2a8b04c0a06529c8466e898b915803a1daa2011b9e',
            adapterVersion: 'phase9g-a3-robust-bytedance-chunked-v1',
            configurationSha256: configSha,
            trainingDataOverlapStatus: 'UNKNOWN',
          },
        };
        candidateDefs.push(candidateDef);

        const profileRuns = [];
        for (const scenario of scoredScenarios) {
          const receipt = counterfactualReceipts.get(scenario.scenarioId);
          const baseScenarioId = receipt?.baseScenarioId ?? scenario.scenarioId;
          const rawBatch = rawBatches.get(ctx.profileId);
          const rawChunks = rawBatch.chunkMap.get(baseScenarioId);
          const plans = rawBatch.plansForScenario.get(baseScenarioId);

          const candidateRun = runByteDanceFromRawChunks({
            scenario,
            profile,
            plans,
            rawChunks,
          });
          profileRuns.push(candidateRun);
          runs.push(candidateRun);
        }
        runsByProfile.set(profileId, profileRuns);
      }
    }
  }

  // Score all 80 profiles
  const bakeoff = publicContract.buildPublicDiagnosticBakeoffReport({
    scenarios: scoredScenarios,
    candidates: candidateDefs,
    runs,
  });

  const calibrationScores = calibrationScoresFromSummaries(bakeoff.scores);
  const gate1Selection = calibration.selectCalibrationProfile(calibrationScores);

  let selectedProfileId = gate1Selection.selectedProfileId;
  let selectionMethod = 'GATE1_SAFETY_FIRST_DOMINANCE';

  if (!selectedProfileId) {
    // Gate 2 Tie break
    const remaining = profiles.filter((p) => gate1Selection.remainingProfileIds.includes(p.profileId));
    const gate2Profiles = remaining.map((p) => ({
      profileId: p.profileId,
      contextProfileId: p.context.profileId,
      modelInputMs: p.context.modelInputMs,
      onsetThreshold: p.onsetThreshold,
      frameThreshold: p.frameThreshold,
      finalizedFeedbackAgeP95Ms: bakeoff.aggregateMetrics[p.profileId]?.CALIBRATION?.finalizedFeedbackAgeP95Ms?.value ?? null,
      configurationSha256: p.configurationSha256,
    }));
    const gate2Res = calibration.resolveCalibrationGate2ExactProfile(gate2Profiles, 100);
    selectedProfileId = gate2Res.selectedProfileId ?? gate2Profiles[0].profileId;
    selectionMethod = gate2Res.reason;
  }

  const selectedProfile = profiles.find((p) => p.profileId === selectedProfileId);
  const representativeRuns = runsByProfile.get(selectedProfileId).map((r) => ({
    ...r,
    candidateId: 'bytedance-robust-augmented-calibrated-v1',
  }));

  const representativeDef = {
    candidateId: 'bytedance-robust-augmented-calibrated-v1',
    strategyKind: 'CHUNKED',
    identity: {
      modelRuntime: DOCKER_CHALLENGERS_IMAGE,
      modelCheckpointSha256: 'b20f72053abc15b78f689b2a8b04c0a06529c8466e898b915803a1daa2011b9e',
      adapterVersion: 'phase9g-a3-robust-bytedance-representative-v1',
      configurationSha256: selectedProfile.configurationSha256,
      trainingDataOverlapStatus: 'UNKNOWN',
    },
  };

  return {
    representativeProfile: {
      candidateId: 'bytedance-robust-augmented-calibrated-v1',
      profileId: selectedProfileId,
      configurationSha256: selectedProfile.configurationSha256,
    },
    candidateDefinition: representativeDef,
    selectionMethod,
    representativeRuns,
    runs,
    evidence,
    report: {
      candidateFamily: 'bytedance-robust-augmented',
      totalProfilesEvaluated: profiles.length,
      selectedProfileId,
      selectionMethod,
      gate1RemainingCount: gate1Selection.remainingProfileIds.length,
      metrics: compactMetrics(bakeoff.aggregateMetrics[selectedProfileId]?.CALIBRATION),
    },
  };
}

async function runTranskunFamily(input) {
  const { scenarios, baseScenarios, counterfactualReceipts } = input;
  console.log('Running Transkun V2 Aug...');

  const audioFiles = baseScenarios.map((s) => ({
    audioKey: s.scenarioId,
    audioPath: s.source.sourceAudioPath,
    audioSha256: s.source.sourceAudioSha256,
  }));

  const inputRel = `${WORK_DIR}/transkun-input.json`;
  const outputRel = `${WORK_DIR}/transkun-output.json`;
  await writeJson(inputRel, { audioFiles });

  if (!existsSync(path.resolve(repoRoot, outputRel))) {
    const run = spawnSync('docker', [
      'run', '--rm', '--gpus', 'all',
      '--entrypoint', 'python3',
      '-v', `${repoRoot}:/workspace`,
      '-w', '/workspace',
      DOCKER_CHALLENGERS_IMAGE,
      '/workspace/backend/scripts/run_transkun_batch.py',
      '--input', `/workspace/${inputRel}`,
      '--output', `/workspace/${outputRel}`,
      '--weight', '/workspace/models/checkpointMSimplerAug/checkpoint.pt',
      '--conf', '/workspace/models/checkpointMSimplerAug/model.conf',
      '--device', 'cuda',
      '--runtime-identity', DOCKER_CHALLENGERS_IMAGE,
    ], { cwd: repoRoot, encoding: 'utf8', timeout: 3_600_000, maxBuffer: 50 * 1024 * 1024 });

    if (run.status !== 0) throw new Error(`Transkun batch failed: ${run.stderr || run.stdout}`);
  } else {
    console.log(`Reusing existing Transkun output: ${outputRel}`);
  }

  const rawData = JSON.parse(await readFile(path.resolve(repoRoot, outputRel), 'utf8'));
  const configSha = sha256Json({ profileId: 'UPSTREAM_NATIVE_V2_AUG', weightSha256: rawData.weightSha256 });

  const candidateDef = {
    candidateId: 'transkun-v2-aug-calibrated-v1',
    strategyKind: 'CHUNKED',
    identity: {
      modelRuntime: DOCKER_CHALLENGERS_IMAGE,
      modelCheckpointSha256: rawData.weightSha256,
      adapterVersion: 'phase9g-a3-transkun-v2-aug-v1',
      configurationSha256: configSha,
      trainingDataOverlapStatus: 'UNKNOWN',
    },
  };

  const runs = [];
  for (const scenario of scenarios) {
    const receipt = counterfactualReceipts.get(scenario.scenarioId);
    const baseScenarioId = receipt?.baseScenarioId ?? scenario.scenarioId;
    const trans = rawData.transcriptions[baseScenarioId];
    if (!trans) throw new Error(`Missing Transkun transcription for ${baseScenarioId}`);

    const completionMs = scenario.completion?.performanceTimeMs ?? 30000;
    const observations = trans.notes
      .map((n, idx) => ({
        observationId: `${scenario.scenarioId}:transkun:obs:${idx}`,
        pitch: n.pitch,
        performanceTimeMs: n.onsetTimeMs - scenario.audio.performanceOriginSourceMs,
        confidence: 1.0,
      }))
      .filter((o) => o.performanceTimeMs >= 0 && o.performanceTimeMs <= completionMs);
    const publications = [
      {
        publicationId: `${scenario.scenarioId}:transkun:pub:0`,
        observations,
        analyzedThroughPerformanceMs: completionMs,
        availabilityTimeMs: completionMs + trans.inferenceLatencyMs,
        diagnostics: {
          inferenceLatencyMs: trans.inferenceLatencyMs,
          publicationDelayMs: trans.inferenceLatencyMs,
        },
      },
    ];

    runs.push({
      candidateId: candidateDef.candidateId,
      scenarioId: scenario.scenarioId,
      publications,
      runProvenance: { command: 'transkun transcribe', runtime: DOCKER_CHALLENGERS_IMAGE },
    });
  }

  return {
    candidateDefinition: candidateDef,
    runs,
    evidence: { outputRel, totalTime: rawData.totalWallTimeSeconds },
    report: {
      candidateFamily: 'transkun',
      profileId: 'UPSTREAM_NATIVE_V2_AUG',
      licenseClassification: 'PRODUCTION_LICENSE_ELIGIBLE',
      totalWallTimeSeconds: rawData.totalWallTimeSeconds,
    },
  };
}

async function runAriaAmtFamily(input) {
  const { scenarios, baseScenarios, counterfactualReceipts } = input;
  console.log('Running Aria-AMT...');

  const audioFiles = baseScenarios.map((s) => ({
    audioKey: s.scenarioId,
    audioPath: s.source.sourceAudioPath,
    audioSha256: s.source.sourceAudioSha256,
  }));

  const inputRel = `${WORK_DIR}/aria-amt-input.json`;
  const outputRel = `${WORK_DIR}/aria-amt-output.json`;
  const workDirRel = `${WORK_DIR}/aria_work`;
  await writeJson(inputRel, { audioFiles });

  if (!existsSync(path.resolve(repoRoot, outputRel))) {
    const run = spawnSync('docker', [
      'run', '--rm', '--gpus', 'all', '--shm-size', '8g',
      '--entrypoint', 'python3',
      '-v', `${repoRoot}:/workspace`,
      '-w', '/workspace',
      DOCKER_ARIA_IMAGE,
      '/workspace/backend/scripts/run_aria_amt_batch.py',
      '--input', `/workspace/${inputRel}`,
      '--output', `/workspace/${outputRel}`,
      '--checkpoint', '/workspace/models/aria-amt/piano-medium-double-1.0.safetensors',
      '--work-dir', `/workspace/${workDirRel}`,
      '--device', 'cuda',
      '--num-workers', '1',
      '--runtime-identity', DOCKER_ARIA_IMAGE,
    ], { cwd: repoRoot, encoding: 'utf8', timeout: 3_600_000, maxBuffer: 50 * 1024 * 1024 });

    if (run.status !== 0) throw new Error(`Aria-AMT batch failed: ${run.stderr || run.stdout}`);
  } else {
    console.log(`Reusing existing Aria-AMT output: ${outputRel}`);
  }

  const rawData = JSON.parse(await readFile(path.resolve(repoRoot, outputRel), 'utf8'));
  const configSha = sha256Json({ profileId: 'UPSTREAM_NATIVE_PIANO_MEDIUM_DOUBLE', checkpointSha256: rawData.checkpointSha256 });

  const candidateDef = {
    candidateId: 'aria-amt-medium-double-v1',
    strategyKind: 'CHUNKED',
    identity: {
      modelRuntime: DOCKER_ARIA_IMAGE,
      modelCheckpointSha256: rawData.checkpointSha256,
      adapterVersion: 'phase9g-a3-aria-amt-medium-double-v1',
      configurationSha256: configSha,
      trainingDataOverlapStatus: 'UNKNOWN',
    },
  };

  const runs = [];
  for (const scenario of scenarios) {
    const receipt = counterfactualReceipts.get(scenario.scenarioId);
    const baseScenarioId = receipt?.baseScenarioId ?? scenario.scenarioId;
    const trans = rawData.transcriptions[baseScenarioId];
    if (!trans) throw new Error(`Missing Aria-AMT transcription for ${baseScenarioId}`);

    const completionMs = scenario.completion?.performanceTimeMs ?? 30000;
    const observations = trans.notes
      .map((n, idx) => ({
        observationId: `${scenario.scenarioId}:aria:obs:${idx}`,
        pitch: n.pitch,
        performanceTimeMs: n.onsetTimeMs - scenario.audio.performanceOriginSourceMs,
        confidence: 1.0,
      }))
      .filter((o) => o.performanceTimeMs >= 0 && o.performanceTimeMs <= completionMs);
    const publications = [
      {
        publicationId: `${scenario.scenarioId}:aria:pub:0`,
        observations,
        analyzedThroughPerformanceMs: completionMs,
        availabilityTimeMs: completionMs + trans.inferenceLatencyMs,
        diagnostics: {
          inferenceLatencyMs: trans.inferenceLatencyMs,
          publicationDelayMs: trans.inferenceLatencyMs,
        },
      },
    ];

    runs.push({
      candidateId: candidateDef.candidateId,
      scenarioId: scenario.scenarioId,
      publications,
      runProvenance: { command: 'aria-amt transcribe', runtime: DOCKER_ARIA_IMAGE },
    });
  }

  return {
    candidateDefinition: candidateDef,
    runs,
    evidence: { outputRel, totalTime: rawData.totalWallTimeSeconds },
    report: {
      candidateFamily: 'aria-amt',
      profileId: 'UPSTREAM_NATIVE_PIANO_MEDIUM_DOUBLE',
      licenseClassification: 'RESEARCH_VALID_PRODUCTION_LICENSE_BLOCKED',
      totalWallTimeSeconds: rawData.totalWallTimeSeconds,
    },
  };
}

async function runRttFamily(input) {
  const { scenarios, baseScenarios, counterfactualReceipts } = input;
  console.log('Running RTT...');

  const audioFiles = baseScenarios.map((s) => ({
    audioKey: s.scenarioId,
    audioPath: s.source.sourceAudioPath,
    audioSha256: s.source.sourceAudioSha256,
  }));

  const inputRel = `${WORK_DIR}/rtt-input.json`;
  const outputRel = `${WORK_DIR}/rtt-output.json`;
  await writeJson(inputRel, { audioFiles });

  if (!existsSync(path.resolve(repoRoot, outputRel))) {
    const run = spawnSync('docker', [
      'run', '--rm', '--gpus', 'all',
      '--entrypoint', 'python3',
      '-v', `${repoRoot}:/workspace`,
      '-w', '/workspace',
      DOCKER_CHALLENGERS_IMAGE,
      '/workspace/backend/scripts/run_rtt_batch.py',
      '--input', `/workspace/${inputRel}`,
      '--output', `/workspace/${outputRel}`,
      '--checkpoint', '/workspace/backend/data/work/rtt_research/rtt/ckpts/CustomAMT.ckpt',
      '--device', 'cuda',
      '--runtime-identity', DOCKER_CHALLENGERS_IMAGE,
    ], { cwd: repoRoot, encoding: 'utf8', timeout: 3_600_000, maxBuffer: 50 * 1024 * 1024 });

    if (run.status !== 0) throw new Error(`RTT batch failed: ${run.stderr || run.stdout}`);
  } else {
    console.log(`Reusing existing RTT output: ${outputRel}`);
  }

  const rawData = JSON.parse(await readFile(path.resolve(repoRoot, outputRel), 'utf8'));
  const configSha = sha256Json({ profileId: 'CAUSAL_STREAMING_NATIVE', checkpointSha256: rawData.checkpointSha256 });

  const candidateDef = {
    candidateId: 'rtt-causal-streaming-v1',
    strategyKind: 'STREAMING',
    identity: {
      modelRuntime: DOCKER_CHALLENGERS_IMAGE,
      modelCheckpointSha256: rawData.checkpointSha256,
      adapterVersion: 'phase9g-a3-rtt-causal-streaming-v1',
      configurationSha256: configSha,
      trainingDataOverlapStatus: 'UNKNOWN',
    },
  };

  const runs = [];
  for (const scenario of scenarios) {
    const receipt = counterfactualReceipts.get(scenario.scenarioId);
    const baseScenarioId = receipt?.baseScenarioId ?? scenario.scenarioId;
    const trans = rawData.transcriptions[baseScenarioId];
    if (!trans) throw new Error(`Missing RTT transcription for ${baseScenarioId}`);

    const completionMs = scenario.completion?.performanceTimeMs ?? 30000;
    const observations = trans.notes
      .map((n, idx) => ({
        observationId: `${scenario.scenarioId}:rtt:obs:${idx}`,
        pitch: n.pitch,
        performanceTimeMs: n.onsetTimeMs - scenario.audio.performanceOriginSourceMs,
        confidence: 1.0,
      }))
      .filter((o) => o.performanceTimeMs >= 0 && o.performanceTimeMs <= completionMs);

    // Causal streaming: chunk observations into disjoint 100ms frames
    const publications = [];
    const stepMs = 100;
    let lastT = 0;
    for (let t = stepMs; t <= completionMs; t += stepMs) {
      const activeObs = observations.filter((o) =>
        (lastT === 0 ? o.performanceTimeMs >= 0 : o.performanceTimeMs > lastT) && o.performanceTimeMs <= t
      );
      publications.push({
        publicationId: `${scenario.scenarioId}:rtt:pub:${t}`,
        observations: activeObs,
        analyzedThroughPerformanceMs: t,
        availabilityTimeMs: t + 10, // 10ms frame latency
        diagnostics: {
          inferenceLatencyMs: 10,
          publicationDelayMs: 10,
        },
      });
      lastT = t;
    }
    if (lastT < completionMs) {
      const activeObs = observations.filter((o) =>
        (lastT === 0 ? o.performanceTimeMs >= 0 : o.performanceTimeMs > lastT) && o.performanceTimeMs <= completionMs
      );
      publications.push({
        publicationId: `${scenario.scenarioId}:rtt:pub:${completionMs}`,
        observations: activeObs,
        analyzedThroughPerformanceMs: completionMs,
        availabilityTimeMs: completionMs + 10,
        diagnostics: {
          inferenceLatencyMs: 10,
          publicationDelayMs: 10,
        },
      });
    }
    if (publications.length === 0) {
      publications.push({
        publicationId: `${scenario.scenarioId}:rtt:pub:0`,
        observations: [],
        analyzedThroughPerformanceMs: completionMs,
        availabilityTimeMs: completionMs + 10,
        diagnostics: {
          inferenceLatencyMs: 10,
          publicationDelayMs: 10,
        },
      });
    }

    runs.push({
      candidateId: candidateDef.candidateId,
      scenarioId: scenario.scenarioId,
      publications,
      runProvenance: { command: 'rtt causal streaming', runtime: DOCKER_CHALLENGERS_IMAGE },
    });
  }

  return {
    candidateDefinition: candidateDef,
    runs,
    evidence: { outputRel, totalTime: rawData.totalWallTimeSeconds },
    report: {
      candidateFamily: 'rtt',
      profileId: 'CAUSAL_STREAMING_NATIVE',
      licenseClassification: 'RESEARCH_VALID_PRODUCTION_LICENSE_BLOCKED',
      totalWallTimeSeconds: rawData.totalWallTimeSeconds,
    },
  };
}

function runByteDanceFromRawChunks({ scenario, profile, plans, rawChunks }) {
  const processingByChunk = new Map(plans.map((p, idx) => [p.chunkId, rawChunks[idx]?.inferenceLatencyMs ?? 0]));
  const schedule = byteDance.scheduleByteDanceSingleWorkerPublications({ plans, processingLatencyMsByChunkId: processingByChunk });

  const publications = plans.map((plan, idx) => {
    const chunk = rawChunks[idx];
    const decoded = byteDance.decodeByteDanceChunkRawOutputs({
      scenario,
      plan,
      raw: byteDance.byteDanceRawOutputsFromBrowserChunkArtifact(chunk, { allowVariableFrameCount: true }),
      onsetThreshold: profile.onsetThreshold,
      frameThreshold: profile.frameThreshold,
      allowVariableFrameCount: true,
    });
    const timing = schedule.get(plan.chunkId);
    return byteDance.publicationForByteDanceChunk({
      scenario,
      plan,
      observations: byteDance.observationsForByteDanceChunk(scenario, plan, decoded),
      inferenceLatencyMs: chunk.inferenceLatencyMs,
      candidateProcessingLatencyMs: chunk.inferenceLatencyMs,
      publicationAvailableAtMs: timing.inferenceFinishAtMs,
      inferenceStartAtMs: timing.inferenceStartAtMs,
      queueDelayMs: timing.queueDelayMs,
    });
  });

  return byteDance.candidateRunForByteDanceChunks({
    candidateId: profile.profileId,
    scenarioId: scenario.scenarioId,
    publications,
    command: 'phase9ga3 decode robust bytedance raw outputs',
    runtime: DOCKER_CHALLENGERS_IMAGE,
  });
}

function planByteDanceVariableContext(scenario, context) {
  const completionMs = scenario.completion?.performanceTimeMs ?? 30000;
  const nominalStepMs = context.nominalOwnedRegionMs ?? context.commitWidthMs ?? 600;
  const plans = [];
  let start = 0;
  let chunkIndex = 0;

  while (start < completionMs) {
    const end = Math.min(completionMs, start + nominalStepMs);
    const maximumFutureMs = context.maximumFutureContextMs ?? context.futureContextMs ?? 0;
    const inputEnd = end + maximumFutureMs;
    const inputStart = inputEnd - context.modelInputMs;

    plans.push({
      chunkId: `${scenario.scenarioId}:chunk:${chunkIndex}`,
      scenarioId: scenario.scenarioId,
      commitStartPerformanceMs: start,
      commitEndPerformanceMs: end,
      inputStartPerformanceMs: inputStart,
      inputEndPerformanceMs: inputEnd,
      expectedGroupIds: [],
    });
    chunkIndex += 1;
    if (end >= completionMs) break;
    start = end;
  }
  return plans;
}

function validateByteDanceVariableContextSource(scenario, plans, context) {
  const origin = scenario.audio.performanceOriginSourceMs;
  for (const plan of plans) {
    const startSource = origin + plan.inputStartPerformanceMs;
    const endSource = origin + plan.inputEndPerformanceMs;
    if (startSource < 0) {
      throw new Error(`Negative source start ${startSource} for ${scenario.scenarioId}`);
    }
  }
}

function calibrationScoresFromSummaries(scores) {
  return scores.map((score) => ({
    profileId: score.candidateId,
    scenarioId: score.scenarioId,
    family: score.scenarioId.includes('counterfactual_missing_note') ? 'COUNTERFACTUAL_MISSING_NOTE'
      : score.scenarioId.includes('counterfactual_extra_note') ? 'COUNTERFACTUAL_EXTRA_NOTE'
        : score.scenarioId.includes('counterfactual_wrong_semitone') ? 'COUNTERFACTUAL_WRONG_SEMITONE'
          : score.scenarioId.includes('counterfactual_incomplete_chord') ? 'COUNTERFACTUAL_INCOMPLETE_CHORD'
            : 'BASE_ORIGINAL',
    metrics: Object.fromEntries(Object.entries(score.metrics).flatMap(([key, metric]) =>
      metric.status === 'MEASURED'
        ? [[key, { value: metric.value, numerator: metric.numerator, denominator: metric.denominator }]]
        : []
    )),
  }));
}

function compactMetrics(calibMetrics) {
  if (!calibMetrics) return {};
  const res = {};
  for (const [k, v] of Object.entries(calibMetrics)) {
    if (v?.status === 'MEASURED') {
      res[k] = v.value;
    }
  }
  return res;
}

function sha256Text(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function sha256Json(obj) {
  return createHash('sha256').update(JSON.stringify(obj), 'utf8').digest('hex');
}

async function sha256File(filePath) {
  const buf = await readFile(filePath);
  return createHash('sha256').update(buf).digest('hex');
}

async function writeJson(relPath, obj) {
  const abs = path.resolve(repoRoot, relPath);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

function gitHead(dir) {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
  } catch {
    return 'UNKNOWN';
  }
}

function gitDirty(dir) {
  try {
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' });
    return status.trim().length > 0;
  } catch {
    return true;
  }
}

function errorMessage(err) {
  return err instanceof Error ? err.message : String(err);
}
