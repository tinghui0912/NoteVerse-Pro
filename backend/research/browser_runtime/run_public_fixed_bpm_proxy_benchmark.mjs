#!/usr/bin/env node
// Research-only Phase 9F-B public proxy benchmark runner.
//
// This runner is intentionally fail-closed. It may acquire public metadata into
// ignored backend/data/work paths, but it never turns public proxy data into
// official product EVALUATION and never manufactures candidate metrics when
// source audio/score/MIDI requirements are unavailable.

import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const BYTE_DANCE_MODEL_SHA256 = '6ba3bc4e73607f9cd021e69858fd3ff969a3941c7a93876d5be5cedb53038cf5';
const BYTE_DANCE_MODEL_BYTES = 98691493;
const ONLINE_AMT_CHECKPOINT_SHA256 = '54ab4907b517dbfa2dbbee834db18d31d103ee25d690860595181162d235e3a0';
const ONLINE_AMT_CHECKPOINT_BYTES = 178804960;
const VIENNA_AUDIO_ZIP_URL = 'https://datasets.mdw.ac.at/media/content_files/8dec8d0a-c4da-4a96-b290-a3ba783c03ba.zip';
const VIENNA_AUDIO_ZIP_BYTES = 1295130820;
const METRIC_DECISION_ORDER = [
  'verdictAgreementRate',
  'falseMatchRateOnGroundTruthMissing',
  'falseCompleteChordAcceptanceRate',
  'correctMissingRate',
  'chordExactCompletenessRate',
  'expectedStrikeRecall',
  'extraPrecision',
  'extraRecall',
  'timingAbsoluteMedianMs',
  'timingAbsoluteP95Ms',
];

const args = parseArgs(process.argv);
const repoRoot = path.resolve(args['repo-root'] ?? process.cwd());
const outputRel = args.output ?? 'backend/research/reports/public_fixed_bpm_proxy_phase9f_b_2026-10-08.json';
const outputPath = path.resolve(repoRoot, outputRel);
const registryPath = path.resolve(repoRoot, 'backend/research/policies/public_piano_dataset_registry_2026-10-08.json');
const workRootRel = args['work-root'] ?? 'backend/data/work/public_proxy';
const workRoot = path.resolve(repoRoot, workRootRel);
const implementationGitHead = String(args['git-head'] ?? gitHead(repoRoot));

await mkdir(path.dirname(outputPath), { recursive: true });
await mkdir(workRoot, { recursive: true });

const registry = JSON.parse(await readFile(registryPath, 'utf8'));
const registrySha256 = await sha256File(registryPath);
const byteDanceModel = await inspectFileIdentity({
  repoRoot,
  relativePath: args['bytedance-model'] ?? 'backend/data/work/bytedance_browser_runtime_feasibility/bytedance_note_model_fixed_anchor.onnx',
  expectedSha256: BYTE_DANCE_MODEL_SHA256,
  expectedBytes: BYTE_DANCE_MODEL_BYTES,
});
const onlineAmtCheckpoint = await inspectFileIdentity({
  repoRoot,
  relativePath: args['online-amt-checkpoint'] ?? 'backend/data/work/online_amt/model-180000.pt',
  expectedSha256: ONLINE_AMT_CHECKPOINT_SHA256,
  expectedBytes: ONLINE_AMT_CHECKPOINT_BYTES,
});

const primaryAudit = await auditPrimaryFixedGridProxy();
const viennaAudit = await auditViennaSecondaryProxy();

const primaryManifest = publicManifest({
  manifestId: 'phase9f-b-primary-fixed-grid-proxy-v1',
  layer: 'PRIMARY_FIXED_GRID_PROXY',
  dataset: primaryAudit.dataset,
  scenarioIds: [],
  scenarioFamilies: ['BASE_ORIGINAL', 'COUNTERFACTUAL_MISSING_NOTE', 'COUNTERFACTUAL_EXTRA_NOTE', 'COUNTERFACTUAL_WRONG_SEMITONE', 'COUNTERFACTUAL_INCOMPLETE_CHORD'],
});
const secondaryManifest = publicManifest({
  manifestId: 'phase9f-b-secondary-vienna-human-fixed-bpm-proxy-v1',
  layer: 'SECONDARY_HUMAN_FIXED_BPM_PROXY',
  dataset: viennaAudit.dataset,
  scenarioIds: [],
  scenarioFamilies: ['BASE_ORIGINAL', 'COUNTERFACTUAL_MISSING_NOTE', 'COUNTERFACTUAL_EXTRA_NOTE', 'COUNTERFACTUAL_WRONG_SEMITONE', 'COUNTERFACTUAL_INCOMPLETE_CHORD'],
});

const report = {
  schemaVersion: 1,
  artifact: 'phase9f_b_public_fixed_bpm_proxy_benchmark',
  generatedAt: new Date().toISOString(),
  implementationGitHead,
  normalizedCommand: [
    'node backend/research/browser_runtime/run_public_fixed_bpm_proxy_benchmark.mjs',
    '--repo-root .',
    `--work-root ${workRootRel}`,
    `--output ${outputRel}`,
  ].join(' '),
  runtimeEnvironment: {
    os: `${os.type()} ${os.release()} ${os.arch()}`,
    node: process.version,
  },
  datasetRegistry: {
    path: 'backend/research/policies/public_piano_dataset_registry_2026-10-08.json',
    sha256: registrySha256,
  },
  frozenCandidates: {
    byteDance: {
      candidateId: 'bytedance-score-aware-chunked-dev-v1',
      strategy: 'CHUNKED',
      frozenConfig: {
        modelInputSamples: 29120,
        sampleRateHz: 16000,
        futureContextMs: 220,
        maxCommitWidthMs: 600,
        onsetThreshold: 0.2,
        frameThreshold: 0.2,
      },
      modelIdentity: byteDanceModel,
    },
    onlineAmt: {
      candidateId: 'online-amt-stateful-modern-compat-dev-v1',
      strategy: 'STREAMING',
      frozenConfig: {
        sampleRateHz: 16000,
        hopSamples: 512,
        timingCorrectionMs: -158,
        onsetStateIds: [3, 4],
        onsetBoost: 2.0,
      },
      checkpointIdentity: onlineAmtCheckpoint,
    },
  },
  benchmarkPolicy: {
    accuracyGate: 'GATE_1_ONLY',
    metricDecisionOrder: METRIC_DECISION_ORDER,
    primaryAndSecondarySeparated: true,
    officialProductRank: null,
    absoluteGateStatus: 'NOT_EVALUATED',
    calibrationUsed: false,
    evaluationUsed: false,
  },
  manifests: {
    primary: {
      ...primaryManifest,
      sha256: sha256Json(primaryManifest),
      scenarioManifestFrozenBeforeInference: true,
    },
    secondary: {
      ...secondaryManifest,
      sha256: sha256Json(secondaryManifest),
      scenarioManifestFrozenBeforeInference: true,
    },
  },
  acquisition: {
    primary: primaryAudit,
    secondaryVienna: viennaAudit,
  },
  scenarioCounts: {
    primaryConsidered: 0,
    primaryMatched: 0,
    secondaryConsidered: 0,
    secondaryMatched: 0,
    baseOriginal: 0,
    counterfactualMissingNote: 0,
    counterfactualExtraNote: 0,
    counterfactualWrongSemitone: 0,
    counterfactualIncompleteChord: 0,
  },
  candidateRuns: {
    byteDanceRealRunCount: 0,
    onlineAmtRealRunCount: 0,
    skippedBeforeInferenceReason: reasonForNoScenarios(primaryAudit, viennaAudit),
  },
  metrics: {
    primary: emptyLayerMetrics('PRIMARY_FIXED_GRID_PROXY_UNAVAILABLE'),
    secondary: emptyLayerMetrics(viennaAudit.status === 'SOURCE_AVAILABLE_BUT_NO_SCOREABLE_AUDIO_MIDI_SCORE_BINDING' ? 'NO_SCOREABLE_SECONDARY_SCENARIOS' : 'SECONDARY_HUMAN_FIXED_BPM_PROXY_UNAVAILABLE'),
  },
  conclusions: {
    PRIMARY_FIXED_GRID_PROXY_RESULT: 'UNAVAILABLE',
    SECONDARY_HUMAN_FIXED_BPM_PROXY_RESULT: 'UNAVAILABLE',
    overallPublicEvidenceConclusion: 'NO_CLEAR_WINNER_ON_PUBLIC_FIXED_BPM_PROXY',
    reason: 'No scoreable matched public proxy scenarios were available before inference; no real model run was executed on public benchmark scenarios.',
  },
  confirmations: {
    noAcousticModelTuning: true,
    noBpmFittingFromCandidateOutputs: true,
    noCalibrationOrEvaluationTuning: true,
    noOfficialProductionWinner: true,
    officialProductRankRemainsNull: true,
    productionMicrophoneEnabled: false,
  },
};

await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(outputRel);

async function auditPrimaryFixedGridProxy() {
  const maps = dataset('maps');
  const sourceRoot = args['primary-source-root'] ? path.resolve(repoRoot, String(args['primary-source-root'])) : null;
  const sourceProbe = await probeUrl(maps?.sourceUrl);
  if (!sourceRoot || !existsSync(sourceRoot)) {
    return {
      layer: 'PRIMARY_FIXED_GRID_PROXY',
      dataset: {
        datasetId: 'maps',
        datasetVersion: maps?.version ?? 'registry-only',
        sourceUrl: maps?.sourceUrl,
        license: maps?.license,
        role: 'PRIMARY_FIXED_GRID_PROXY_CANDIDATE_AUDITED_AS_UNAVAILABLE',
        trainingOverlapStatus: maps?.trainingOverlapStatus ?? 'UNKNOWN',
      },
      status: 'PRIMARY_FIXED_GRID_PROXY_UNAVAILABLE',
      sourceProbe,
      blocker: sourceRoot ? `Primary source root missing: ${path.relative(repoRoot, sourceRoot)}` : 'No primary fixed-grid source root supplied; MAPS has no safe partial downloader in this runner, and exact selected-subset provenance must be audited before classification.',
      downloadedPerformanceCount: 0,
      qualifyingFixedGridPerformanceCount: 0,
    };
  }
  return {
    layer: 'PRIMARY_FIXED_GRID_PROXY',
    dataset: {
      datasetId: 'maps',
      datasetVersion: maps?.version ?? 'local-source',
      sourceUrl: maps?.sourceUrl,
      license: maps?.license,
      role: 'PRIMARY_FIXED_GRID_PROXY_CANDIDATE_LOCAL_SOURCE_PRESENT_NOT_CLASSIFIED',
      trainingOverlapStatus: maps?.trainingOverlapStatus ?? 'UNKNOWN',
    },
    status: 'PRIMARY_SOURCE_PRESENT_REQUIRES_PROVENANCE_IMPORT',
    sourceProbe,
    blocker: 'Local source exists, but no selected subset manifest proved fixed-grid score/MIDI/audio provenance.',
    downloadedPerformanceCount: countFiles(sourceRoot),
    qualifyingFixedGridPerformanceCount: 0,
  };
}

async function probeUrl(url, method = 'GET') {
  if (!url) return { attempted: false, status: 'NO_URL' };
  try {
    const response = await fetch(url, { method, redirect: 'follow' });
    return {
      attempted: true,
      url,
      method,
      status: response.ok ? 'AVAILABLE' : 'HTTP_ERROR',
      httpStatus: response.status,
      contentType: response.headers.get('content-type'),
      contentLength: response.headers.get('content-length'),
    };
  } catch (error) {
    return {
      attempted: true,
      url,
      method,
      status: 'FETCH_FAILED',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function auditViennaSecondaryProxy() {
  const vienna = dataset('vienna-4x22');
  const viennaRoot = path.join(workRoot, 'vienna-4x22');
  const metadataRoot = path.join(viennaRoot, 'vienna4x22-metadata');
  const acquisition = await ensureViennaMetadata(metadataRoot);
  const audioDistributionProbe = await probeUrl(VIENNA_AUDIO_ZIP_URL, 'HEAD');
  const sourceRoot = args['vienna-source-root'] ? path.resolve(repoRoot, String(args['vienna-source-root'])) : null;
  const sourceAvailable = sourceRoot ? existsSync(sourceRoot) : existsSync(metadataRoot);
  const midiCount = countFilesWithExtensions(path.join(metadataRoot, 'midi'), ['.mid', '.midi']);
  const musicXmlCount = countFilesWithExtensions(path.join(metadataRoot, 'musicxml'), ['.musicxml', '.xml']);
  const matchCount = countFilesWithExtensions(path.join(metadataRoot, 'match'), ['.match']);
  const audioCount = sourceRoot ? countFilesWithExtensions(sourceRoot, ['.wav', '.flac', '.aiff', '.aif']) : 0;
  return {
    layer: 'SECONDARY_HUMAN_FIXED_BPM_PROXY',
    dataset: {
      datasetId: 'vienna-4x22',
      datasetVersion: vienna?.version ?? 'registry',
      sourceUrl: vienna?.sourceUrl,
      doi: vienna?.doi,
      license: vienna?.license,
      role: 'SECONDARY_HUMAN_FIXED_BPM_PROXY',
      trainingOverlapStatus: vienna?.trainingOverlapStatus ?? 'UNKNOWN',
    },
    metadataAcquisition: acquisition,
    audioDistributionProbe: {
      ...audioDistributionProbe,
      expectedBytes: VIENNA_AUDIO_ZIP_BYTES,
      note: 'Official Vienna 4x22 audio distribution was probed but not downloaded by default; source audio must still be bound into NoteVerse scenarios before scoring.',
    },
    status: sourceAvailable ? 'SOURCE_AVAILABLE_BUT_NO_SCOREABLE_AUDIO_MIDI_SCORE_BINDING' : 'BLOCKED_SOURCE_NOT_AVAILABLE',
    blocker: sourceAvailable
      ? 'Vienna MIDI/MusicXML/match metadata was detected and the official audio distribution was probed, but no downloaded audio source root was provided/imported into NoteVerse PracticeScoreArtifact scenarios.'
      : 'Vienna metadata/source acquisition did not produce local files.',
    downloadedPerformerCount: midiCount > 0 ? 22 : 0,
    downloadedPerformanceCount: midiCount,
    musicXmlScoreCount: musicXmlCount,
    matchAlignmentCount: matchCount,
    sourceAudioFileCount: audioCount,
    scoreableSecondaryScenarioCount: 0,
    bpmFit: {
      method: 'MEDIAN_LOCAL_MS_PER_QUARTER',
      eligibilityThresholds: {
        groundTruthExpectedStrikeMatchingAtLeast: 0.95,
        absoluteGroundTruthTimingResidualP95AtMostMs: 125,
      },
      fittedScopeCount: 0,
    },
  };
}

async function ensureViennaMetadata(metadataRoot) {
  if (existsSync(metadataRoot)) {
    return {
      attempted: true,
      status: 'AVAILABLE_LOCAL',
      path: path.relative(repoRoot, metadataRoot).replaceAll(path.sep, '/'),
      fileCount: countFiles(metadataRoot),
      commit: gitHead(metadataRoot),
    };
  }
  const cloneUrl = 'https://github.com/CPJKU/vienna4x22.git';
  await mkdir(path.dirname(metadataRoot), { recursive: true });
  const result = spawnSync('git', ['clone', '--depth', '1', cloneUrl, metadataRoot], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 120_000,
  });
  if (result.status === 0) {
    return {
      attempted: true,
      status: 'DOWNLOADED_METADATA',
      sourceUrl: cloneUrl,
      path: path.relative(repoRoot, metadataRoot).replaceAll(path.sep, '/'),
      fileCount: countFiles(metadataRoot),
      commit: gitHead(metadataRoot),
    };
  }
  return {
    attempted: true,
    status: 'DOWNLOAD_FAILED',
    sourceUrl: cloneUrl,
    error: `${result.stderr || result.stdout || 'git clone failed'}`.trim(),
  };
}

function emptyLayerMetrics(reason) {
  const families = ['BASE_ORIGINAL', 'COUNTERFACTUAL_MISSING_NOTE', 'COUNTERFACTUAL_EXTRA_NOTE', 'COUNTERFACTUAL_WRONG_SEMITONE', 'COUNTERFACTUAL_INCOMPLETE_CHORD'];
  return Object.fromEntries(families.map((family) => [family, {
    status: 'NOT_EVALUATED',
    reason,
    metrics: Object.fromEntries(METRIC_DECISION_ORDER.map((metric) => [metric, { status: 'NOT_EVALUATED', sampleCount: 0, value: null }])),
    pairedCandidateDifferences: null,
    bootstrap95Ci: null,
  }]));
}

function reasonForNoScenarios(primary, secondary) {
  if (primary.status === 'PRIMARY_FIXED_GRID_PROXY_UNAVAILABLE' && secondary.status === 'BLOCKED_SOURCE_NOT_AVAILABLE') {
    return 'PUBLIC_DATA_UNAVAILABLE';
  }
  return 'NO_SCOREABLE_MATCHED_PUBLIC_SCENARIOS';
}

function publicManifest(input) {
  return {
    schemaVersion: 1,
    manifestId: input.manifestId,
    layer: input.layer,
    dataset: input.dataset,
    scenarioFamilies: input.scenarioFamilies,
    scenarioIds: input.scenarioIds,
    candidateOutputIncluded: false,
    officialProductEvaluation: false,
  };
}

function dataset(datasetId) {
  return registry.datasets.find((item) => item.datasetId === datasetId);
}

async function inspectFileIdentity({ repoRoot, relativePath, expectedSha256, expectedBytes }) {
  const absolute = path.resolve(repoRoot, relativePath);
  if (!existsSync(absolute)) {
    return { path: relativePath, available: false, status: 'MISSING', expectedSha256, expectedBytes };
  }
  const sha256 = await sha256File(absolute);
  const bytes = statSync(absolute).size;
  return {
    path: relativePath,
    available: true,
    sha256,
    bytes,
    expectedSha256,
    expectedBytes,
    status: sha256 === expectedSha256 && bytes === expectedBytes ? 'PASS' : 'MISMATCH',
  };
}

function countFiles(root) {
  if (!existsSync(root)) return 0;
  const output = spawnSync('git', ['-C', repoRoot, 'ls-files', '--others', '--exclude-standard', '--', root], { encoding: 'utf8' });
  if (output.status === 0 && output.stdout.trim()) return output.stdout.trim().split(/\r?\n/).length;
  try {
    const listing = execFileSync('powershell', ['-NoProfile', '-Command', `Get-ChildItem -LiteralPath ${JSON.stringify(root)} -Recurse -File | Measure-Object | Select-Object -ExpandProperty Count`], { encoding: 'utf8' });
    return Number.parseInt(listing.trim(), 10) || 0;
  } catch {
    return 0;
  }
}

function countFilesWithExtensions(root, extensions) {
  if (!existsSync(root)) return 0;
  try {
    const escapedRoot = JSON.stringify(root);
    const escapedExtensions = extensions.map((extension) => JSON.stringify(extension.toLowerCase())).join(',');
    const command = `$extensions=@(${escapedExtensions}); Get-ChildItem -LiteralPath ${escapedRoot} -Recurse -File | Where-Object { $extensions -contains $_.Extension.ToLowerInvariant() } | Measure-Object | Select-Object -ExpandProperty Count`;
    const listing = execFileSync('powershell', ['-NoProfile', '-Command', command], { encoding: 'utf8' });
    return Number.parseInt(listing.trim(), 10) || 0;
  } catch {
    return 0;
  }
}

async function sha256File(filePath) {
  return createHash('sha256').update(await readFile(filePath)).digest('hex');
}

function sha256Json(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(',')}}`;
}

function gitHead(cwd) {
  try {
    return execFileSync('git', ['-C', cwd, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'UNKNOWN';
  }
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
