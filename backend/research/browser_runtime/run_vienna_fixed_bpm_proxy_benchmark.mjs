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
const DEFAULT_MAX_SCENARIOS = 20;
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
const manifestRel = args['scenario-manifest'] ?? 'backend/research/reports/vienna_fixed_bpm_proxy_scenarios_phase9fb1_2026-10-08.json';
const manifestPath = path.resolve(repoRoot, manifestRel);
const reportRel = args.output ?? 'backend/research/reports/vienna_fixed_bpm_proxy_comparison_phase9fb1_2026-10-08.json';
const reportPath = path.resolve(repoRoot, reportRel);
const maxScenarios = Number(args['max-scenarios'] ?? DEFAULT_MAX_SCENARIOS);
const implementationGitHead = gitHead(repoRoot);
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
const scenarioPool = [];
const skippedScopes = [];
for (const performance of binding.performances) {
  const built = await buildScenarioCandidates(performance, scoreArtifacts.get(performance.pieceId), 2);
  scenarioPool.push(...built.scenarios);
  skippedScopes.push(...built.skipped);
}
const selectedScenarioItems = selectStratifiedScenarios(scenarioPool, maxScenarios);
const scenarios = selectedScenarioItems.map((item) => item.scenario);
const scenarioReceipts = selectedScenarioItems.map((item) => item.receipt);

const publicManifest = {
  schemaVersion: 1,
  manifestId: 'phase9f-b1-vienna-secondary-human-fixed-bpm-proxy-v1',
  layer: 'SECONDARY_HUMAN_FIXED_BPM_PROXY',
  dataset: {
    datasetId: 'vienna-4x22',
    datasetVersion: VIENNA_METADATA_COMMIT,
    sourceUrl: VIENNA_AUDIO_ZIP_URL,
    license: 'CC BY 4.0',
    role: 'SECONDARY_HUMAN_FIXED_BPM_PROXY',
    trainingOverlapStatus: 'UNKNOWN',
  },
  scenarioFamilies: ['BASE_ORIGINAL'],
  scenarioIds: scenarios.map((scenario) => scenario.scenarioId),
  scenarioManifestFrozenBeforeInference: true,
  frozenAt: new Date().toISOString(),
  candidateOutputIncluded: false,
  officialProductEvaluation: false,
};
if (scenarios.length === 0) {
  await writeFile(reportPath, `${JSON.stringify({
    schemaVersion: 1,
    artifact: 'phase9f_b1_vienna_fixed_bpm_proxy_blocked_before_inference',
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
  artifact: 'vienna_fixed_bpm_proxy_scenario_manifest',
  implementationGitHead,
  scenarioManifestFrozenBeforeInference: true,
  publicManifest,
  publicManifestSha256: manifestSha256,
  metadataCommit: VIENNA_METADATA_COMMIT,
  audioZip: acquisition.audioZip,
  intersectionCount: binding.intersectionCount,
    scenarioReceipts,
  practiceScoreArtifacts: [...scoreArtifacts.values()].map((item) => item.receipt),
  scenarios,
}, null, 2)}\n`);

const runs = [];
const failures = [];
const byteDanceDefinition = byteDance.bytedanceCandidateDefinition({ gitHead: implementationGitHead, trainingDataOverlapStatus: 'UNKNOWN' });
const onlineAmtDefinition = onlineAmt.onlineAmtCandidateDefinition({ gitHead: implementationGitHead, trainingDataOverlapStatus: 'UNKNOWN' });

for (const scenario of scenarios) {
  try {
    const run = await runByteDanceScenario(scenario);
    runs.push(run);
  } catch (error) {
    failures.push({ candidateId: BYTEDANCE_CANDIDATE_ID, scenarioId: scenario.scenarioId, error: errorMessage(error) });
  }
  try {
    const run = await runOnlineAmtScenario(scenario);
    runs.push(run);
  } catch (error) {
    failures.push({ candidateId: ONLINE_AMT_CANDIDATE_ID, scenarioId: scenario.scenarioId, error: errorMessage(error) });
  }
}

const diagnosticReport = publicContract.buildPublicDiagnosticBakeoffReport({
  scenarios,
  candidates: [byteDanceDefinition, onlineAmtDefinition],
  runs,
});
const baseScores = diagnosticReport.scores.filter((score) => score.scenarioSplit === 'DEVELOPMENT');
const headline = diagnosticReport.aggregateMetrics;
const paired = pairedDifferences(baseScores);
const secondaryResult = decideSecondaryResult(paired);
const report = {
  schemaVersion: 1,
  artifact: 'phase9f_b1_vienna_fixed_bpm_proxy_real_comparison',
  generatedAt: new Date().toISOString(),
  implementationGitHead,
  artifactGeneratedFromGitHead: gitHead(repoRoot),
  normalizedCommand: [
    'node backend/research/browser_runtime/run_vienna_fixed_bpm_proxy_benchmark.mjs',
    '--repo-root .',
    `--work-root ${workRootRel}`,
    `--max-scenarios ${maxScenarios}`,
    `--scenario-manifest ${manifestRel}`,
    `--output ${reportRel}`,
  ].join(' '),
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
    changesMdSha256: acquisition.changesMdSha256,
    provenance: 'DATASET_PROVIDED_AUDIO_MIDI_ALIGNMENT',
    invalidatedPriorResult: {
      artifact: 'phase9f_b1_vienna_fixed_bpm_proxy_real_comparison',
      previousResult: 'BYTE_DANCE_BETTER',
      correctedStatus: 'INVALIDATED_BENCHMARK_TRUTH_CONSTRUCTION',
      reason: '9F-B.1 used matched .match anchors for both expected score pitch and physical attacks; 9F-B.2 uses PracticeScoreArtifact/product resolver for expected truth and full performance MIDI for physical truth.',
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
    consideredScopeCount: scenarioReceipts.length + skippedScopes.length,
    baseScenarioCount: scenarios.length,
    skippedScopeCount: skippedScopes.length,
    targetScopeMs: DEFAULT_SCOPE_TARGET_MS,
    minScopeMs: DEFAULT_SCOPE_MIN_MS,
    maxScopeMs: DEFAULT_SCOPE_MAX_MS,
    preModelGate: {
      groundTruthExpectedStrikeMatchRateAtLeast: 0.95,
      absoluteTimingResidualP95AtMostMs: 125,
    },
    bpmDistribution: distribution(scenarioReceipts.map((item) => item.configuredIntegerBpm)),
    residualP95DistributionMs: distribution(scenarioReceipts.map((item) => item.absoluteResidualP95Ms)),
    ledgerGroundTruthMatchRateDistribution: distribution(scenarioReceipts.map((item) => item.ledgerGroundTruthExpectedStrikeMatchRate)),
    realScoreMissingNoteCount: scenarioReceipts.reduce((sum, item) => sum + item.groundTruthMissingCount, 0),
    realPhysicalExtraCount: scenarioReceipts.reduce((sum, item) => sum + item.groundTruthExtraCount, 0),
    selectedScenariosByPiece: countBy(scenarioReceipts, (item) => item.pieceId),
    uniquePerformerCount: new Set(scenarioReceipts.map((item) => item.performanceId)).size,
    uniquePieceCount: new Set(scenarioReceipts.map((item) => item.pieceId)).size,
  },
  candidateRuns: {
    byteDanceRealRunCount: runs.filter((run) => run.candidateId === BYTEDANCE_CANDIDATE_ID).length,
    onlineAmtRealRunCount: runs.filter((run) => run.candidateId === ONLINE_AMT_CANDIDATE_ID).length,
    failures,
  },
  metrics: headline,
  pairedComparison: paired,
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
      split: 'DEVELOPMENT',
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
  for (const anchor of anchors.slice(0, 200)) {
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
    let tempo = 500000;
    let runningStatus = null;
    let eventIndex = 0;
    while (offset < trackEnd) {
      const delta = readVar(bytes, offset);
      offset = delta.offset;
      tick += delta.value;
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
          tempo = (bytes[offset] << 16) | (bytes[offset + 1] << 8) | bytes[offset + 2];
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
          onsetMs: tick * tempo / division / 1000,
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

function pairedDifferences(scores) {
  const byScenario = new Map();
  for (const score of scores) {
    const entry = byScenario.get(score.scenarioId) ?? {};
    entry[score.candidateId] = score;
    byScenario.set(score.scenarioId, entry);
  }
  const pairs = [...byScenario.entries()].flatMap(([scenarioId, entry]) =>
    entry[BYTEDANCE_CANDIDATE_ID] && entry[ONLINE_AMT_CANDIDATE_ID]
      ? [{ scenarioId, byteDance: entry[BYTEDANCE_CANDIDATE_ID], onlineAmt: entry[ONLINE_AMT_CANDIDATE_ID] }]
      : []
  );
  const metricNames = [
    'verdictAgreementRate',
    'falseMatchRateOnGroundTruthMissing',
    'falseCompleteChordAcceptanceRate',
    'correctMissingRate',
    'chordExactCompletenessRate',
    'expectedStrikeRecall',
    'extraPrecision',
    'extraRecall',
    'timingAbsoluteP95Ms',
  ];
  return {
    pairedScenarioCount: pairs.length,
    metrics: Object.fromEntries(metricNames.map((name) => {
      const values = pairs.flatMap((pair) => {
        const left = pair.byteDance.metrics[name];
        const right = pair.onlineAmt.metrics[name];
        return left.status === 'MEASURED' && right.status === 'MEASURED' ? [left.value - right.value] : [];
      });
      return [name, {
        status: values.length === 0 ? 'NOT_EVALUATED' : 'MEASURED',
        sampleCount: values.length,
        meanDifferenceByteDanceMinusOnlineAmt: values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length,
        bootstrap95Ci: values.length < 2 ? null : bootstrapCi(values, 13_371),
      }];
    })),
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

function decideSecondaryResult(paired) {
  const verdict = paired.metrics.verdictAgreementRate;
  if (verdict.status !== 'MEASURED' || verdict.sampleCount === 0) return 'NO_CLEAR_WINNER';
  const diff = verdict.meanDifferenceByteDanceMinusOnlineAmt;
  if (Math.abs(diff) < 0.01) return 'NO_CLEAR_WINNER';
  const verdictCi = verdict.bootstrap95Ci;
  if (!verdictCi || (verdictCi.low <= 0 && verdictCi.high >= 0)) return 'NO_CLEAR_WINNER';
  const apparentWinner = diff > 0 ? 'BYTE_DANCE_BETTER' : 'ONLINE_AMT_BETTER';
  for (const metric of ['falseMatchRateOnGroundTruthMissing', 'falseCompleteChordAcceptanceRate']) {
    const safety = paired.metrics[metric];
    if (safety?.status !== 'MEASURED' || !safety.bootstrap95Ci) continue;
    const safetyDiff = safety.meanDifferenceByteDanceMinusOnlineAmt;
    const byteDanceMateriallyWorse = safetyDiff > 0.01 && safety.bootstrap95Ci.low > 0;
    const onlineAmtMateriallyWorse = safetyDiff < -0.01 && safety.bootstrap95Ci.high < 0;
    if (apparentWinner === 'BYTE_DANCE_BETTER' && byteDanceMateriallyWorse) return 'NO_CLEAR_WINNER';
    if (apparentWinner === 'ONLINE_AMT_BETTER' && onlineAmtMateriallyWorse) return 'NO_CLEAR_WINNER';
  }
  return apparentWinner;
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

function bootstrapCi(values, seed) {
  const draws = [];
  let state = seed;
  for (let sample = 0; sample < 500; sample += 1) {
    let sum = 0;
    for (let index = 0; index < values.length; index += 1) {
      state = (1664525 * state + 1013904223) >>> 0;
      sum += values[state % values.length];
    }
    draws.push(sum / values.length);
  }
  draws.sort((left, right) => left - right);
  return { low: percentile(draws, 0.025), high: percentile(draws, 0.975), seed };
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

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
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
