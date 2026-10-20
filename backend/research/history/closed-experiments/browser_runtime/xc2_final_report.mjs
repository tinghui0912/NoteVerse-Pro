import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { atomicJson, fileSha } from './xc1_artifacts.mjs';
import { REPO_ROOT, RUNTIME_NODE_MODULES } from './xc1_browser_runtime_shared.mjs';
const [freezePath, shortlistPath, output] = process.argv.slice(2);
const read = async p => JSON.parse(await readFile(p, 'utf8'));
const freeze = await read(freezePath), root = freeze.runRoot;
const evaluation = await read(`${root}/evaluation_result.json`);
const historicalPaths = ['backend/research/reports/phase9g_xc1_r3d_f5_full_scientific_result_2026-10-15.json',
  'backend/research/reports/robust_runtime_sustainability_qualification_result_2026-10-15.json',
  'backend/research/reports/phase9g_b3_official_product_blind_replacement_result_2026-10-11.json'];
const historical = [];
for (const p of historicalPaths) {
  const initial = execFileSync('git', ['rev-parse', `${freeze.startingRemoteHead}:${p}`], { encoding: 'utf8' }).trim();
  const current = execFileSync('git', ['rev-parse', `HEAD:${p}`], { encoding: 'utf8' }).trim();
  if (initial !== current) throw new Error('XC2_HISTORICAL_EVIDENCE_CHANGED');
  historical.push({ path: p, sha256: await fileSha(p), gitBlobUnchanged: true });
}
for (const [p, sha] of Object.entries(freeze.sourceHashBoundary)) if (await fileSha(p) !== sha) throw new Error('XC2_FROZEN_SOURCE_CHANGED');
const f5 = await read(historicalPaths[0]), r4 = await read(historicalPaths[1]), tie = await read(historicalPaths[2]);
if (f5.scientificDisposition !== 'NO_CLEAR_SCIENTIFIC_ACOUSTIC_WINNER' || tie.benchmarkOutcome !== 'STATISTICAL_TIE' || tie.winner !== null) throw new Error('XC2_PROTECTED_CONCLUSION_CHANGED');
const { createJiti } = createRequire(import.meta.url)(path.join(RUNTIME_NODE_MODULES, 'jiti'));
const capability = createJiti(import.meta.url)(path.join(REPO_ROOT, 'apps/customer-web/src/lib/practice/input-capability.ts'));
const actualCapability = capability.evaluatePracticeInputCapabilities();
const microphone = capability.getSelectedMicrophoneCapability({ ...actualCapability, microphoneCapture: { supported: true, status: 'AVAILABLE' } }, 'CONTINUOUS_PLAY');
if (microphone.supported) throw new Error('XC2_PRODUCTION_MICROPHONE_PROTECTION_FAILED');
const result = { phase: freeze.phase, startingRemoteHead: freeze.startingRemoteHead,
  implementationCommit: freeze.implementationCommit, protocolFreeze: { path: freezePath, freezeSha256: freeze.freezeSha256 },
  evaluationShortlist: { path: shortlistPath, sha256: await fileSha(shortlistPath), ...(await read(shortlistPath)) },
  evidenceCommit: { resolution: 'Evidence-only commit containing this result; SHA returned after push.' },
  evidenceLayers: { F5: 'ACOUSTIC_ONSET_TRANSCRIPTION', XC2: 'COUNTERFACTUAL_FIXED_BPM_PRODUCT_VERDICT_REPLAY_WITH_REAL_CAUSAL_BROWSER_PUBLICATIONS',
    physicallyPlayedWrongOrExtraIsTrueAcousticOnset: true, onsetFalsePositiveIsNotExtraVerdictError: true,
    onsetMissIsNotProductMissingDetection: true, historical9GB: 'HISTORICAL_PRODUCT_LEVEL_EVIDENCE_NOT_CURRENT_BROWSER_PRODUCTION_QUALIFICATION' },
  historicalProtectionReceipts: historical, protocol: freeze,
  clipsAndPhysicalMidiIdentities: (await read(freeze.fullManifestPath)).clips,
  baselineDevelopment: await read(`${root}/current_baseline_development.json`),
  stageADecoderResampler: await read(`${root}/stage_a_screening.json`),
  sealedAcousticInputsBeforeTruth: {
    development: { receipt: await read(`${root}/development_truth_permission.json`), sha256: await fileSha(`${root}/development_truth_permission.json`) },
    evaluation: { receipt: await read(`${root}/evaluation_truth_permission.json`), sha256: await fileSha(`${root}/evaluation_truth_permission.json`) },
  },
  developmentGeometryAndFuture: await read(`${root}/development_geometry_summary.json`),
  ort130Control: await read(`${root}/ort130_control.json`), ort120Main: evaluation,
  fiveVerdictTables: evaluation.candidates.map(c => ({ id: c.id, productCorrectnessVector: c.rates, rawCounts: c.counts,
    verdictLatencyMsAndBeats: c.fiveVerdictLatency, allFinalizedLatency: c.allFinalizedVerdictLatencyIncludingBackground,
    runtime: c.runtime, runtimeSustainable: c.runtimeSustainable })),
  observationConsumptionAudit: { rule: 'One observation receives one MATCHED, WRONG or EXTRA ownership; full per-scenario low-level strikes/extras and consumption retained in each sealed metrics file.',
    metricsReceipts: evaluation.candidates.map(c => ({ id: c.id, path: c.metricsPath, sha256: c.metricsSha256 })) },
  finalDisposition: evaluation.disposition, productLatencySlo: 'PRODUCT_LATENCY_SLO_NOT_YET_FROZEN',
  knownLimitations: ['Counterfactual expectations on real performances are not a natural pianist-error corpus.',
    'Five DEVELOPMENT and five EVALUATION clips are the statistical units; individual strikes are not independent replicates.',
    'Finalization availability is causal replay of measured acoustic publications and immutable ledger deadlines, not measured native UI rendering or human feedback perception.',
    'Shared raw-output persistence/IPC and decoder work are included in service timing; not a production-optimized harness.',
    'All-pitch wrong-association components and same-pitch ledger conflict components can defer feedback; no early-finalization shortcut was added.',
    'UPSTREAM_STYLE is a verified onset-time projection, not a claim of complete upstream note duration/pedal parity.'],
  commercialQualificationStatus: 'NOT_PERFORMED', researchUse: 'SCIENTIFIC_NON_COMMERCIAL_DEVELOPMENT',
  scopeProtections: { f5ScientificDisposition: f5.scientificDisposition, r4: r4.conclusions,
    phase9GB: { outcome: tie.benchmarkOutcome, winner: tie.winner }, p15p22InferenceIncrease: (await read(freeze.fullManifestPath)).clips.filter(c => /(?:^|[-_:])p(?:1[5-9]|2[0-2])(?:$|[-_:])/i.test(c.takeId)).length,
    productionMicrophone: microphone.supported, noD4: true, noProductionWinner: true, noPracticeWebSocket: true,
    noBackendServerPracticeInference: true, noScoreFollowing: true, noOnlineAmtInference: true, noBasicPitchInference: true },
};
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
async function github(endpoint) { const r = await fetch(`https://api.github.com/repos/tinghui0912/NoteVerse-Pro/${endpoint}`, { headers: { 'User-Agent': 'NoteVerse-XC2' } }); return { httpStatus: r.status, body: await r.json() }; }
result.githubStatusesAndWorkflowRuns = { queriedHead: head, combinedStatus: await github(`commits/${head}/status`), workflowRuns: await github(`actions/runs?head_sha=${head}&per_page=100`), emptyResultsAreNotCiPass: true };
await atomicJson(output, result);
console.log(JSON.stringify({ finalDisposition: result.finalDisposition, report: output }));
