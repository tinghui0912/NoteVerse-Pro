import { readdir } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { atomicJson, fileSha, digest } from './xc1_artifacts.mjs';
import { PHASE, ROOT, REPORTS, FREEZE, load } from './xc2_r2_replay.mjs';
import { R2_POLICY } from './xc2_r2_direct_conflict_finalizer.mjs';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
if (git('status', '--porcelain')) throw new Error('CLEAN_IMPLEMENTATION_TREE_REQUIRED');
if ((await readdir(ROOT)).some(n => n.endsWith('_metrics.json') || n.endsWith('_audit.json.gz') || n === 'replay_summary.json')) throw new Error('R2_REPLAY_ALREADY_STARTED');
const reconciliation = await load(`${REPORTS}/phase9g_xc2_r2_r1_hash_reconciliation_2026-10-16.json`);
if (reconciliation.status !== 'R1_EVIDENCE_PROVENANCE_RECONCILED_NO_SCIENTIFIC_CHANGE') throw new Error('R1_RECONCILIATION_REQUIRED');
const historicalReports = [];
for (const name of (await readdir(REPORTS)).filter(n => n.startsWith('phase9g_xc2_') && !n.startsWith('phase9g_xc2_r2_')).sort()) historicalReports.push({ path: `${REPORTS}/${name}`, sha256: await fileSha(`${REPORTS}/${name}`) });
const names = (await readdir('backend/research/browser_runtime')).filter(n => n.startsWith('xc2_r2_') || n === 'test_xc2_r2_direct_conflict.mjs');
const sourceFiles = [...names.map(n => `backend/research/browser_runtime/${n}`),
  'backend/research/browser_runtime/xc2_r1_bounded_finalizer.mjs', 'backend/research/browser_runtime/xc2_r1_replay.mjs',
  'backend/research/browser_runtime/xc2_product_metrics.mjs', 'backend/research/browser_runtime/xc2_r1_diagnose.mjs',
  'backend/research/browser_runtime/xc2_decoders.mjs', 'backend/research/browser_runtime/xc1_robust_decoder.mjs',
  'backend/research/browser_runtime/xc1_artifacts.mjs', 'backend/research/browser_runtime/robust_runtime_evidence_analysis.mjs',
  'backend/research/browser_runtime/xc1_browser_semantics.mjs', 'backend/research/browser_runtime/xc1_browser_runtime_shared.mjs',
  'apps/customer-web/src/lib/practice/local-core/continuous-finalization-ledger.ts',
  'apps/customer-web/src/lib/practice/research/xc2-five-verdict-projector.ts',
  'apps/customer-web/src/lib/practice/audio-analysis/continuous/performance-reconciler.ts',
  'apps/customer-web/src/lib/practice/input-capability.ts'];
const sources = []; for (const path of sourceFiles.sort()) sources.push({ path, sha256: await fileSha(path) });
const configurations = ['LINEAR_A_600_220', 'BAND_LIMITED_A_600_170'];
const r1Summary = await load('backend/data/work/xc2_r1_bounded_runtime/replay_summary.json');
const r1Witness = await load(`${REPORTS}/phase9g_xc2_r1_bounded_witness_manifest_2026-10-16.json`);
const inputs = [];
let maximumGroupSpanMs = 0, scenarioCount = 0;
async function input(path) { inputs.push({ path, sha256: await fileSha(path) }); }
for (const split of ['DEVELOPMENT', 'EVALUATION']) {
  await input(`backend/data/work/xc2_robust_product_baseline_v1/${split.toLowerCase()}_benchmark.json`);
  const truth = await load(`backend/data/work/xc2_robust_product_baseline_v1/${split.toLowerCase()}_benchmark.json`);
  for (const scenario of truth.clips.flatMap(c => c.scenarios)) {
    scenarioCount++;
    const groups = new Map();
    for (const s of scenario.expected) { if (!groups.has(s.groupId)) groups.set(s.groupId, []); groups.get(s.groupId).push(s.timeMs); }
    for (const times of groups.values()) maximumGroupSpanMs = Math.max(maximumGroupSpanMs, Math.max(...times) - Math.min(...times));
  }
  for (const c of configurations) {
    await input(`backend/data/work/xc2_robust_product_baseline_v1/metrics/${split === 'EVALUATION' ? 'evaluation' : 'geometry'}/${c}.json`);
    await input(r1Summary.rows.find(r => r.split === split && r.id === c).path);
    await input(r1Witness.rows.find(r => r.split === split && r.id === c).path);
  }
}
await input('backend/data/work/xc2_r1_bounded_runtime/replay_summary.json');
await input(`${REPORTS}/phase9g_xc2_r2_r1_hash_reconciliation_2026-10-16.json`);
await input(`${REPORTS}/phase9g_xc2_r2_parameter_provenance_2026-10-16.json`);
if (maximumGroupSpanMs > 20 + 1e-7) throw new Error('CORPUS_GROUP_SPAN_ASSUMPTION_INVALID');
const tests = spawnSync(process.execPath, ['--test', 'backend/research/browser_runtime/test_xc2_r2_direct_conflict.mjs',
  'backend/research/browser_runtime/test_xc2_r1_bounded.mjs'], { encoding: 'utf8', maxBuffer: 4e6 });
if (tests.status !== 0) throw new Error(tests.stdout + tests.stderr);
const freeze = { phase: PHASE, startingRemoteHead: 'c0f3b504ede2e9bb9a77c51bf4a69436bcb8e474',
  provenanceCommit: git('log', '-1', '--format=%H', '--', `${REPORTS}/phase9g_xc2_r2_parameter_provenance_2026-10-16.json`),
  implementationCommit: git('rev-parse', 'HEAD'), policy: R2_POLICY, configurations, splitOrder: ['DEVELOPMENT', 'EVALUATION'],
  semanticRuntimeIdentity: { node: process.version, platform: process.platform, architecture: process.arch, locale: Intl.DateTimeFormat().resolvedOptions().locale,
    execution: 'Pure semantic replay over existing sealed JSON. No browser/model/runtime session launched; no Python needed.' },
  classification: 'POST_XC2_DIAGNOSTIC_ONLY_NOT_FRESH_EVALUATION', optionalTwoHopPolicy: 'NOT_PERFORMED', optional500msConfirmation: 'NOT_PERFORMED',
  mathematicalHorizon: {
    expected: 'w250; legal observation o in[t-w,t+w]. Direct same-pitch competitor u requires|u-t|<=2w. H(t)=max(u+w) over literal direct cohort, so H(t)<=t+3w=t+750. Never use H(u) to expand H(t).',
    commit: 'Anchors whose own H is covered are processed in performance-time/ID order. Optimize only pending members of the anchors literal one-hop cohort and all their available legal observations. Stable sorted IDs for matching ties. Commit the anchor only; future proposals remain provisional.',
    wrong: 'Local group spans[a,b], Delta=b-a<=20ms in this corpus. Candidate incompatible observation o in[a-w,a+w] has direct correct claimant u<=o+w<=a+2w; its legal window closes u+w<=a+3w. G(g)=max(b+w, own strikes H, all such claimant local closes)<=b+3w=a+750+Delta<=a+770.',
    conservativeGroupCoverage: 'G includes all locally incompatible observations, even already-consumed ones, making the post-local-coverage horizon fixed and auditable. It does not follow any competitors competitors.',
    reservation: 'Any residual observation with an uncommitted directly legal expected strike remains RESERVED, never WRONG. At G, a group may finalize MISSING/INCOMPLETE while such evidence stays reserved; this never prolongs G to a claimants own later H. No retroactive repair after commitment.',
    extra: 'An observation o can match expected t<=o+w; H(t)<=t+3w<=o+4w. A directly legal incompatible group has a<=o+w and b<=a+Delta; G(g)<=b+3w<=o+4w+Delta. E(o)=max(o, directly legal expected H, directly legal WRONG-group G)<=o+1000+Delta<=o+1020. Fixed composition of direct queries, not transitive closure.',
    terminal: 'Explicit natural scope completion clamps horizons to the declared end; manual incomplete strikes NOT_REACHED. Terminal witnesses retain unclamped horizon and clamp flag.' },
  verifiedGroupSpan: { maximumGroupSpanMs, scenarioCount, maximumTheoreticalGroupHorizonMs: 750 + maximumGroupSpanMs, maximumTheoreticalExtraHorizonMs: 1000 + maximumGroupSpanMs },
  unresolvedReservationTradeoff: 'This is not offline whole-component equivalence. Protecting pending direct claimants may forgo WRONG evidence at a closed group; future release cannot reopen its verdict. Every disagreement is retained.',
  evaluation: { oracle: 'Immutable original XC2 oracle labels and original eligible scenarios; never revalidate/relabel with R2.',
    r1: 'Reproduce frozen R1 only to compare its exact verdict digest with its immutable archived witness stream; preserve published R1 counts and disposition.',
    latency: 'Sealed publication availability clocks unchanged; policy replay latency only, no new inference/runtime/UI measurements.',
    assignmentSignature: 'low-level verdict plus matchedObservationId; all disagreements retain causal strike witnesses.',
    fullRecoveryConclusion: 'Requires all baseline9MISSING->WRONG and4INCOMPLETE->WRONG cases recovered, every original-correct/R1-incorrect target recovered in all tested cells, no newly regressed target vs R1 or original, no increase in any critical false-accept count, and all ownership/horizon audits pass. Pre-existing acoustic errors need not vanish; no equivalence claim.',
    partialRecoveryConclusion: 'If any of baseline13wrong-preemption errors recovers but full criteria fail and critical false-accept counts do not increase: PARTIALLY_RECOVERS_SAFETY. Otherwise STILL_HAS_MATERIAL_SAFETY_TRADEOFF. No non-inferiority margin or winner.' },
  sources, sourceDigest: digest(sources), historicalReports, inputs,
  preFreezeTests: { command: 'node --test test_xc2_r2_direct_conflict.mjs test_xc2_r1_bounded.mjs (repository module paths)', exitCode: tests.status, stdout: tests.stdout, stderr: tests.stderr },
  parameterProvenance: `${REPORTS}/phase9g_xc2_r2_parameter_provenance_2026-10-16.json`, NO_OPTIMAL_PROFILE_CLAIM: true,
  frozenAcousticParameters: { sampleRateHz: 16000, modelInputMs: 1820, modelInputSamples: 29120, baselineFutureMs: 220, baselineOwnedMs: 600, onset: .30, frame: .05,
    decoder: 'A unchanged', resampler: 'existing sealed LINEAR baseline / BAND170 confirmation only', ort: '1.20.1 unchanged; not executed' },
  scopeProtections: { F5: 'NO_CLEAR_SCIENTIFIC_ACOUSTIC_WINNER', R4: 'ROBUST_CADENCE_SUSTAINABLE', R4Headroom: 'ROBUST_20_PERCENT_HEADROOM_FAIL',
    XC2: 'ROBUST_PRODUCT_BASELINE_MULTIPLE_PARETO_CANDIDATES', R1: 'BOUNDED_FINALIZATION_HAS_SAFETY_TRADEOFF', phase9gB: 'STATISTICAL_TIE', winner: null,
    viennaP15P22InferenceIncrease: 0, productionMicrophone: false, d4: false, productionWinner: null, practiceWebSocket: false,
    backendPracticeInference: false, serverPracticeInference: false, scoreFollowing: false, expectedScoreInNeuralInference: false,
    commercialQualificationStatus: 'NOT_PERFORMED', productLatencySlo: 'PRODUCT_LATENCY_SLO_NOT_YET_FROZEN', newNeuralInferenceCount: 0, newRuntimeSessions: 0 },
  realDataReplayStarted: false };
await atomicJson(FREEZE, freeze); console.log(JSON.stringify({ implementation: freeze.implementationCommit, sourceDigest: freeze.sourceDigest, tests: tests.status }));
