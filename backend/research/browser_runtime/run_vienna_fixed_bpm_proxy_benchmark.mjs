#!/usr/bin/env node
// Research-only Vienna 4x22 SECONDARY_HUMAN_FIXED_BPM_PROXY runner.
//
// This is intentionally dataset-specific: it constructs frozen fixed-BPM
// public-proxy scenarios before inference, runs the frozen ByteDance and
// Online-AMT candidates, then scores their canonical CandidateScenarioRun
// publications through the shared TypeScript bake-off scorer.

import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const VIENNA_METADATA_COMMIT = '1033ade0899bfd03a89f370c9ad5d8443ddccd3e';
const VIENNA_AUDIO_ZIP_URL = 'https://datasets.mdw.ac.at/media/content_files/8dec8d0a-c4da-4a96-b290-a3ba783c03ba.zip';
const VIENNA_AUDIO_ZIP_BYTES = 1_295_130_820;
const BYTE_DANCE_MODEL_SHA256 = '6ba3bc4e73607f9cd021e69858fd3ff969a3941c7a93876d5be5cedb53038cf5';
const BYTE_DANCE_MODEL_BYTES = 98_691_493;
const ONLINE_AMT_CHECKPOINT_SHA256 = '54ab4907b517dbfa2dbbee834db18d31d103ee25d690860595181162d235e3a0';
const ONLINE_AMT_CHECKPOINT_BYTES = 178_804_960;
const DEFAULT_MAX_SCENARIOS = 32;
const COUNTERFACTUAL_TARGET_PER_FAMILY = 12;
const COUNTERFACTUAL_MIN_EVIDENCE_PER_FAMILY = 8;
const DEFAULT_SCOPE_TARGET_MS = 4_000;
const DEFAULT_SCOPE_MIN_MS = 4_000;
const DEFAULT_SCOPE_MAX_MS = 12_000;
const DEFAULT_ASSIGNMENT_WINDOW_MS = 250;
const ONLINE_AMT_IMAGE = 'noteverse-online-amt-modern:phase9e-b1';
const BYTEDANCE_CANDIDATE_ID = 'bytedance-score-aware-chunked-dev-v1';
const ONLINE_AMT_CANDIDATE_ID = 'online-amt-stateful-modern-compat-dev-v1';

const args = parseArgs(process.argv);
const repoRoot = path.resolve(args['repo-root'] ?? process.cwd());
const workRootRel = args['work-root'] ?? 'backend/data/work/public_proxy/vienna-4x22';
const workRoot = path.resolve(repoRoot, workRootRel);
const outputDirRel = args['output-dir'] ?? 'backend/research/reports';
const outputDir = path.resolve(repoRoot, outputDirRel);
const manifestRel = args['scenario-manifest'] ?? 'backend/research/reports/vienna_fixed_bpm_proxy_final_scenarios_phase9fb3_2026-10-08.json';
const manifestPath = path.resolve(repoRoot, manifestRel);
const reportRel = args.output ?? 'backend/research/reports/vienna_fixed_bpm_proxy_final_comparison_phase9fb3_2026-10-08.json';
const reportPath = path.resolve(repoRoot, reportRel);
const maxScenarios = Number(args['max-scenarios'] ?? DEFAULT_MAX_SCENARIOS);
const includedPerformers = parseCsvSet(args.performers);
const scenarioSplit = args['scenario-split'] ?? 'DEVELOPMENT';
const implementationGitHead = gitHead(repoRoot);
const dirtyTreeAtExecution = gitDirty(repoRoot);
const require = createRequire(import.meta.url);
const { createJiti } = require(path.resolve(repoRoot, 'apps/customer-web/node_modules/jiti'));
const jiti = createJiti(import.meta.url);

const publicContract = jiti(path.resolve(repoRoot, 'apps/customer-web/src/lib/practice/research/public-fixed-bpm-benchmark.ts'));
const bakeoff = jiti(path.resolve(repoRoot, 'apps/customer-web/src/lib/practice/research/continuous-analyzer-bakeoff.ts'));
const byteDance = jiti(path.resolve(repoRoot, 'apps/customer-web/src/lib/practice/research/bytedance-score-aware-chunked.ts'));
const onlineAmt = jiti(path.resolve(repoRoot, 'apps/customer-web/src/lib/practice/research/online-amt-stateful-streaming.ts'));
const artifactDomain = jiti(path.resolve(repoRoot, 'apps/customer-web/src/lib/practice/local-core/artifact.ts'));
const continuousContract = jiti(path.resolve(repoRoot, 'apps/customer-web/src/lib/practice/local-core/continuous-expected-strikes.ts'));

await mkdir(outputDir, { recursive: true });
await mkdir(workRoot, { recursive: true });

const acquisition = await ensureViennaSources();
const scoreArtifacts = await ensureViennaPracticeScoreArtifacts(acquisition.metadataRoot);
const binding = await bindViennaSources();
const selectedPerformances = includedPerformers.size === 0
  ? binding.performances
  : binding.performances.filter((performance) => includedPerformers.has(performerIdForPerformance(performance.performanceId)));
const scenarioPool = [];
const skippedScopes = [];
for (const performance of selectedPerformances) {
  const built = await buildScenarioCandidates(performance, scoreArtifacts.get(performance.pieceId), 2);
  scenarioPool.push(...built.scenarios);
  skippedScopes.push(...built.skipped);
}
const selectedScenarioItems = selectStratifiedScenarios(scenarioPool, maxScenarios);
const counterfactualItems = buildCounterfactualScenarioItems(selectedScenarioItems, scoreArtifacts);
const scenarioItems = [...selectedScenarioItems, ...counterfactualItems];
const scenarios = scenarioItems.map((item) => item.scenario);
const scenarioReceipts = scenarioItems.map((item) => item.receipt);
const baseScenarios = selectedScenarioItems.map((item) => item.scenario);
const baseScenarioReceipts = selectedScenarioItems.map((item) => item.receipt);
const counterfactualReceipts = counterfactualItems.map((item) => item.receipt);
const scenarioFamilies = [...new Set(scenarios.flatMap((scenario) => scenario.familyTags)
  .filter((tag) => tag === 'BASE_ORIGINAL' || tag.startsWith('COUNTERFACTUAL_')))];

const publicManifest = {
  schemaVersion: 1,
  manifestId: 'phase9f-b3-vienna-secondary-human-fixed-bpm-proxy-v1',
  layer: 'SECONDARY_HUMAN_FIXED_BPM_PROXY',
  dataset: {
    datasetId: 'vienna-4x22',
    datasetVersion: VIENNA_METADATA_COMMIT,
    sourceUrl: VIENNA_AUDIO_ZIP_URL,
    license: 'CC BY 4.0',
    role: 'SECONDARY_HUMAN_FIXED_BPM_PROXY',
    trainingOverlapStatus: 'UNKNOWN',
  },
  scenarioFamilies,
  scenarioIds: scenarios.map((scenario) => scenario.scenarioId),
  scenarioManifestFrozenBeforeInference: true,
  frozenAt: new Date().toISOString(),
  candidateOutputIncluded: false,
  officialProductEvaluation: false,
};
if (scenarios.length === 0) {
  await writeFile(reportPath, `${JSON.stringify({
    schemaVersion: 1,
    artifact: 'phase9f_b3_vienna_secondary_blocked_before_inference',
    implementationGitHead,
    acquisition,
    bindingSummary: {
      audioCount: binding.audioCount,
      midiCount: binding.midiCount,
      matchCount: binding.matchCount,
      intersectionCount: binding.intersectionCount,
    },
    skippedScopes: skippedScopes.slice(0, 100),
  }, null, 2)}\n`);
  throw new Error(`No Vienna scopes passed pre-model eligibility; wrote ${normalizeRel(repoRoot, reportPath)}.`);
}
publicContract.validatePublicScenarioManifest(publicManifest);
const manifestSha256 = publicContract.canonicalPublicScenarioManifestSha256(publicManifest);

await writeFile(manifestPath, `${JSON.stringify({
  schemaVersion: 1,
  artifact: 'phase9f_b3_vienna_secondary_final_scenarios',
  implementationGitHead,
  scenarioManifestFrozenBeforeInference: true,
  publicManifest,
  publicManifestSha256: manifestSha256,
  metadataCommit: VIENNA_METADATA_COMMIT,
  audioZip: acquisition.audioZip,
    intersectionCount: binding.intersectionCount,
    filteredPerformanceCount: selectedPerformances.length,
    includedPerformers: [...includedPerformers].sort(),
    scenarioReceipts,
  counterfactualReceipts,
  practiceScoreArtifacts: [...scoreArtifacts.values()].map((item) => item.receipt),
  scenarios,
}, null, 2)}\n`);

const runs = [];
const runReceipts = [];
const failures = [];
const byteDanceDefinition = byteDance.bytedanceCandidateDefinition({ gitHead: implementationGitHead, trainingDataOverlapStatus: 'UNKNOWN' });
const onlineAmtDefinition = onlineAmt.onlineAmtCandidateDefinition({ gitHead: implementationGitHead, trainingDataOverlapStatus: 'UNKNOWN' });

for (const scenario of baseScenarios) {
  try {
    const run = await runByteDanceScenario(scenario);
    runs.push(run);
    runReceipts.push(candidateRunReceipt({ scenario, run, mode: 'REAL_RUN', scenarioManifestSha256: manifestSha256, runtime: 'real-ort-web-wasm-vienna-public-proxy' }));
  } catch (error) {
    failures.push({ candidateId: BYTEDANCE_CANDIDATE_ID, scenarioId: scenario.scenarioId, error: errorMessage(error) });
  }
  try {
    const run = await runOnlineAmtScenario(scenario);
    runs.push(run);
    runReceipts.push(candidateRunReceipt({ scenario, run, mode: 'REAL_RUN', scenarioManifestSha256: manifestSha256, runtime: 'real-online-amt-modern-docker-vienna-public-proxy' }));
  } catch (error) {
    failures.push({ candidateId: ONLINE_AMT_CANDIDATE_ID, scenarioId: scenario.scenarioId, error: errorMessage(error) });
  }
}
const baseRunByScenarioAndCandidate = new Map(runs.map((run) => [`${run.scenarioId}|${run.candidateId}`, run]));
for (const item of counterfactualItems) {
  for (const candidateId of [BYTEDANCE_CANDIDATE_ID, ONLINE_AMT_CANDIDATE_ID]) {
    if (item.receipt.acousticEvidenceReuse.status !== 'ACOUSTIC_EVIDENCE_REUSED_IDENTICAL_INPUT') {
      failures.push({
        candidateId,
        scenarioId: item.scenario.scenarioId,
        error: `Acoustic evidence reuse rejected: ${JSON.stringify(item.receipt.acousticEvidenceReuse)}`,
      });
      continue;
    }
    const baseRun = baseRunByScenarioAndCandidate.get(`${item.receipt.baseScenarioId}|${candidateId}`);
    if (!baseRun) {
      failures.push({ candidateId, scenarioId: item.scenario.scenarioId, error: 'Missing base run for acoustic evidence reuse.' });
      continue;
    }
    const run = reuseCandidateRunForCounterfactual(baseRun, item.scenario);
    runs.push(run);
    runReceipts.push(candidateRunReceipt({
      scenario: item.scenario,
      run,
      mode: 'REUSED_IDENTICAL_ACOUSTIC_EVIDENCE',
      scenarioManifestSha256: manifestSha256,
      runtime: candidateId === BYTEDANCE_CANDIDATE_ID
        ? 'real-ort-web-wasm-vienna-public-proxy'
        : 'real-online-amt-modern-docker-vienna-public-proxy',
    }));
  }
}

const diagnosticReport = publicContract.buildPublicDiagnosticBakeoffReport({
  scenarios,
  candidates: [byteDanceDefinition, onlineAmtDefinition],
  runs,
});
const familyTagsByScenario = new Map(scenarios.map((scenario) => [scenario.scenarioId, scenario.familyTags]));
const baseScores = diagnosticReport.scores.filter((score) =>
  score.scenarioSplit === 'DEVELOPMENT' && (familyTagsByScenario.get(score.scenarioId) ?? []).includes('BASE_ORIGINAL')
);
const headline = diagnosticReport.aggregateMetrics;
const paired = publicContract.buildPublicPairedComparison({ scores: baseScores });
const familyComparisons = buildFamilyComparisons(diagnosticReport.scores, familyTagsByScenario);
const secondaryResult = publicContract.decideSecondaryHumanFixedBpmProxy({ base: paired, families: familyComparisons });
const report = {
  schemaVersion: 1,
  artifact: 'phase9f_b3_vienna_secondary_final_comparison',
  generatedAt: new Date().toISOString(),
  implementationGitHead,
  artifactGeneratedFromGitHead: gitHead(repoRoot),
  dirtyTreeAtExecution,
  artifactCommitRelationship: 'artifactCommitSha is the later commit containing this generated compact artifact',
  normalizedCommand: [
    'node backend/research/browser_runtime/run_vienna_fixed_bpm_proxy_benchmark.mjs',
    '--repo-root .',
    `--work-root ${workRootRel}`,
    `--max-scenarios ${maxScenarios}`,
    includedPerformers.size > 0 ? `--performers ${[...includedPerformers].sort().join(',')}` : null,
    scenarioSplit !== 'DEVELOPMENT' ? `--scenario-split ${scenarioSplit}` : null,
    `--scenario-manifest ${manifestRel}`,
    `--output ${reportRel}`,
  ].filter(Boolean).join(' '),
  runtimeEnvironment: {
    os: `${os.type()} ${os.release()} ${os.arch()}`,
    node: process.version,
    dockerImage: ONLINE_AMT_IMAGE,
  },
  vienna: {
    metadataCommit: VIENNA_METADATA_COMMIT,
    officialAudioZipUrl: VIENNA_AUDIO_ZIP_URL,
    audioZip: acquisition.audioZip,
    extractedAudioCount: binding.audioCount,
    midiCount: binding.midiCount,
    matchCount: binding.matchCount,
    audioMidiMatchIntersectionCount: binding.intersectionCount,
    filteredPerformanceCount: selectedPerformances.length,
    includedPerformers: [...includedPerformers].sort(),
    changesMdSha256: acquisition.changesMdSha256,
    provenance: 'DATASET_PROVIDED_AUDIO_MIDI_ALIGNMENT',
    invalidatedPriorResult: {
      artifact: 'phase9f_b1_vienna_fixed_bpm_proxy_real_comparison',
      previousResult: 'BYTE_DANCE_BETTER',
      correctedStatus: 'INVALIDATED_BENCHMARK_TRUTH_CONSTRUCTION',
      reason: '9F-B.1 used matched .match anchors for both expected score pitch and physical attacks; 9F-B.2 uses PracticeScoreArtifact/product resolver for expected truth and full performance MIDI for physical truth.',
    },
    preliminaryBaseOnlyResult: {
      artifact: 'vienna_fixed_bpm_proxy_corrected_comparison_phase9fb2_2026-10-08.json',
      previousResult: 'BYTE_DANCE_BETTER',
      correctedStatus: 'PRELIMINARY_BASE_ONLY_RESULT',
      reason: '9F-B.2 BASE metrics are descriptive and valid, but the final decision requires fixed bootstrap statistics plus counterfactual safety families.',
    },
  },
  frozenScenarioManifest: {
    path: normalizeRel(repoRoot, manifestPath),
    sha256: await sha256File(manifestPath),
    publicManifestSha256: manifestSha256,
    frozenBeforeInference: true,
    scenarioCount: scenarios.length,
  },
  scopeGeneration: {
    consideredPerformanceCount: binding.intersectionCount,
    rawScoreDefinedScopeAttemptCount: scenarioPool.length + skippedScopes.length,
    consideredScopeCount: scenarioPool.length + skippedScopes.length,
    baseScenarioCount: baseScenarios.length,
    scopeCountDefinitions: {
      consideredScopeCount: 'raw score-defined RANGE scope attempts before the pre-model gate',
      candidateScopeCountByPiece: 'raw score-defined RANGE scope attempts grouped by Vienna piece',
      eligibleBasePoolCountByPiece: 'BASE_ORIGINAL scopes that passed the frozen pre-model ground-truth and context gates',
      selectedScenariosByPiece: 'BASE_ORIGINAL scopes selected for paired model execution',
    },
    candidateScopeCountByPiece: countBy([...scenarioPool.map((item) => item.receipt), ...skippedScopes], (item) => item.pieceId ?? pieceIdForPerformance(item.performanceId ?? '')),
    eligibleBasePoolCountByPiece: countBy(scenarioPool.map((item) => item.receipt), (item) => item.pieceId),
    skippedScopeCount: skippedScopes.length,
    targetScopeMs: DEFAULT_SCOPE_TARGET_MS,
    minScopeMs: DEFAULT_SCOPE_MIN_MS,
    maxScopeMs: DEFAULT_SCOPE_MAX_MS,
    preModelGate: {
      groundTruthExpectedStrikeMatchRateAtLeast: 0.95,
      absoluteTimingResidualP95AtMostMs: 125,
    },
    bpmDistribution: distribution(baseScenarioReceipts.map((item) => item.configuredIntegerBpm)),
    residualP95DistributionMs: distribution(baseScenarioReceipts.map((item) => item.absoluteResidualP95Ms)),
    ledgerGroundTruthMatchRateDistribution: distribution(baseScenarioReceipts.map((item) => item.ledgerGroundTruthExpectedStrikeMatchRate)),
    realScoreMissingNoteCount: baseScenarioReceipts.reduce((sum, item) => sum + item.groundTruthMissingCount, 0),
    realPhysicalExtraCount: baseScenarioReceipts.reduce((sum, item) => sum + item.groundTruthExtraCount, 0),
    selectedScenariosByPiece: countBy(baseScenarioReceipts, (item) => item.pieceId),
    uniquePerformerCount: new Set(baseScenarioReceipts.map((item) => performerIdForPerformance(item.performanceId))).size,
    uniquePerformanceCount: new Set(baseScenarioReceipts.map((item) => item.performanceId)).size,
    uniquePieceCount: new Set(baseScenarioReceipts.map((item) => item.pieceId)).size,
  },
  counterfactuals: {
    mutationManifestSha256: sha256Text(canonicalJson(counterfactualReceipts.map((receipt) => receipt.mutation))),
    countsByFamily: countBy(counterfactualReceipts, (item) => item.family),
    pieceCountsByFamily: Object.fromEntries([...new Set(counterfactualReceipts.map((item) => item.family))].map((family) => [
      family,
      new Set(counterfactualReceipts.filter((item) => item.family === family).map((item) => item.pieceId)).size,
    ])),
    performanceCountsByFamily: Object.fromEntries([...new Set(counterfactualReceipts.map((item) => item.family))].map((family) => [
      family,
      new Set(counterfactualReceipts.filter((item) => item.family === family).map((item) => item.performanceId)).size,
    ])),
    receipts: counterfactualReceipts,
  },
  candidateRuns: {
    byteDanceRealRunCount: runs.filter((run) => run.candidateId === BYTEDANCE_CANDIDATE_ID).length,
    onlineAmtRealRunCount: runs.filter((run) => run.candidateId === ONLINE_AMT_CANDIDATE_ID).length,
    realRunCount: runReceipts.filter((receipt) => receipt.inferenceMode === 'REAL_RUN').length,
    reusedIdenticalAcousticEvidenceCount: runReceipts.filter((receipt) => receipt.inferenceMode === 'REUSED_IDENTICAL_ACOUSTIC_EVIDENCE').length,
    receipts: runReceipts,
    failures,
  },
  metrics: headline,
  pairedComparison: paired,
  familyPairedComparisons: familyComparisons,
  SECONDARY_HUMAN_FIXED_BPM_PROXY_RESULT: secondaryResult,
  overallPublicEvidenceConclusion: secondaryResult === 'NO_CLEAR_WINNER'
    ? 'NO_CLEAR_WINNER_ON_PUBLIC_FIXED_BPM_PROXY'
    : 'PREFERRED_ON_SECONDARY_HUMAN_PROXY',
  diagnosticBakeoffReport: compactBakeoffReport(diagnosticReport),
  confirmations: {
    byteDanceNotTuned: true,
    onlineAmtNotTuned: true,
    bpmNotFitFromCandidateOutput: true,
    scopeSelectionNotCandidateDriven: true,
    publicProxyNotOfficialEvaluation: true,
    officialProductRankRemainsNull: true,
    productionMicrophoneEnabled: false,
    calibrationUsed: false,
    evaluationUsed: false,
    expectedTruthSource: 'PracticeScoreArtifact + CUSTOM_FIXED_BPM + PracticeScope RANGE + resolveContinuousPracticeContract',
    physicalTruthSource: 'Full Vienna performance MIDI NoteOn events',
    alignmentSource: 'Vienna .match files for fitting/alignment only',
  },
};

await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(normalizeRel(repoRoot, reportPath));

async function ensureViennaSources() {
  const metadataRoot = path.join(workRoot, 'vienna4x22-metadata');
  const audioZip = path.join(workRoot, 'audio.zip');
  const audioExtracted = path.join(workRoot, 'audio-extracted');
  if (!existsSync(metadataRoot)) {
    const clone = spawnSync('git', ['clone', 'https://github.com/CPJKU/vienna4x22.git', metadataRoot], { encoding: 'utf8', timeout: 300_000 });
    if (clone.status !== 0) throw new Error(`Vienna metadata clone failed: ${clone.stderr || clone.stdout}`);
  }
  const checkout = spawnSync('git', ['-C', metadataRoot, 'checkout', VIENNA_METADATA_COMMIT], { encoding: 'utf8', timeout: 120_000 });
  if (checkout.status !== 0) throw new Error(`Vienna metadata checkout failed: ${checkout.stderr || checkout.stdout}`);
  const actualCommit = gitHead(metadataRoot);
  if (actualCommit !== VIENNA_METADATA_COMMIT) throw new Error(`Vienna metadata commit mismatch: ${actualCommit}`);

  if (!existsSync(audioZip) || statSync(audioZip).size !== VIENNA_AUDIO_ZIP_BYTES) {
    const download = spawnSync('curl', [
      '--http1.1',
      '-L',
      '--fail',
      '--retry',
      '5',
      '--retry-delay',
      '5',
      '--continue-at',
      '-',
      '-o',
      audioZip,
      VIENNA_AUDIO_ZIP_URL,
    ], { encoding: 'utf8', timeout: 3_600_000 });
    if (download.status !== 0) throw new Error(`Vienna audio download failed: ${download.stderr || download.stdout}`);
  }
  const zipBytes = statSync(audioZip).size;
  if (zipBytes !== VIENNA_AUDIO_ZIP_BYTES) throw new Error(`Vienna audio ZIP byte count mismatch: ${zipBytes}`);
  if (!existsSync(audioExtracted) || countFilesWithExtension(audioExtracted, '.wav') === 0) {
    await mkdir(audioExtracted, { recursive: true });
    const extract = spawnSync('tar', ['-xf', audioZip, '-C', audioExtracted], { encoding: 'utf8', timeout: 1_800_000 });
    if (extract.status !== 0) throw new Error(`Vienna audio extraction failed: ${extract.stderr || extract.stdout}`);
  }
  return {
    metadataRoot: normalizeRel(repoRoot, metadataRoot),
    audioExtracted: normalizeRel(repoRoot, audioExtracted),
    audioZip: {
      path: normalizeRel(repoRoot, audioZip),
      bytes: zipBytes,
      expectedBytes: VIENNA_AUDIO_ZIP_BYTES,
      sha256: await sha256File(audioZip),
      sha256Authority: 'LOCALLY_MEASURED_PROVENANCE',
    },
    changesMdSha256: await sha256File(path.join(metadataRoot, 'CHANGES.md')),
  };
}

async function ensureViennaPracticeScoreArtifacts(metadataRootRel) {
  const metadataRoot = path.resolve(repoRoot, metadataRootRel);
  const outputDir = path.join(workRoot, 'practice-score-artifacts');
  const receiptPath = path.join(outputDir, 'receipt.json');
  const result = spawnSync('docker', [
    'run',
    '--rm',
    '--entrypoint',
    'python',
    '-e',
    'PYTHONPATH=/workspace/backend',
    '-v',
    `${repoRoot}:/workspace`,
    '-w',
    '/workspace',
    'noteverse-backend-practice:dev',
    'backend/research/vienna/generate_vienna_practice_artifacts.py',
    '--musicxml-root',
    normalizeRel(repoRoot, path.join(metadataRoot, 'musicxml')),
    '--output-dir',
    normalizeRel(repoRoot, outputDir),
    '--metadata-commit',
    VIENNA_METADATA_COMMIT,
    '--receipt',
    normalizeRel(repoRoot, receiptPath),
  ], { cwd: repoRoot, encoding: 'utf8', timeout: 300_000 });
  if (result.status !== 0) throw new Error(`Vienna PracticeScoreArtifact generation failed: ${result.stderr || result.stdout}`);
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  const artifacts = new Map();
  for (const piece of receipt.pieces) {
    const artifactPath = path.resolve(repoRoot, piece.practiceScoreArtifactPath);
    const artifact = JSON.parse(await readFile(artifactPath, 'utf8'));
    artifactDomain.assertPracticeScoreArtifact(artifact);
    artifacts.set(piece.pieceId, {
      artifact,
      receipt: {
        ...piece,
        musicXmlPath: normalizeRel(repoRoot, path.resolve(piece.musicXmlPath)),
        practiceScoreArtifactPath: normalizeRel(repoRoot, artifactPath),
      },
    });
  }
  return artifacts;
}

async function bindViennaSources() {
  const metadataRoot = path.join(workRoot, 'vienna4x22-metadata');
  const audioRoot = path.join(workRoot, 'audio-extracted', 'audio');
  const audio = mapFilesByBasename(audioRoot, '.wav', (file) => !file.includes('special') && !path.basename(file).includes('average'));
  const midi = mapFilesByBasename(path.join(metadataRoot, 'midi'), '.mid', (file) => !path.basename(file).includes('average'));
  const match = mapFilesByBasename(path.join(metadataRoot, 'match'), '.match');
  const musicXml = mapFilesByBasename(path.join(metadataRoot, 'musicxml'), '.musicxml');
  const ids = [...audio.keys()].filter((id) => midi.has(id) && match.has(id)).sort();
  return {
    audioCount: audio.size,
    midiCount: midi.size,
    matchCount: match.size,
    intersectionCount: ids.length,
    performances: ids.map((id) => ({
      performanceId: id,
      audioPath: audio.get(id),
      midiPath: midi.get(id),
      matchPath: match.get(id),
      musicXmlPath: musicXml.get(pieceIdForPerformance(id)),
      pieceId: pieceIdForPerformance(id),
    })).filter((item) => item.musicXmlPath),
  };
}

async function buildScenarioCandidates(performance, scoreArtifactEntry, limit) {
  if (!scoreArtifactEntry) throw new Error(`Missing PracticeScoreArtifact for ${performance.pieceId}`);
  const artifact = scoreArtifactEntry.artifact;
  const match = await parseMatchFile(performance.matchPath);
  const midi = parseMidiNoteOns(await readFile(performance.midiPath));
  const wav = byteDance.decodeResearchWavToMonoFloat32(await readFile(performance.audioPath));
  const hashes = {
    audio: await sha256File(performance.audioPath),
    midi: await sha256File(performance.midiPath),
    match: await sha256File(performance.matchPath),
    musicXml: await sha256File(performance.musicXmlPath),
  };
  const anchorsByScoreNoteId = new Map(match.anchors.map((anchor) => [anchor.scoreNoteId, anchor]));
  verifyMatchMidiConsistency(match.anchors, midi.noteOns, performance.performanceId);
  const scoreGroups = artifact.expectedPracticeGroups.filter((group) => group.onsetBeat >= 0);
  const scenarios = [];
  const skipped = [];
  for (let startIndex = 0; startIndex < scoreGroups.length && scenarios.length < limit; startIndex += 12) {
    let endIndex = startIndex;
    let candidateGroups = scoreGroups.slice(startIndex, endIndex + 1);
    let candidateAnchors = anchorsForGroups(candidateGroups, anchorsByScoreNoteId);
    let fit = fitLocalBpm(candidateAnchors);
    let configuredIntegerBpm = Number.isFinite(fit.rawFittedBpm) ? safeProductIntegerBpm(fit.rawFittedBpm) : null;
    let contract = null;
    while (endIndex + 1 < scoreGroups.length) {
      candidateGroups = scoreGroups.slice(startIndex, endIndex + 1);
      candidateAnchors = anchorsForGroups(candidateGroups, anchorsByScoreNoteId);
      fit = fitLocalBpm(candidateAnchors);
      configuredIntegerBpm = Number.isFinite(fit.rawFittedBpm) ? safeProductIntegerBpm(fit.rawFittedBpm) : null;
      if (configuredIntegerBpm !== null) {
        const scope = {
          kind: 'RANGE',
          startGroupId: candidateGroups[0].groupId,
          endGroupId: candidateGroups.at(-1).groupId,
        };
        contract = continuousContract.resolveContinuousPracticeContract({
          artifact,
          tempoSelection: { mode: 'CUSTOM_FIXED_BPM', bpm: configuredIntegerBpm },
          scope,
        });
        if (contract.naturalTerminalPerformanceTimeMs >= DEFAULT_SCOPE_TARGET_MS) break;
      }
      endIndex += 1;
    }
    if (!contract || configuredIntegerBpm === null) {
      skipped.push({ performanceId: performance.performanceId, reason: 'NO_PRODUCT_BPM_OR_CONTRACT' });
      continue;
    }
    const sourceSpan = candidateAnchors.length > 0
      ? Math.max(...candidateAnchors.map((anchor) => anchor.performedMs)) - Math.min(...candidateAnchors.map((anchor) => anchor.performedMs))
      : 0;
    if (
      contract.naturalTerminalPerformanceTimeMs < DEFAULT_SCOPE_MIN_MS
      || contract.naturalTerminalPerformanceTimeMs > DEFAULT_SCOPE_MAX_MS
    ) {
      skipped.push({ performanceId: performance.performanceId, reason: 'SCOPE_DURATION_OUTSIDE_TARGET', sourceSpan, productDurationMs: contract.naturalTerminalPerformanceTimeMs });
      continue;
    }
    try {
      publicContract.productIntegerBpm(fit.rawFittedBpm);
    } catch (error) {
      skipped.push({ performanceId: performance.performanceId, reason: 'BPM_OUTSIDE_PRODUCT_RANGE', rawFittedBpm: fit.rawFittedBpm, error: errorMessage(error) });
      continue;
    }
    const startBeat = contract.scopeStartBeat;
    const performanceOriginSourceMs = median(candidateAnchors.map((anchor) =>
      anchor.performedMs - (anchor.scoreBeat - startBeat) * fit.msPerBeat
    ));
    const completion = contract.naturalTerminalPerformanceTimeMs;
    const expectedStrikes = contract.expectedStrikes;
    const physicalAttacks = midi.noteOns.map((note) => ({
      physicalEventId: `${performance.performanceId}:midi-track-${note.trackIndex}-event-${note.eventIndex}`,
      pitch: midiPitchName(note.midi),
      performanceTimeMs: note.onsetMs - performanceOriginSourceMs,
      velocity: note.velocity,
    })).filter((attack) => attack.performanceTimeMs >= 0 && attack.performanceTimeMs <= completion);
    const residuals = candidateAnchors.map((anchor) => Math.abs(
      (anchor.performedMs - performanceOriginSourceMs)
      - (anchor.scoreBeat - startBeat) * (60_000 / configuredIntegerBpm)
    ));
    const diagnostics = {
      method: 'MEDIAN_LOCAL_MS_PER_QUARTER',
      rawFittedBpm: fit.rawFittedBpm,
      configuredIntegerBpm,
      alignmentAnchorCount: candidateAnchors.length,
      absoluteResidualP95Ms: percentile(residuals, 0.95),
      groundTruthExpectedStrikeMatchRate: 0,
    };
    const scenario = {
      schemaVersion: 1,
      scenarioId: `vienna-secondary-base:${performance.performanceId}:${startBeat.toFixed(3)}`,
      split: scenarioSplit,
      familyTags: ['BASE_ORIGINAL', 'SECONDARY_HUMAN_FIXED_BPM_PROXY'],
      source: {
        sourceAudioPath: normalizeRel(repoRoot, performance.audioPath),
        sourceAudioSha256: hashes.audio,
        sourceMidiPath: normalizeRel(repoRoot, performance.midiPath),
        sourceMidiSha256: hashes.midi,
        provenance: 'Vienna 4x22 DATASET_PROVIDED_AUDIO_MIDI_ALIGNMENT',
      },
      audio: {
        nativeSampleRateHz: wav.sampleRateHz,
        channelPolicy: 'average_channels_to_mono_float32',
        clipStartMs: 0,
        clipEndMs: wav.durationMs,
        performanceOriginSourceMs,
        sourceDurationMs: wav.durationMs,
        pcmIdentity: `vienna:${hashes.audio}`,
      },
      expectedStrikes,
      physicalGroundTruth: {
        status: 'RECORDED',
        sourceKind: 'PAIRED_PHYSICAL_MIDI',
        source: 'Vienna 4x22 shifted performance MIDI/match alignment',
        attacks: physicalAttacks,
      },
      completion: { kind: 'NATURAL', performanceTimeMs: completion },
      taxonomy: {
        groups: Object.fromEntries([...new Set(expectedStrikes.map((strike) => strike.groupId))].map((groupId) => [groupId, ['BASE_ORIGINAL']])),
      },
      corpusOverlapStatus: 'UNKNOWN',
    };
    const groundTruthScore = scoreGroundTruthEvaluation(scenario);
    diagnostics.groundTruthExpectedStrikeMatchRate = groundTruthScore.matchRate;
    try {
      publicContract.validateSecondaryViennaFit(diagnostics);
    } catch (error) {
      skipped.push({ performanceId: performance.performanceId, reason: 'PRE_MODEL_FIT_GATE_FAILED', diagnostics, error: errorMessage(error) });
      continue;
    }
    try {
      bakeoff.validateBenchmarkScenario(scenario);
      const plans = byteDance.planByteDanceScoreAwareChunks(scenario);
      byteDance.validateByteDanceSourceContext(scenario, plans);
      const onlineRequirement = onlineAmt.onlineAmtSegmentTailRequirement(performanceOwnedSamplesAtOrBefore(completion));
      const onlineRequiredEndMs = performanceOriginSourceMs + completion + onlineRequirement.requiredContextTailSamples / 16_000 * 1000;
      if (onlineRequiredEndMs > wav.durationMs) throw new Error('Online-AMT requires unavailable context tail.');
    } catch (error) {
      skipped.push({ performanceId: performance.performanceId, reason: 'CANDIDATE_CONTEXT_OR_SCENARIO_INVALID', error: errorMessage(error) });
      continue;
    }
    scenarios.push({
      scenario,
      receipt: {
        scenarioId: scenario.scenarioId,
        performanceId: performance.performanceId,
        pieceId: performance.pieceId,
        audioSha256: hashes.audio,
        midiSha256: hashes.midi,
        matchSha256: hashes.match,
        musicXmlSha256: hashes.musicXml,
        practiceScoreArtifactPath: scoreArtifactEntry.receipt.practiceScoreArtifactPath,
        practiceScoreArtifactSha256: scoreArtifactEntry.receipt.practiceScoreArtifactSha256,
        artifactId: scoreArtifactEntry.receipt.artifactId,
        matchPath: normalizeRel(repoRoot, performance.matchPath),
        musicXmlPath: normalizeRel(repoRoot, performance.musicXmlPath),
        scopeStartBeat: startBeat,
        scopeEndBeat: contract.scopeTerminalBeat,
        practiceScope: { kind: 'RANGE', startGroupId: candidateGroups[0].groupId, endGroupId: candidateGroups.at(-1).groupId },
        performanceOriginSourceMs,
        rawFittedBpm: fit.rawFittedBpm,
        configuredIntegerBpm,
        absoluteResidualP95Ms: diagnostics.absoluteResidualP95Ms,
        ledgerGroundTruthExpectedStrikeMatchRate: diagnostics.groundTruthExpectedStrikeMatchRate,
        groundTruthMissingCount: groundTruthScore.missingCount,
        groundTruthExtraCount: groundTruthScore.extraCount,
        expectedStrikeCount: expectedStrikes.length,
        physicalMidiAttackCount: physicalAttacks.length,
        truthIndependence: {
          expectedTruthSource: 'PracticeScoreArtifact + CUSTOM_FIXED_BPM + PracticeScope RANGE',
          physicalTruthSource: 'Vienna performance MIDI full NoteOn set',
          alignmentSource: 'Vienna .match score/performance anchors',
          audioSource: 'Vienna WAV',
        },
      },
    });
  }
  return { scenarios, skipped };
}

function buildCounterfactualScenarioItems(baseItems, scoreArtifacts) {
  const families = [
    'COUNTERFACTUAL_MISSING_NOTE',
    'COUNTERFACTUAL_EXTRA_NOTE',
    'COUNTERFACTUAL_WRONG_SEMITONE',
    'COUNTERFACTUAL_INCOMPLETE_CHORD',
  ];
  const selected = [];
  for (const family of families) {
    const candidates = [];
    for (const item of baseItems) {
      try {
        const scoreArtifactEntry = scoreArtifacts.get(item.receipt.pieceId);
        const candidate = buildCounterfactualScenarioItem(item, scoreArtifactEntry, family);
        if (candidate) candidates.push(candidate);
      } catch {
        // Counterfactual eligibility is best-effort and deterministic; invalid mutations are skipped.
      }
    }
    selected.push(...selectBalancedCounterfactuals(candidates, COUNTERFACTUAL_TARGET_PER_FAMILY));
  }
  return selected;
}

function buildCounterfactualScenarioItem(baseItem, scoreArtifactEntry, family) {
  if (!scoreArtifactEntry) return null;
  const baseScenario = baseItem.scenario;
  const baseReceipt = baseItem.receipt;
  const baseArtifact = scoreArtifactEntry.artifact;
  const derived = cloneJson(baseArtifact);
  const scopeGroupIds = groupIdsInScope(baseArtifact, baseReceipt.practiceScope);
  const mutation = mutateArtifactForFamily({
    artifact: derived,
    baseScenario,
    scopeGroupIds,
    family,
  });
  if (!mutation) return null;
  const mutationContentSha256 = sha256Text(canonicalJson(counterfactualMutationProjection({
    basePracticeScoreArtifactSha256: baseReceipt.practiceScoreArtifactSha256,
    family,
    practiceScope: baseReceipt.practiceScope,
    mutation,
    artifact: derived,
  })));
  derived.artifactId = `practice-score-artifact:vienna-cf:${mutationContentSha256.slice(0, 16)}`;
  derived.revisionId = `vienna-counterfactual:${family}:${mutationContentSha256.slice(0, 16)}`;
  artifactDomain.assertPracticeScoreArtifact(derived);
  const finalDerivedPracticeScoreArtifactSha256 = sha256Text(canonicalJson(derived));
  const contract = continuousContract.resolveContinuousPracticeContract({
    artifact: derived,
    tempoSelection: { mode: 'CUSTOM_FIXED_BPM', bpm: baseReceipt.configuredIntegerBpm },
    scope: baseReceipt.practiceScope,
  });
  if (Math.abs(contract.naturalTerminalPerformanceTimeMs - baseScenario.completion.performanceTimeMs) > 1e-9) {
    return null;
  }
  const scenarioId = baseScenario.scenarioId.replace('vienna-secondary-base:', `vienna-secondary-${family.toLowerCase()}:`);
  const scenario = {
    ...baseScenario,
    scenarioId,
    familyTags: [family, 'SECONDARY_HUMAN_FIXED_BPM_PROXY'],
    expectedStrikes: contract.expectedStrikes,
    taxonomy: {
      groups: Object.fromEntries([...new Set(contract.expectedStrikes.map((strike) => strike.groupId))].map((groupId) => [groupId, [family]])),
    },
  };
  publicContract.assertCounterfactualPreservesAudioAndMidi({ base: baseScenario, mutated: scenario });
  bakeoff.validateBenchmarkScenario(scenario);
  const groundTruthScore = scoreGroundTruthEvaluation(scenario);
  return {
    scenario,
    receipt: {
      ...baseReceipt,
      scenarioId,
      baseScenarioId: baseScenario.scenarioId,
      family,
      practiceScoreArtifactSha256: finalDerivedPracticeScoreArtifactSha256,
      basePracticeScoreArtifactSha256: baseReceipt.practiceScoreArtifactSha256,
      mutationContentSha256,
      finalDerivedPracticeScoreArtifactSha256,
      expectedStrikeCount: contract.expectedStrikes.length,
      groundTruthMissingCount: groundTruthScore.missingCount,
      groundTruthExtraCount: groundTruthScore.extraCount,
      ledgerGroundTruthExpectedStrikeMatchRate: groundTruthScore.matchRate,
      mutation: {
        family,
        operation: mutation.operation,
        baseScenarioId: baseScenario.scenarioId,
        baseScoreArtifactSha256: baseReceipt.practiceScoreArtifactSha256,
        mutationContentSha256,
        finalDerivedPracticeScoreArtifactSha256,
        targetGroupId: mutation.groupId,
        targetPitch: mutation.targetPitch,
        addedPitch: mutation.addedPitch,
        removedPitch: mutation.removedPitch,
        shiftedFromPitch: mutation.shiftedFromPitch,
        shiftedToPitch: mutation.shiftedToPitch,
        audioSha256: baseScenario.source.sourceAudioSha256,
        midiSha256: baseScenario.source.sourceMidiSha256,
        configuredIntegerBpm: baseReceipt.configuredIntegerBpm,
        practiceScope: baseReceipt.practiceScope,
        naturalTerminalPerformanceTimeMs: baseScenario.completion.performanceTimeMs,
        selectionInputs: 'score artifact + physical MIDI + deterministic mutation rule; candidate outputs excluded',
      },
      acousticEvidenceReuse: acousticEvidenceReuseReceipt(baseScenario, scenario),
      truthIndependence: {
        expectedTruthSource: 'Derived PracticeScoreArtifact + CUSTOM_FIXED_BPM + PracticeScope RANGE',
        physicalTruthSource: 'Unchanged Vienna performance MIDI full NoteOn set',
        alignmentSource: 'Vienna .match score/performance anchors for the base geometry only',
        audioSource: 'Unchanged Vienna WAV',
      },
    },
  };
}

function counterfactualMutationProjection({
  basePracticeScoreArtifactSha256,
  family,
  practiceScope,
  mutation,
  artifact,
}) {
  return {
    projectionKind: 'VIENNA_COUNTERFACTUAL_MUTATION_CONTENT_V1',
    basePracticeScoreArtifactSha256,
    family,
    practiceScope,
    mutation,
    expectedPracticeGroups: artifact.expectedPracticeGroups,
    practiceAttackSteps: artifact.practiceAttackSteps,
    sourceMetadata: artifact.sourceMetadata ?? null,
  };
}

function acousticEvidenceReuseReceipt(baseScenario, mutatedScenario) {
  const baseByteDance = byteDanceGeometryIdentity(baseScenario);
  const mutatedByteDance = byteDanceGeometryIdentity(mutatedScenario);
  const baseOnlineAmt = onlineAmtGeometryIdentity(baseScenario);
  const mutatedOnlineAmt = onlineAmtGeometryIdentity(mutatedScenario);
  const receipt = {
    status: 'ACOUSTIC_EVIDENCE_REUSED_IDENTICAL_INPUT',
    sameSourceAudioSha: baseScenario.source.sourceAudioSha256 === mutatedScenario.source.sourceAudioSha256,
    samePerformanceOrigin: baseScenario.audio.performanceOriginSourceMs === mutatedScenario.audio.performanceOriginSourceMs,
    sameCompletion: baseScenario.completion.performanceTimeMs === mutatedScenario.completion.performanceTimeMs,
    sameFrozenCandidateConfiguration: true,
    byteDanceChunkGeometrySha256: {
      base: baseByteDance.sha256,
      mutated: mutatedByteDance.sha256,
    },
    onlineAmtSegmentGeometrySha256: {
      base: baseOnlineAmt.sha256,
      mutated: mutatedOnlineAmt.sha256,
    },
    sameByteDanceChunkGeometry: baseByteDance.sha256 === mutatedByteDance.sha256,
    sameOnlineAmtOwnedPcmTailGeometry: baseOnlineAmt.sha256 === mutatedOnlineAmt.sha256,
  };
  if (
    !receipt.sameSourceAudioSha
    || !receipt.samePerformanceOrigin
    || !receipt.sameCompletion
    || !receipt.sameByteDanceChunkGeometry
    || !receipt.sameOnlineAmtOwnedPcmTailGeometry
  ) {
    return {
      ...receipt,
      status: 'ACOUSTIC_EVIDENCE_REUSE_REJECTED_GEOMETRY_MISMATCH',
    };
  }
  return receipt;
}

function byteDanceGeometryIdentity(scenario) {
  const geometry = byteDance.planByteDanceScoreAwareChunks(scenario).map((plan) => ({
    chunkIdOrdinal: Number(plan.chunkId.match(/chunk-([0-9]+)$/)?.[1] ?? 0),
    inputStartPerformanceMs: plan.inputStartPerformanceMs,
    inputEndPerformanceMs: plan.inputEndPerformanceMs,
    commitStartPerformanceMs: plan.commitStartPerformanceMs,
    commitEndPerformanceMs: plan.commitEndPerformanceMs,
  }));
  return {
    geometry,
    sha256: sha256Text(canonicalJson({
      identityKind: 'BYTEDANCE_FROZEN_CHUNK_GEOMETRY_V1',
      candidateId: BYTEDANCE_CANDIDATE_ID,
      geometry,
    })),
  };
}

function onlineAmtGeometryIdentity(scenario) {
  const performanceOwnedSamples = performanceOwnedSamplesAtOrBefore(scenario.completion.performanceTimeMs);
  const tail = onlineAmt.onlineAmtSegmentTailRequirement(performanceOwnedSamples);
  const geometry = {
    segmentCount: 1,
    segments: [{
      segmentOrdinal: 0,
      performanceStartMs: 0,
      performanceOwnedSamples,
      requiredContextTailSamples: tail.requiredContextTailSamples,
      requiredProcessedSamples: tail.requiredProcessedSamples,
      correctionDelaySamples: tail.correctionDelaySamples,
      resetBeforeSegment: true,
    }],
  };
  return {
    geometry,
    sha256: sha256Text(canonicalJson({
      identityKind: 'ONLINE_AMT_FROZEN_SEGMENT_GEOMETRY_V1',
      candidateId: ONLINE_AMT_CANDIDATE_ID,
      geometry,
    })),
  };
}

function mutateArtifactForFamily({ artifact, baseScenario, scopeGroupIds, family }) {
  const groupById = new Map(artifact.expectedPracticeGroups.map((group) => [group.groupId, group]));
  const groups = scopeGroupIds.map((groupId) => groupById.get(groupId)).filter(Boolean);
  const internalGroups = groups.slice(1, Math.max(1, groups.length - 1));
  if (family === 'COUNTERFACTUAL_MISSING_NOTE') {
    for (const group of [
      ...internalGroups.filter((candidate) => candidate.pitches.length === 1),
      ...internalGroups.filter((candidate) => candidate.pitches.length !== 1),
    ]) {
      const time = expectedTimeForGroup(baseScenario, group.groupId);
      const addedPitch = deterministicUnplayedPitch(group.pitches, baseScenario, time);
      if (!addedPitch) continue;
      const wasMonophonic = group.pitches.length === 1;
      addPitchToGroupAndStep(artifact, group, addedPitch, family);
      return {
        operation: wasMonophonic
          ? 'ADD_EXPECTED_PITCH_TO_EXISTING_MONOPHONIC_GROUP'
          : 'ADD_EXPECTED_PITCH_TO_EXISTING_INTERNAL_GROUP',
        groupId: group.groupId,
        targetPitch: group.pitches[0],
        addedPitch,
      };
    }
  }
  if (family === 'COUNTERFACTUAL_INCOMPLETE_CHORD') {
    for (const group of internalGroups.filter((candidate) => candidate.pitches.length >= 2)) {
      const time = expectedTimeForGroup(baseScenario, group.groupId);
      const addedPitch = deterministicUnplayedPitch(group.pitches, baseScenario, time);
      if (!addedPitch) continue;
      addPitchToGroupAndStep(artifact, group, addedPitch, family);
      return { operation: 'ADD_REQUIRED_CHORD_TONE', groupId: group.groupId, addedPitch };
    }
  }
  if (family === 'COUNTERFACTUAL_EXTRA_NOTE') {
    for (const group of internalGroups.filter((candidate) => candidate.pitches.length >= 2)) {
      const time = expectedTimeForGroup(baseScenario, group.groupId);
      const target = group.strikeTargets.find((strike) => hasPhysicalPitchNear(baseScenario, strike.pitch, time));
      if (!target) continue;
      removeStrikeFromGroupAndStep(artifact, group, target);
      return { operation: 'REMOVE_EXPECTED_TONE_KEEP_PHYSICAL_MIDI', groupId: group.groupId, removedPitch: target.pitch, targetPitch: target.pitch };
    }
  }
  if (family === 'COUNTERFACTUAL_WRONG_SEMITONE') {
    for (const group of internalGroups) {
      const target = group.strikeTargets[0];
      const shifted = semitoneShift(target.pitch, group.pitches);
      if (!shifted) continue;
      shiftStrikePitchInGroupAndStep(artifact, group, target, shifted);
      return { operation: 'SHIFT_EXPECTED_PITCH_BY_SEMITONE', groupId: group.groupId, shiftedFromPitch: target.pitch, shiftedToPitch: shifted, targetPitch: target.pitch };
    }
  }
  return null;
}

function groupIdsInScope(artifact, scope) {
  const groups = artifact.expectedPracticeGroups;
  const start = groups.findIndex((group) => group.groupId === scope.startGroupId);
  const end = groups.findIndex((group) => group.groupId === scope.endGroupId);
  if (start < 0 || end < start) throw new Error('Counterfactual scope group IDs not found.');
  return groups.slice(start, end + 1).map((group) => group.groupId);
}

function addPitchToGroupAndStep(artifact, group, pitch, family) {
  const token = sanitizeFile(`${family}-${group.groupId}-${pitch}`);
  const renderNoteId = `cf-${token}`;
  const eventId = `${group.groupId}:cf:${pitch}`;
  const note = {
    eventId,
    expectedNoteId: `${eventId}:${renderNoteId}`,
    measureNumbers: group.measureNumbers ?? [],
    pitch,
    renderNoteId,
  };
  const strike = {
    eventIds: [eventId],
    expectedNotes: [note],
    measureNumbers: group.measureNumbers ?? [],
    pitch,
    renderNoteIds: [renderNoteId],
    strikeId: `${group.groupId}:strike:${sanitizeFile(pitch)}:cf`,
  };
  group.strikeTargets.push(strike);
  resyncGroup(group);
  const step = findStepForGroup(artifact, group);
  if (step) {
    step.attackTargets.push({
      attackId: `${step.stepId}:target:${sanitizeFile(pitch)}:cf`,
      eventIds: [eventId],
      measureNumbers: group.measureNumbers ?? [],
      notes: [{
        eventId,
        measureNumbers: group.measureNumbers ?? [],
        pitch,
        renderNoteId,
        staffIds: group.staffIds ?? [],
        stepNoteId: `${eventId}:${renderNoteId}`,
        voiceIds: group.voiceIds ?? [],
      }],
      pitch,
      renderNoteIds: [renderNoteId],
    });
    resyncStep(step);
  }
}

function removeStrikeFromGroupAndStep(artifact, group, strike) {
  group.strikeTargets = group.strikeTargets.filter((candidate) => candidate.strikeId !== strike.strikeId);
  resyncGroup(group);
  const step = findStepForGroup(artifact, group);
  if (step) {
    step.attackTargets = step.attackTargets.filter((target) => target.pitch !== strike.pitch);
    resyncStep(step);
  }
}

function shiftStrikePitchInGroupAndStep(artifact, group, strike, shiftedPitch) {
  const oldPitch = strike.pitch;
  strike.pitch = shiftedPitch;
  strike.strikeId = `${group.groupId}:strike:${sanitizeFile(shiftedPitch)}:cf`;
  for (const note of strike.expectedNotes ?? []) note.pitch = shiftedPitch;
  resyncGroup(group);
  const step = findStepForGroup(artifact, group);
  const target = step?.attackTargets.find((candidate) => candidate.pitch === oldPitch);
  if (target) {
    target.pitch = shiftedPitch;
    target.attackId = `${step.stepId}:target:${sanitizeFile(shiftedPitch)}:cf`;
    for (const note of target.notes ?? []) note.pitch = shiftedPitch;
    resyncStep(step);
  }
}

function resyncGroup(group) {
  const notes = group.strikeTargets.flatMap((target) => target.expectedNotes ?? []);
  group.expectedNotes = notes;
  group.eventIds = unique(notes.map((note) => note.eventId));
  group.renderNoteIds = unique(notes.map((note) => note.renderNoteId));
  group.pitches = unique(group.strikeTargets.map((target) => target.pitch));
}

function resyncStep(step) {
  const notes = step.attackTargets.flatMap((target) => target.notes ?? []);
  step.eventIds = unique(notes.map((note) => note.eventId));
  step.renderNoteIds = unique(notes.map((note) => note.renderNoteId));
}

function findStepForGroup(artifact, group) {
  return artifact.practiceAttackSteps.find((step) =>
    step.onsetBeat === group.onsetBeat
    && step.renderNoteIds.some((noteId) => group.renderNoteIds.includes(noteId))
  );
}

function expectedTimeForGroup(scenario, groupId) {
  const strike = scenario.expectedStrikes.find((candidate) => candidate.groupId === groupId);
  return strike?.expectedPerformanceTimeMs ?? 0;
}

function deterministicUnplayedPitch(existingPitches, scenario, timeMs) {
  const base = pitchNameToMidi(existingPitches[0]);
  for (const delta of [4, 7, -5, 2, -1, 9, -8, 12]) {
    const midi = base + delta;
    if (midi < 21 || midi > 108) continue;
    const pitch = midiPitchName(midi);
    if (existingPitches.includes(pitch)) continue;
    if (hasPhysicalPitchNear(scenario, pitch, timeMs)) continue;
    return pitch;
  }
  return null;
}

function hasPhysicalPitchNear(scenario, pitch, timeMs) {
  return scenario.physicalGroundTruth.attacks.some((attack) =>
    attack.pitch === pitch && Math.abs(attack.performanceTimeMs - timeMs) <= DEFAULT_ASSIGNMENT_WINDOW_MS
  );
}

function semitoneShift(pitch, existingPitches) {
  const midi = pitchNameToMidi(pitch);
  for (const delta of [1, -1]) {
    const next = midi + delta;
    if (next < 21 || next > 108) continue;
    const shifted = midiPitchName(next);
    if (!existingPitches.includes(shifted)) return shifted;
  }
  return null;
}

function selectBalancedCounterfactuals(candidates, target) {
  const sorted = [...candidates].sort((left, right) =>
    left.receipt.pieceId.localeCompare(right.receipt.pieceId)
    || performerIdForPerformance(left.receipt.performanceId).localeCompare(performerIdForPerformance(right.receipt.performanceId))
    || left.receipt.scenarioId.localeCompare(right.receipt.scenarioId)
  );
  const selected = [];
  const usedBase = new Set();
  const pieceOrder = ['Chopin_op10_no3', 'Chopin_op38', 'Mozart_K331_1st-mov', 'Schubert_D783_no15'];
  while (selected.length < target) {
    let added = false;
    for (const pieceId of pieceOrder) {
      const candidate = sorted.find((item) => item.receipt.pieceId === pieceId && !usedBase.has(item.receipt.baseScenarioId));
      if (!candidate) continue;
      selected.push(candidate);
      usedBase.add(candidate.receipt.baseScenarioId);
      added = true;
      if (selected.length >= target) break;
    }
    if (!added) break;
  }
  return selected;
}

async function runByteDanceScenario(scenario) {
  const wav = byteDance.decodeResearchWavToMonoFloat32(await readFile(path.resolve(repoRoot, scenario.source.sourceAudioPath)));
  const plans = byteDance.planByteDanceScoreAwareChunks(scenario);
  byteDance.validateByteDanceSourceContext(scenario, plans);
  const chunks = plans.map((plan) => ({
    chunkId: plan.chunkId,
    pcm16k: Array.from(byteDance.extractAndResampleLinear16k({
      sourcePcm: wav.pcm,
      sourceSampleRateHz: wav.sampleRateHz,
      sourceStartMs: scenario.audio.performanceOriginSourceMs + plan.inputStartPerformanceMs,
      sourceEndMs: scenario.audio.performanceOriginSourceMs + plan.inputEndPerformanceMs,
    })),
  }));
  const scenarioSafe = sanitizeFile(scenario.scenarioId);
  const chunkInputRel = `backend/data/work/public_proxy/vienna-4x22/runs/${scenarioSafe}.bytedance.chunks.json`;
  const rawOutputRel = `backend/data/work/public_proxy/vienna-4x22/runs/${scenarioSafe}.bytedance.raw.json`;
  const chunkInputPath = path.resolve(repoRoot, chunkInputRel);
  await mkdir(path.dirname(chunkInputPath), { recursive: true });
  await writeFile(chunkInputPath, `${JSON.stringify({ mode: 'VIENNA_REAL_SCENARIO_CHUNKS', chunks })}\n`);
  const run = spawnSync('node', [
    'backend/research/browser_runtime/run_bytedance_phase9e_a.mjs',
    '--repo-root',
    '.',
    '--git-head',
    implementationGitHead,
    '--chunk-input-json',
    chunkInputRel,
    '--raw-output-json',
    rawOutputRel,
    '--output-dir',
    'backend/data/work/public_proxy/vienna-4x22/runs/bytedance-audit',
  ], { cwd: repoRoot, encoding: 'utf8', timeout: 1_800_000 });
  if (run.status !== 0) throw new Error(`ByteDance browser execution failed: ${run.stderr || run.stdout}`);
  const rawArtifact = JSON.parse(await readFile(path.resolve(repoRoot, rawOutputRel), 'utf8'));
  const rawByChunk = new Map(rawArtifact.chunks.map((chunk) => [chunk.chunkId, chunk]));
  const processingByChunk = new Map(rawArtifact.chunks.map((chunk) => [chunk.chunkId, chunk.inferenceLatencyMs]));
  const schedule = byteDance.scheduleByteDanceSingleWorkerPublications({ plans, processingLatencyMsByChunkId: processingByChunk });
  const publications = plans.map((plan) => {
    const chunk = rawByChunk.get(plan.chunkId);
    const raw = byteDance.byteDanceRawOutputsFromBrowserChunkArtifact(chunk);
    const decoded = byteDance.decodeByteDanceChunkRawOutputs({ scenario, plan, raw });
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
    candidateId: BYTEDANCE_CANDIDATE_ID,
    scenarioId: scenario.scenarioId,
    publications,
    command: `node backend/research/browser_runtime/run_bytedance_phase9e_a.mjs --chunk-input-json ${chunkInputRel}`,
    runtime: 'real-ort-web-wasm-vienna-public-proxy',
  });
}

async function runOnlineAmtScenario(scenario) {
  const wav = byteDance.decodeResearchWavToMonoFloat32(await readFile(path.resolve(repoRoot, scenario.source.sourceAudioPath)));
  const completion = scenario.completion.performanceTimeMs;
  const ownedSamples = performanceOwnedSamplesAtOrBefore(completion);
  const requirement = onlineAmt.onlineAmtSegmentTailRequirement(ownedSamples);
  const performancePcm16k = resampleLinear({
    sourcePcm: wav.pcm,
    sourceSampleRateHz: wav.sampleRateHz,
    sourceStartMs: scenario.audio.performanceOriginSourceMs,
    sampleCount: ownedSamples,
  });
  const contextTailPcm16k = resampleLinear({
    sourcePcm: wav.pcm,
    sourceSampleRateHz: wav.sampleRateHz,
    sourceStartMs: scenario.audio.performanceOriginSourceMs + completion,
    sampleCount: requirement.requiredContextTailSamples,
  });
  const scenarioSafe = sanitizeFile(scenario.scenarioId);
  const segmentInputRel = `backend/data/work/public_proxy/vienna-4x22/runs/${scenarioSafe}.online-amt.segment-input.json`;
  const hopOutputRel = `backend/data/work/public_proxy/vienna-4x22/runs/${scenarioSafe}.online-amt.hop-artifact.json`;
  const segmentInputPath = path.resolve(repoRoot, segmentInputRel);
  await mkdir(path.dirname(segmentInputPath), { recursive: true });
  await writeFile(segmentInputPath, `${JSON.stringify({
    segments: [{
      segmentId: `${scenario.scenarioId}:segment-0`,
      performanceStartMs: 0,
      performancePcm16k: Array.from(performancePcm16k),
      contextTailPcm16k: Array.from(contextTailPcm16k),
    }],
  })}\n`);
  const run = spawnSync('docker', [
    'run',
    '--rm',
    '-v',
    `${repoRoot}:/workspace`,
    '-w',
    '/workspace',
    ONLINE_AMT_IMAGE,
    'python',
    'backend/research/online_amt/run_online_amt_modern_smoke.py',
    '--online-amt-repo',
    'backend/data/work/online_amt',
    '--checkpoint',
    'backend/data/work/online_amt/model-180000.pt',
    '--segment-input',
    segmentInputRel.replaceAll('\\', '/'),
    '--output',
    hopOutputRel.replaceAll('\\', '/'),
  ], { cwd: repoRoot, encoding: 'utf8', timeout: 1_800_000 });
  if (run.status !== 0) throw new Error(`Online-AMT Docker execution failed: ${run.stderr || run.stdout}`);
  const smoke = JSON.parse(await readFile(path.resolve(repoRoot, hopOutputRel), 'utf8'));
  if (smoke.runtimeSmoke?.status !== 'PASS' || !smoke.hopArtifact) {
    throw new Error(`Online-AMT runtime did not produce a PASS hop artifact: ${JSON.stringify(smoke.runtimeSmoke)}`);
  }
  return onlineAmt.runOnlineAmtStreamingCandidateFromHopArtifact({
    scenario,
    artifact: smoke.hopArtifact,
    candidateId: ONLINE_AMT_CANDIDATE_ID,
    command: `docker run ${ONLINE_AMT_IMAGE} python backend/research/online_amt/run_online_amt_modern_smoke.py --segment-input ${segmentInputRel}`,
    runtime: 'real-online-amt-modern-docker-vienna-public-proxy',
  });
}

async function parseMatchFile(filePath) {
  const text = await readFile(filePath, 'utf8');
  const units = Number(text.match(/info\(midiClockUnits,([0-9]+)\)/)?.[1] ?? 480);
  const rate = Number(text.match(/info\(midiClockRate,([0-9]+)\)/)?.[1] ?? 500000);
  const tickToMs = rate / units / 1000;
  const anchors = [];
  const pattern = /snote\(([^,]+),\[[^\]]+\],[^,]+,[^,]+,[^,]+,[^,]+,([-0-9.]+),[-0-9.]+,\[[^\]]*\]\)-note\(([^,]+),([0-9]+),([0-9]+),([0-9]+),([0-9]+),[0-9]+,[0-9]+\)\./g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    anchors.push({
      scoreNoteId: match[1],
      scoreBeat: Number(match[2]),
      performanceNoteId: match[3],
      performedMidi: Number(match[4]),
      performedMs: Number(match[5]) * tickToMs,
      velocity: Number(match[7]),
    });
  }
  return { anchors };
}

function groupAnchors(anchors) {
  const map = new Map();
  for (const anchor of anchors) {
    const key = anchor.scoreBeat.toFixed(4);
    const item = map.get(key) ?? { scoreBeat: anchor.scoreBeat, performedMs: anchor.performedMs, anchors: [] };
    item.anchors.push(anchor);
    item.performedMs = median(item.anchors.map((candidate) => candidate.performedMs));
    map.set(key, item);
  }
  return [...map.values()].sort((left, right) => left.scoreBeat - right.scoreBeat);
}

function fitLocalBpm(anchors) {
  const groups = groupAnchors(anchors);
  if (groups.length < 2) return { msPerBeat: NaN, rawFittedBpm: NaN };
  const tempos = [];
  for (let index = 1; index < groups.length; index += 1) {
    const beatDelta = groups[index].scoreBeat - groups[index - 1].scoreBeat;
    const timeDelta = groups[index].performedMs - groups[index - 1].performedMs;
    if (beatDelta > 0 && timeDelta > 0) tempos.push(timeDelta / beatDelta);
  }
  const msPerBeat = median(tempos);
  return { msPerBeat, rawFittedBpm: 60_000 / msPerBeat };
}

function safeProductIntegerBpm(rawBpm) {
  try {
    return publicContract.productIntegerBpm(rawBpm);
  } catch {
    return null;
  }
}

function anchorsForGroups(groups, anchorsByScoreNoteId) {
  return groups
    .flatMap((group) => group.renderNoteIds.flatMap((noteId) => {
      const direct = anchorsByScoreNoteId.get(noteId);
      if (direct) return [direct];
      const base = String(noteId).replace(/voice_overlap$/, '');
      const fallback = anchorsByScoreNoteId.get(base);
      return fallback ? [fallback] : [];
    }))
    .sort((left, right) => left.scoreBeat - right.scoreBeat || left.performedMs - right.performedMs);
}

function scoreGroundTruthEvaluation(scenario) {
  const definition = {
    candidateId: 'physical-midi-ground-truth-probe',
    strategyKind: 'CHUNKED',
    identity: {
      modelRuntime: 'physical-midi-ground-truth-probe',
      adapterVersion: 'vienna-corrected-truth-probe-v1',
      configurationSha256: createHash('sha256').update('vienna-corrected-truth-probe-v1').digest('hex'),
      trainingDataOverlapStatus: 'UNKNOWN',
    },
  };
  const run = {
    candidateId: definition.candidateId,
    scenarioId: scenario.scenarioId,
    publications: [{
      publicationId: `${scenario.scenarioId}:physical-midi-probe`,
      analyzedThroughPerformanceMs: scenario.completion.performanceTimeMs,
      observations: scenario.physicalGroundTruth.attacks.map((attack) => ({
        observationId: attack.physicalEventId,
        pitch: attack.pitch,
        performanceTimeMs: attack.performanceTimeMs,
        confidence: 1,
      })),
    }],
  };
  const score = bakeoff.scoreCandidate(scenario, definition, run);
  const groundTruth = score.groundTruthEvaluation;
  if (!groundTruth || groundTruth.status !== 'COMPLETE') {
    throw new Error('Physical MIDI ground-truth evaluation did not complete.');
  }
  const matched = groundTruth.strikes.filter((strike) => strike.result === 'MATCHED').length;
  const missing = groundTruth.strikes.filter((strike) => strike.result === 'MISSING').length;
  return {
    matchRate: matched / groundTruth.strikes.length,
    missingCount: missing,
    extraCount: groundTruth.extras.length,
  };
}

function verifyMatchMidiConsistency(anchors, noteOns, performanceId) {
  const byPitch = new Map();
  for (const note of noteOns) {
    const items = byPitch.get(note.midi) ?? [];
    items.push(note);
    byPitch.set(note.midi, items);
  }
  for (const anchor of anchors) {
    const nearest = (byPitch.get(anchor.performedMidi) ?? [])
      .reduce((best, note) => {
        const delta = Math.abs(note.onsetMs - anchor.performedMs);
        return !best || delta < best.delta ? { note, delta } : best;
      }, null);
    if (!nearest || nearest.delta > 8) {
      throw new Error(`Vienna match/MIDI timing mismatch for ${performanceId} ${anchor.performanceNoteId}.`);
    }
  }
}

function parseMidiNoteOns(bytes) {
  let offset = 0;
  if (ascii(bytes, offset, 4) !== 'MThd') throw new Error('MIDI file missing MThd header.');
  offset += 4;
  const headerLength = readU32(bytes, offset); offset += 4;
  const format = readU16(bytes, offset); offset += 2;
  const trackCount = readU16(bytes, offset); offset += 2;
  const division = readU16(bytes, offset); offset += 2;
  offset += headerLength - 6;
  if (division & 0x8000) throw new Error('SMPTE MIDI timing is not supported for Vienna proxy.');
  const noteOns = [];
  for (let trackIndex = 0; trackIndex < trackCount; trackIndex += 1) {
    if (ascii(bytes, offset, 4) !== 'MTrk') throw new Error('MIDI file missing MTrk chunk.');
    offset += 4;
    const trackEnd = offset + 4 + readU32(bytes, offset);
    offset += 4;
    let tick = 0;
    let timeMs = 0;
    let tempo = 500000;
    let firstTempo = null;
    let runningStatus = null;
    let eventIndex = 0;
    while (offset < trackEnd) {
      const delta = readVar(bytes, offset);
      offset = delta.offset;
      tick += delta.value;
      timeMs += delta.value * tempo / division / 1000;
      let status = bytes[offset++];
      if (status < 0x80) {
        if (runningStatus === null) throw new Error('MIDI running status without previous status.');
        offset -= 1;
        status = runningStatus;
      } else if (status < 0xf0) {
        runningStatus = status;
      }
      if (status === 0xff) {
        const type = bytes[offset++];
        const length = readVar(bytes, offset);
        offset = length.offset;
        if (type === 0x51 && length.value === 3) {
          const nextTempo = (bytes[offset] << 16) | (bytes[offset + 1] << 8) | bytes[offset + 2];
          if (firstTempo === null) firstTempo = nextTempo;
          if (nextTempo !== firstTempo) {
            throw new Error('Vienna MIDI tempo changes are not supported by the fixed-BPM proxy parser.');
          }
          tempo = nextTempo;
        }
        offset += length.value;
        continue;
      }
      if (status === 0xf0 || status === 0xf7) {
        const length = readVar(bytes, offset);
        offset = length.offset + length.value;
        continue;
      }
      const command = status & 0xf0;
      const data1 = bytes[offset++];
      const data2 = command === 0xc0 || command === 0xd0 ? 0 : bytes[offset++];
      if (command === 0x90 && data2 > 0) {
        noteOns.push({
          trackIndex,
          eventIndex,
          midi: data1,
          velocity: data2,
          onsetMs: timeMs,
        });
      }
      eventIndex += 1;
    }
    offset = trackEnd;
  }
  return { format, division, noteOns };
}

function ascii(bytes, offset, length) {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

function readU16(bytes, offset) {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readU32(bytes, offset) {
  return ((bytes[offset] << 24) >>> 0) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
}

function readVar(bytes, offset) {
  let value = 0;
  let current = 0;
  do {
    current = bytes[offset++];
    value = (value << 7) | (current & 0x7f);
  } while (current & 0x80);
  return { value, offset };
}

function buildFamilyComparisons(scores, familyTagsByScenario) {
  const families = [
    'COUNTERFACTUAL_MISSING_NOTE',
    'COUNTERFACTUAL_EXTRA_NOTE',
    'COUNTERFACTUAL_WRONG_SEMITONE',
    'COUNTERFACTUAL_INCOMPLETE_CHORD',
  ];
  return Object.fromEntries(families.map((family) => {
    const familyScores = scores.filter((score) => (familyTagsByScenario.get(score.scenarioId) ?? []).includes(family));
    const paired = publicContract.buildPublicPairedComparison({ scores: familyScores });
    const scenarioIds = new Set(familyScores.map((score) => score.scenarioId));
    const pieceIds = new Set([...scenarioIds].map((scenarioId) => pieceIdFromScenarioId(scenarioId)).filter(Boolean));
    const status = paired.pairedScenarioCount >= COUNTERFACTUAL_MIN_EVIDENCE_PER_FAMILY && pieceIds.size >= 2
      ? 'MEASURED'
      : 'INSUFFICIENT_FAMILY_EVIDENCE';
    return [family, {
      status,
      scenarioCount: paired.pairedScenarioCount,
      pieceCount: pieceIds.size,
      paired,
    }];
  }));
}

function reuseCandidateRunForCounterfactual(baseRun, scenario) {
  const replaceId = (value) => typeof value === 'string' ? value.replaceAll(baseRun.scenarioId, scenario.scenarioId) : value;
  return {
    ...cloneJson(baseRun),
    scenarioId: scenario.scenarioId,
    publications: baseRun.publications.map((publication) => ({
      ...publication,
      publicationId: replaceId(publication.publicationId),
      observations: publication.observations.map((observation) => ({
        ...observation,
        observationId: replaceId(observation.observationId),
      })),
    })),
    diagnostics: {
      ...(baseRun.diagnostics ?? {}),
      acousticEvidenceReuse: 'ACOUSTIC_EVIDENCE_REUSED_IDENTICAL_INPUT',
      baseScenarioId: baseRun.scenarioId,
    },
  };
}

function candidateRunReceipt({ scenario, run, mode, scenarioManifestSha256, runtime }) {
  return {
    candidateId: run.candidateId,
    scenarioId: scenario.scenarioId,
    scenarioManifestSha256,
    audioSha256: scenario.source.sourceAudioSha256,
    candidateConfigurationSha256: run.candidateId === BYTEDANCE_CANDIDATE_ID
      ? byteDance.bytedanceCandidateDefinition({ gitHead: implementationGitHead, trainingDataOverlapStatus: 'UNKNOWN' }).identity.configurationSha256
      : onlineAmt.onlineAmtCandidateDefinition({ gitHead: implementationGitHead, trainingDataOverlapStatus: 'UNKNOWN' }).identity.configurationSha256,
    runtimeProfileIdentity: runtime,
    inferenceMode: mode,
    runStatus: 'COMPLETE',
  };
}

function compactBakeoffReport(report) {
  return {
    schemaVersion: report.schemaVersion,
    comparativeOutcome: report.comparativeOutcome,
    comparativeRank: report.comparativeRank,
    absoluteGateStatus: report.absoluteGateStatus,
    scenarioCountsBySplit: report.scenarioCountsBySplit,
    scoreableScenarioCount: report.scoreableScenarioCount,
    candidateScenarioRunCount: report.candidateScenarioRunCount,
    candidateCoverage: report.candidateCoverage,
    aggregateMetrics: report.aggregateMetrics,
    aggregateFamilyMetrics: report.aggregateFamilyMetrics,
    resultSummary: report.resultSummary,
    scoreSummaries: report.scores.map((score) => ({
      scenarioId: score.scenarioId,
      candidateId: score.candidateId,
      candidateRunStatus: score.candidateRunStatus,
      groundTruthStatus: score.groundTruthStatus,
      candidateEvaluationStatus: score.candidateEvaluation.status,
      groundTruthEvaluationStatus: score.groundTruthEvaluation?.status ?? null,
      metrics: score.metrics,
      extraDiagnostics: score.extraDiagnostics,
    })),
  };
}

function selectStratifiedScenarios(pool, maxCount) {
  const byPiece = new Map();
  for (const item of pool) {
    const list = byPiece.get(item.receipt.pieceId) ?? [];
    list.push(item);
    byPiece.set(item.receipt.pieceId, list);
  }
  for (const list of byPiece.values()) {
    list.sort((left, right) =>
      left.receipt.performanceId.localeCompare(right.receipt.performanceId)
      || left.receipt.scopeStartBeat - right.receipt.scopeStartBeat
    );
  }
  const pieceOrder = ['Chopin_op10_no3', 'Chopin_op38', 'Mozart_K331_1st-mov', 'Schubert_D783_no15'];
  const selected = [];
  const selectedKeys = new Set();
  let round = 0;
  while (selected.length < maxCount) {
    let added = false;
    for (const pieceId of pieceOrder) {
      const list = byPiece.get(pieceId) ?? [];
      const candidate = list.filter((item) => !selectedKeys.has(item.receipt.scenarioId))[round];
      if (!candidate) continue;
      selected.push(candidate);
      selectedKeys.add(candidate.receipt.scenarioId);
      added = true;
      if (selected.length >= maxCount) break;
    }
    if (!added) break;
    round += 1;
  }
  return selected;
}

function resampleLinear(input) {
  const output = new Float32Array(input.sampleCount);
  const sourceStart = input.sourceStartMs / 1000 * input.sourceSampleRateHz;
  for (let index = 0; index < output.length; index += 1) {
    const position = sourceStart + index * input.sourceSampleRateHz / 16_000;
    if (position < 0 || position + 1 >= input.sourcePcm.length) throw new Error('Requested Online-AMT input window is outside source PCM.');
    const left = Math.floor(position);
    const right = Math.min(input.sourcePcm.length - 1, left + 1);
    const fraction = position - left;
    output[index] = input.sourcePcm[left] * (1 - fraction) + input.sourcePcm[right] * fraction;
  }
  return output;
}

function performanceOwnedSamplesAtOrBefore(completionPerformanceTimeMs) {
  const exactSamples = completionPerformanceTimeMs / 1000 * 16_000;
  return Math.max(0, Math.floor(exactSamples + 1e-9));
}

function mapFilesByBasename(root, extension, filter = () => true) {
  const map = new Map();
  for (const file of walkFiles(root)) {
    if (path.extname(file).toLowerCase() !== extension || !filter(file)) continue;
    map.set(path.basename(file, extension), file);
  }
  return map;
}

function pieceIdForPerformance(id) {
  if (id.startsWith('Chopin_op10_no3')) return 'Chopin_op10_no3';
  if (id.startsWith('Chopin_op38')) return 'Chopin_op38';
  if (id.startsWith('Mozart_K331_1st-mov')) return 'Mozart_K331_1st-mov';
  if (id.startsWith('Schubert_D783_no15')) return 'Schubert_D783_no15';
  throw new Error(`Unknown Vienna piece id for ${id}`);
}

function countFilesWithExtension(root, extension) {
  return walkFiles(root).filter((file) => path.extname(file).toLowerCase() === extension).length;
}

function walkFiles(root) {
  if (!existsSync(root)) return [];
  const files = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    const stat = statSync(current);
    if (stat.isFile()) files.push(current);
    else if (stat.isDirectory()) for (const entry of readdirSync(current)) stack.push(path.join(current, entry));
  }
  return files;
}

function distribution(values) {
  if (values.length === 0) return { sampleCount: 0 };
  const sorted = values.slice().sort((left, right) => left - right);
  return { sampleCount: sorted.length, min: sorted[0], median: percentile(sorted, 0.5), p95: percentile(sorted, 0.95), max: sorted.at(-1) };
}

function countBy(items, select) {
  return items.reduce((counts, item) => {
    const key = select(item);
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function unique(values) {
  return [...new Set(values.filter((value) => value !== undefined && value !== null))];
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(',')}}`;
}

function sha256Text(text) {
  return createHash('sha256').update(text).digest('hex');
}

function median(values) {
  return percentile(values.slice().sort((left, right) => left - right), 0.5);
}

function percentile(sortedValues, p) {
  if (sortedValues.length === 0) return NaN;
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil(p * sortedValues.length) - 1));
  return sortedValues[index];
}

function midiPitchName(midiPitch) {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  return `${names[midiPitch % 12]}${Math.floor(midiPitch / 12) - 1}`;
}

function pitchNameToMidi(pitch) {
  const match = /^([A-G])(#?)(-?\d+)$/.exec(pitch);
  if (!match) throw new Error(`Invalid pitch name ${pitch}`);
  const semitone = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[match[1]] + (match[2] === '#' ? 1 : 0);
  return (Number(match[3]) + 1) * 12 + semitone;
}

function performerIdForPerformance(performanceId) {
  return performanceId.match(/_p(\d+)/)?.[1] ? `p${performanceId.match(/_p(\d+)/)[1]}` : performanceId;
}

function pieceIdFromScenarioId(scenarioId) {
  if (scenarioId.includes('Chopin_op10_no3')) return 'Chopin_op10_no3';
  if (scenarioId.includes('Chopin_op38')) return 'Chopin_op38';
  if (scenarioId.includes('Mozart_K331_1st-mov')) return 'Mozart_K331_1st-mov';
  if (scenarioId.includes('Schubert_D783_no15')) return 'Schubert_D783_no15';
  return null;
}

async function sha256File(filePath) {
  const digest = createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => digest.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return digest.digest('hex');
}

function normalizeRel(root, filePath) {
  return path.relative(root, filePath).replaceAll(path.sep, '/');
}

function sanitizeFile(value) {
  return value.replace(/[^a-zA-Z0-9_.-]+/g, '_');
}

function gitHead(cwd) {
  try {
    return execFileSync('git', ['-C', cwd, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'UNKNOWN';
  }
}

function gitDirty(cwd) {
  try {
    return execFileSync('git', ['-C', cwd, 'status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0;
  } catch {
    return true;
  }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function parseCsvSet(value) {
  if (!value) return new Set();
  return new Set(String(value).split(',').map((item) => item.trim()).filter(Boolean));
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) parsed[key.slice(2)] = true;
    else {
      parsed[key.slice(2)] = value;
      index += 1;
    }
  }
  return parsed;
}
