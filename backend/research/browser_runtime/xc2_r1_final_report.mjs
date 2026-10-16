import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { atomicJson, fileSha, digest } from './xc1_artifacts.mjs';
import { ROOT, PHASE, load } from './xc2_r1_diagnose.mjs';
import { describe } from './robust_runtime_evidence_analysis.mjs';

const freeze = await load('backend/research/reports/phase9g_xc2_r1_policy_freeze_2026-10-16.json');
const diagnosis = await load(`${ROOT}/existing_evidence_diagnosis.json`), replay = await load(`${ROOT}/replay_summary.json`), runtime = await load(`${ROOT}/runtime_summary.json`), band = await load(`${ROOT}/browser_resampler_parity.json`);
const unchanged = [];
for (const old of freeze.historicalFiles) { const actual = await fileSha(old.path); unchanged.push({ ...old, actualSha256: actual, unchanged: actual === old.sha256 }); }
if (unchanged.some(r => !r.unchanged)) throw new Error('HISTORICAL_XC2_REPORT_MUTATION');
for (const s of freeze.sources) if (await fileSha(s.path) !== s.sha256) throw new Error('FROZEN_R1_SOURCE_MUTATION');
const evaluation = replay.rows.filter(r => r.split === 'EVALUATION');
const safetyChanges = evaluation.filter(r => ['wrongNoteFalseCorrect', 'falseMatchOnGroundTruthMissing', 'falseCompleteChordAcceptance'].some(k => r.ratesDelta[k] > 0));
const configurations = [];
for (const c of freeze.configurations) {
  const receipts = runtime.rows.filter(r => r.config === c.id), detailed = [];
  for (const r of receipts) { if (await fileSha(r.path) !== r.sha256) throw new Error('RUNTIME_RECEIPT_MUTATED'); detailed.push(await load(r.path)); }
  const warm = detailed.flatMap(r => r.runtime.rows.slice(3).filter(s => !s.shiftedFinalWindow));
  configurations.push({ configuration: c, repeatReceipts: receipts, pooledDescriptive: {
    processingMs: describe(warm.map(r => r.processingMs)), pureOrtMs: describe(warm.map(r => r.ortSessionRunDurationMs)),
    decoderMs: describe(warm.map(r => r.decoderMs)), finalizerMs: describe(warm.map(r => r.finalizerCpuMs)), preprocessingMs: describe(warm.map(r => r.preprocessMs)) },
    noSustainedBacklogEverySession: receipts.every(r => r.summary.backlog.noSustainedBacklog),
    historicalTwentyPercentHeadroomEverySession: receipts.every(r => r.summary.productProcessingMs.p95 <= c.ownedMs * .8) });
}
const report = { phase: PHASE, startingHead: freeze.startingRemoteHead,
  implementationCommit: freeze.implementationCommit, freezeCommit: execFileSync('git', ['log', '-1', '--format=%H', '--', 'backend/research/reports/phase9g_xc2_r1_policy_freeze_2026-10-16.json'], { encoding: 'utf8' }).trim(),
  evidenceCommit: 'This evidence-only commit is identified by Git history; a commit cannot include its own hash.',
  freezeSha256: await fileSha('backend/research/reports/phase9g_xc2_r1_policy_freeze_2026-10-16.json'),
  originalXc2UnchangedProof: unchanged, historicalInterpretation: freeze.historicalInterpretation,
  transitiveDelayDiagnosis: diagnosis, boundedPolicy: freeze.boundedPolicy, mathematicalHorizon: freeze.mathematicalHorizon,
  originalVsBoundedCorrectnessAndLatency: replay, runtimeDeconfounding: {
    existingEvidence: diagnosis.runtime, measuredProductionLike: configurations,
    oldTiming: 'Raw persistence/Base64/IPC/hash/all research decoders on serialized service path. Individual historical overhead categories not independently observable.',
    newTiming: 'Browser input/FIR + ORT + decoder A + bounded finalizer. Compact result export only after capture; raw tensor export disabled. Post-capture Node serialization/file/hash reported separately.',
    sourceQualificationLimit: 'Canonical LINEAR input assumed16k. BAND browser streaming mono44.1k path exercised with real guard context, not device/AudioWorklet capture.' },
  counterbalancedOrder: freeze.runtimeOrder, browserBandLimited: band,
  externalValidity: { originalXc2: 'Expected beatPosition = physicalPerformanceTimeMs*120/60000. Tests pitch/verdict semantics, not natural timing errors relative to independent score clock.',
    replay: 'POST_XC2_DIAGNOSTIC_ONLY_NOT_FRESH_EVALUATION', runtime: 'Three28-second clips with3repeats/config: finite engineering study, no indefinite-session stability guarantee.',
    naturalCorpus: 'backend/research/protocols/xc2_r1_future_natural_capture_protocol.json', productLatencySlo: 'PRODUCT_LATENCY_SLO_NOT_YET_FROZEN' },
  conclusions: { boundedFinalization: safetyChanges.length ? 'BOUNDED_FINALIZATION_HAS_SAFETY_TRADEOFF' : 'BOUNDED_FINALIZATION_PRESERVES_OBSERVED_CRITICAL_SAFETY_AND_REDUCES_LATENCY',
    criticalSafetyRegressions: safetyChanges.map(r => ({ id: r.id, delta: r.ratesDelta })),
    runtime: configurations.every(c => c.noSustainedBacklogEverySession) ? 'ROBUST_PRODUCTION_LIKE_RUNTIME_SUSTAINABLE_IN_MEASURED_FINITE_SESSIONS' : 'ROBUST_PRODUCTION_LIKE_RUNTIME_NOT_SUSTAINABLE_IN_ALL_MEASURED_SESSIONS',
    bandLimited: band.pass ? 'BAND_LIMITED_BROWSER_RUNTIME_QUALIFIED_FOR_FROZEN_PCM_RESEARCH_PATH_ONLY' : 'BAND_LIMITED_BROWSER_RUNTIME_NOT_YET_QUALIFIED',
    scientificWinner: null, productionWinner: null, productLatencyReadiness: 'NOT_YET_QUALIFIED' },
  evidenceLayers: { acousticModelQuality: 'No new accuracy bakeoff; historical F5 unchanged. Natural residual diagnostics retain physical-clip unit.',
    productFinalizationPolicy: 'Closed-local online commits replace transitive waiting in research only; assignment disagreements retained, no production ledger change.',
    productionLikeRuntime: 'Causal browser computation and separately downstream finalization measured, diagnostic persistence excluded.',
    uiPerceptualLatency: 'No UI/render/perceptual validation; no latency SLO frozen.' },
  scopeProtections: freeze.scopeProtections, commercialQualificationStatus: 'NOT_PERFORMED',
  github: 'Actual post-push evidence recorded separately; empty statuses/workflows never CI PASS.' };
const output = 'backend/research/reports/phase9g_xc2_r1_bounded_runtime_final_2026-10-16.json'; await atomicJson(output, report);
const base = evaluation.find(r => r.id === 'LINEAR_A_600_220');
const lines = ['# XC2 R1 Bounded Finalization And Runtime', '', 'Original XC2 disposition unchanged; all replay is post-XC2 diagnostic only.', '',
  `Bounded policy: ${report.conclusions.boundedFinalization}`, `Runtime: ${report.conclusions.runtime}`, `Browser FIR: ${report.conclusions.bandLimited}`,
  '', '## Baseline Latency', '', '| Verdict | Original P95 ms | Bounded P95 ms | Delta ms |', '|---|---:|---:|---:|',
  ...Object.keys(base.original.latency).map(k => `| ${k} | ${base.original.latency[k].ms.p95?.toFixed(2)} | ${base.bounded.latency[k].ms.p95?.toFixed(2)} | ${base.latencyDeltaMs[k].p95?.toFixed(2)} |`),
  '', '## All Evaluation Configurations', '', '| Configuration | Agreement delta | Wrong false-correct delta | False match missing delta | False complete delta | Assignment changes |', '|---|---:|---:|---:|---:|---:|',
  ...evaluation.map(r => `| ${r.id} | ${r.ratesDelta.overallVerdictAgreement.toFixed(5)} | ${r.ratesDelta.wrongNoteFalseCorrect.toFixed(5)} | ${r.ratesDelta.falseMatchOnGroundTruthMissing.toFixed(5)} | ${r.ratesDelta.falseCompleteChordAcceptance.toFixed(5)} | ${r.assignmentChanges} |`),
  '', '## Runtime Breakdown', '', '| Configuration | Warm product P95 | ORT P95 | Decoder P95 | Finalizer P95 | All9sessions bounded |', '|---|---:|---:|---:|---:|---|',
  ...configurations.map(c => `| ${c.configuration.id} | ${c.pooledDescriptive.processingMs.p95.toFixed(2)} | ${c.pooledDescriptive.pureOrtMs.p95.toFixed(2)} | ${c.pooledDescriptive.decoderMs.p95.toFixed(2)} | ${c.pooledDescriptive.finalizerMs.p95.toFixed(2)} | ${c.noSustainedBacklogEverySession} |`),
  '', 'No production winner. PRODUCT_LATENCY_SLO_NOT_YET_FROZEN. No UI/perceptual or natural early/late-score qualification. F5/R4/9G-B remain unchanged.', ''];
// This is a new report, never an overwrite of historical XC2 evidence.
await writeFile('backend/research/reports/phase9g_xc2_r1_bounded_runtime_summary_2026-10-16.md', lines.join('\n'), { flag: 'wx' });
console.log(JSON.stringify({ output, sha256: await fileSha(output), conclusions: report.conclusions }));
