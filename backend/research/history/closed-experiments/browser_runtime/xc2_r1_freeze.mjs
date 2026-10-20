import { readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { atomicJson, fileSha, digest } from './xc1_artifacts.mjs';
import { ROOT, OLD_ROOT, PHASE, load } from './xc2_r1_diagnose.mjs';
import { BOUNDED_POLICY } from './xc2_r1_bounded_finalizer.mjs';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
if (git('status', '--porcelain')) throw new Error('CLEAN_IMPLEMENTATION_REQUIRED');
const implementationCommit = git('rev-parse', 'HEAD');
const names = (await readdir('backend/research/browser_runtime')).filter(n => n.startsWith('xc2_r1_') || n === 'test_xc2_r1_bounded.mjs');
const files = [...names.map(n => `backend/research/browser_runtime/${n}`), 'backend/research/xc2_r1_prepare.py',
  'backend/research/browser_runtime/xc2_product_metrics.mjs', 'backend/research/browser_runtime/xc2_decoders.mjs',
  'backend/research/browser_runtime/xc1_robust_decoder.mjs', 'backend/research/browser_runtime/xc1_browser_semantics.mjs',
  'backend/research/browser_runtime/xc1_browser_runtime_shared.mjs', 'backend/research/browser_runtime/xc1_artifacts.mjs',
  'backend/research/browser_runtime/robust_runtime_evidence_analysis.mjs',
  'apps/customer-web/src/lib/practice/research/xc2-five-verdict-projector.ts',
  'apps/customer-web/src/lib/practice/local-core/continuous-finalization-ledger.ts',
  'apps/customer-web/src/lib/practice/audio-analysis/continuous/performance-reconciler.ts',
  'backend/research/browser_runtime/xc1_ort120_runtime/package-lock.json'];
files.push('backend/research/protocols/xc2_r1_future_natural_capture_protocol.json');
for (const file of ['ort.webgpu.min.js', 'ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm']) files.push(`backend/research/browser_runtime/xc1_ort120_runtime/node_modules/onnxruntime-web/dist/${file}`);
const sources = []; for (const path of files.sort()) sources.push({ path, sha256: await fileSha(path) });
const prep = await load(`${ROOT}/preparation.json`), diagnosis = await load(`${ROOT}/existing_evidence_diagnosis.json`);
const configurations = [{ id: 'LINEAR_A_600_220', resampler: 'LINEAR', ownedMs: 600, futureMs: 220 },
  { id: 'BAND_LIMITED_A_500_220', resampler: 'BAND_LIMITED', ownedMs: 500, futureMs: 220 },
  { id: 'BAND_LIMITED_A_600_170', resampler: 'BAND_LIMITED', ownedMs: 600, futureMs: 170 }];
const runtimeOrder = [];
// Latin-square rotations counterbalance configuration position; clip order also rotates.
for (let repeat = 0; repeat < 3; repeat++) for (let clipIndex = 0; clipIndex < 3; clipIndex++) for (let position = 0; position < 3; position++) {
  runtimeOrder.push({ repeat, clipId: prep.runtimeClips[(clipIndex + repeat) % 3].clip.clipId, config: configurations[(position + repeat + clipIndex) % 3].id });
}
const result = { phase: PHASE, startingRemoteHead: '16bed4591e4ee135578b3a283373517bdd15029b', implementationCommit,
  classification: 'POST_XC2_DIAGNOSTIC_POLICY_AND_RUNTIME_ENGINEERING_FREEZE_NOT_NEW_BLIND_EVALUATION',
  historicalFiles: diagnosis.historicalFiles, historicalFilesDigest: diagnosis.historicalFilesDigest,
  historicalInterpretation: { XC2_ORIGINAL_DISPOSITION: 'ROBUST_PRODUCT_BASELINE_MULTIPLE_PARETO_CANDIDATES',
    sevenConfigurations: 'OBSERVATIONAL_PARETO_UNDER_ORIGINAL_XC2_FINALIZATION_AND_RESEARCH_RUNTIME_HARNESS',
    f5: 'NO_CLEAR_SCIENTIFIC_ACOUSTIC_WINNER', r4: 'ROBUST_CADENCE_SUSTAINABLE', phase9gB: 'STATISTICAL_TIE', winner: null },
  sources, sourceDigest: digest(sources), boundedPolicy: BOUNDED_POLICY,
  mathematicalHorizon: { wMs: 250,
    strike: 'For strike t only observations in [t-w,t+w] are legal. Frontier >=t+w covers all such evidence. Commit closed strikes first; do not reserve for open strikes.',
    group: 'Group g spans [a,b]. Required frontier b+w. At that frontier assign residual incompatible observations in [a-w,a+w] among simultaneously closed groups. Wrong may preempt an open future strike; intentional bounded-policy tradeoff, measured against original whole-component policy.',
    extra: 'For observation s, directly eligible strike t satisfies t<=s+w, closes <=s+2w. Wrong claimant group min a<=s+w, max b<=a+Delta, closes <=s+2w+Delta. Wait only max deadline of direct claimants, not their transitive neighbors. Delta is the actual frozen group span (physical grouping <=20ms here).',
    terminal: 'Natural completion may clamp required frontier to declared scope end; manual completion marks not-yet-closed strikes NOT_REACHED.',
    witnessAudit: 'Group required frontier = local deadline (or explicit terminal clamp); extra required frontier = maximum directly eligible local deadline. No dependency on transitive components.' },
  diagnosticTruth: 'Keep original frozen counterfactual/oracle labels and eligible scenarios. Do not relabel truth with the bounded policy. Replay both splits is diagnostic only.',
  extraDiagnostics: 'Natural acoustic residual = unmatched 50ms pitch-aware one-to-one against physical onsets, physical clip once. Duplicate = unmatched near an already-matched same-pitch physical onset within50ms. Counterfactual target precision separate; buckets diagnostic not causal proof.',
  resamplerTolerance: { maxAbs: 3e-6, rms: 5e-7, chunkVsSingleMaxAbs: 0, sampleCountExact: true,
    rationale: 'Float32 FIR summation over at most56 contributing taps; tolerance covers accumulation order, not time shifting or gain fitting. Fixtures bounded to [-1,1]. Frozen before first parity comparison.' },
  resampler: { implementation: 'xc2_r1_streaming_resampler.mjs', coefficientIdentity: prep.coefficients,
    referenceDocumentation: 'https://docs.scipy.org/doc/scipy-1.14.1/reference/generated/scipy.signal.resample_poly.html',
    algorithm: 'SciPy1.14.1 default Kaiser5 FIR, length8821, rational160/441, zero-phase delay compensation with real lookahead; ring128; streaming chunk invariance.',
    inputMixing: 'Existing PCM16 -> float32/32768 -> float64 arithmetic stereo mean -> float32; Docker prepares score-blind real guarded source. Browser resampler is mono44.1k->16k, not an AudioWorklet/device-capture qualification.' },
  configurations, runtimeOrder, repeatsPerConfigPerClip: 3,
  runtimeSelection: 'First three existing clip IDs sorted lexicographically, independent of acoustic quality; each clip exactly28s. Baseline plus one500ms BAND and one600ms lower-future BAND representative; no sweep.',
  runtimePolicy: { ort: '1.20.1', provider: 'default hardware WebGPU', warmupRuns: 3, timedWarmFence: 3,
    queueClassifier: 'Existing xc1_browser_semantics classifyBacklog, raw full rows; 8ms jitter allowance unchanged.',
    criticalPath: 'Browser input preparation / streaming resample -> ORT -> decoder A -> compact acoustic publication -> bounded finalizer. Raw tensor export disabled. Hash, Node IPC and file writes after capture.',
    headroomDiagnosticOnly: 'Warm P95<=0.8*cadence. No product latency SLO, no production eligibility/winner selection.',
    generalization: 'Three short clips and repeated sessions do not prove indefinite sustainability/thermal stability.',
    ORT130: 'ORT_WEB_1_30_RUNTIME_INELIGIBLE_FOR_THIS_ROBUST_EXPORT_ON_THIS_MACHINE; original control ~1224.6ms, preserved, not rerun.' },
  preparationSha256: await fileSha(`${ROOT}/preparation.json`), existingDiagnosisSha256: await fileSha(`${ROOT}/existing_evidence_diagnosis.json`),
  productLatencySlo: 'PRODUCT_LATENCY_SLO_NOT_YET_FROZEN',
  scopeProtections: { productionMicrophone: false, d4: false, productionWinner: null, viennaP15P22InferenceIncrease: 0,
    practiceWebSocket: false, backendPracticeInference: false, serverPracticeInference: false, scoreFollowing: false,
    expectedScoreInNeuralInput: false, commercialQualificationStatus: 'NOT_PERFORMED', originalXc2FilesUnchanged: true },
  inferenceBeforeFreeze: 'No new ONNX in this phase; existing sealed predictions only for pre-freeze diagnosis. Bounded replay and browser FIR parity have not started.' };
await atomicJson('backend/research/reports/phase9g_xc2_r1_policy_freeze_2026-10-16.json', result);
console.log(JSON.stringify({ implementationCommit, sourceDigest: result.sourceDigest, runtimeCells: runtimeOrder.length }));
