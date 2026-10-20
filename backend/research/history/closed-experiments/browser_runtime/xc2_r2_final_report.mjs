import { readFile, readdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { atomicJson, fileSha, digest } from './xc1_artifacts.mjs';
import { ROOT, PHASE, REPORTS, FREEZE, load } from './xc2_r2_replay.mjs';

const freeze = await load(FREEZE), summary = await load(`${ROOT}/replay_summary.json`), metrics = [];
for (const s of [...freeze.sources, ...freeze.inputs, ...freeze.historicalReports]) if (await fileSha(s.path) !== s.sha256) throw new Error(`R2_FINAL_SOURCE_OR_HISTORY_DRIFT:${s.path}`);
for (const r of summary.results) {
  if (await fileSha(r.path) !== r.sha256 || await fileSha(r.auditPath) !== r.auditSha256) throw new Error('R2_REPLAY_ARTIFACT_MUTATED');
  metrics.push(await load(r.path));
}
if (metrics.length !== 4) throw new Error('R2_REPLAY_INCOMPLETE');
const baseline = metrics.find(r => r.configuration === 'LINEAR_A_600_220' && r.split === 'EVALUATION');
const keyBuckets = ['MISSING_TO_WRONG', 'INCOMPLETE_CHORD_TO_WRONG'];
const preemptionRecovered = keyBuckets.reduce((n, key) => n + baseline.recovery[key].recoveredCount, 0);
const allOriginalRegressionsRecovered = metrics.every(m => m.targetCases.filter(r => r.original === r.truth && r.r1 !== r.truth).every(r => r.r2 === r.truth));
const noNewRegressions = metrics.every(m => m.newlyRegressedVsOriginal.length === 0 && m.newlyRegressedVsR1.length === 0);
const critical = ['falseMatchOnGroundTruthMissing', 'wrongNoteFalseCorrect', 'falseCompleteChordAcceptance'];
const noCriticalIncrease = metrics.every(m => critical.every(k => m.r2.rates[k] <= Math.min(m.original.rates[k], m.r1ImmutableReference.rates[k])));
const allAudits = metrics.every(m => m.ownershipAudit.semanticViolations === 0 && m.ownershipAudit.prematureFutureCohortCommits === 0);
const disposition = preemptionRecovered === 13 && allOriginalRegressionsRecovered && noNewRegressions && noCriticalIncrease && allAudits
  ? 'DIRECT_CONFLICT_RESERVATION_RECOVERS_OBSERVED_R1_SAFETY_WITH_BOUNDED_LATENCY'
  : preemptionRecovered > 0 && noCriticalIncrease && allAudits ? 'DIRECT_CONFLICT_RESERVATION_PARTIALLY_RECOVERS_SAFETY'
    : 'DIRECT_CONFLICT_RESERVATION_STILL_HAS_MATERIAL_SAFETY_TRADEOFF';
const { results: _r, ...meta } = summary;
const rows = metrics.map(m => { const { targetCases: _t, ...compact } = m; return compact; });
const report = { phase: PHASE, startingRemoteHead: freeze.startingRemoteHead,
  provenanceCommit: freeze.provenanceCommit, implementationCommit: freeze.implementationCommit,
  policyFreezeCommit: execFileSync('git', ['log', '-1', '--format=%H', '--', FREEZE], { encoding: 'utf8' }).trim(),
  evidenceCommit: 'Exact evidence-only commit is the Git commit containing this report; returned after push, never a self-referential SHA.',
  r1Reconciliation: await load(`${REPORTS}/phase9g_xc2_r2_r1_hash_reconciliation_2026-10-16.json`),
  parameterProvenance: await load(`${REPORTS}/phase9g_xc2_r2_parameter_provenance_2026-10-16.json`),
  NO_OPTIMAL_PROFILE_CLAIM: true, classification: 'POST_XC2_DIAGNOSTIC_ONLY_NOT_FRESH_EVALUATION',
  policy: freeze.policy, mathematicalHorizon: freeze.mathematicalHorizon,
  exactRecoveryBaselineEvaluation: baseline.recovery, testedConfigurations: freeze.configurations,
  metrics: rows, artifactManifest: summary.results, replayMetadata: meta,
  allTargetCases: metrics.map(m => ({ configuration: m.configuration, split: m.split, cases: m.targetCases })),
  conclusion: disposition, conclusionRule: freeze.evaluation,
  decisionInputs: { baseline13PreemptionErrorsRecovered: preemptionRecovered, allOriginalRegressionsRecovered, noNewRegressions, noCriticalIncrease, allAudits },
  criticalInterpretation: 'Observed recovery is not mathematical policy equivalence or a fresh evaluation. Pre-existing acoustic mistakes remain visible. No production migration or winner.',
  historyUnchangedProof: { reportCount: freeze.historicalReports.length, reports: freeze.historicalReports, sourceChecks: freeze.sources },
  limitations: ['Both splits already seen, counterfactual times derived from physical MIDI, not independent natural score-clock timing.',
    'One-hop conditional reservation is intentionally not transitive offline optimization. Reserved evidence can outlive a group without reopening it.',
    'Latency reuses original research-harness availability; no new neural, browser/runtime, device, UI or perceptual measurement.',
    'Original class-conditional latency percentiles may change denominator; per-target cases also retain the same fixed truth target and availability timestamps.',
    'EXTRA target failures have audit references to the scenario snapshot; missing detection is not assigned zero latency.',
    'No profile optimization; current representative is selected by non-performance neutral hash, not an empirical optimum.'],
  testReceipt: freeze.preFreezeTests, scopeProtections: freeze.scopeProtections,
  github: 'Pre-evidence and post-push API receipts recorded separately; empty statuses and workflow arrays are not CI PASS.' };
const reportPath = `${REPORTS}/phase9g_xc2_r2_direct_conflict_final_2026-10-16.json`;
report.reportCanonicalSha256 = digest(report); await atomicJson(reportPath, report);
const lines = ['# XC2 R2 Direct Conflict Reservation', '', `Disposition: ${disposition}`, '',
  'POST_XC2_DIAGNOSTIC_ONLY_NOT_FRESH_EVALUATION. NO_OPTIMAL_PROFILE_CLAIM.', '',
  `R1 provenance: ${report.r1Reconciliation.status}. Exact894813...bytes reconstructed; only four added report fields and one asset-verification link differ from committedfa03b6...state.`, '',
  '## Policy', '',
  'w=250ms. Literal direct overlap |u-t|<=500ms gives strike coverage at mostt+750ms; no recursive cohort expansion.',
  'Only the anchor commits. Future assignments and eligibility reservations are reversible, not semantic ownership.',
  'WRONG never consumes an observation reserved for an uncommitted direct correct-match claimant. A group closes without unresolved reserved evidence instead of extending through its competitors competitors.',
  'Group bound is max strike time+750ms (at most group start+770ms here). EXTRA bound is observation time+1000ms+group span (at most1020ms), not R1s520ms.', '',
  '## Baseline Evaluation Recovery', '', '| Fixed truth -> R1 | R1 cases | R2 recovered | Still incorrect |', '|---|---:|---:|---:|',
  ...Object.entries(baseline.recovery).map(([k, r]) => `| ${k} | ${r.r1Count} | ${r.recoveredCount} | ${r.remainingCount} |`), '',
  'Counts track all R1 fixed-truth errors, including errors already present under original XC2. Full case receipts distinguish original-correct/R1-regressed cases from pre-existing acoustic errors.', '',
  '## Correctness', '', '| Split/config | Original agreement | R1 agreement | R2 agreement | New errors vs R1 | New errors vs original |', '|---|---:|---:|---:|---:|---:|',
  ...metrics.map(m => `| ${m.split}/${m.configuration} | ${m.original.counts.agree}/${m.original.counts.targets} | ${m.r1ImmutableReference.counts.agree}/${m.r1ImmutableReference.counts.targets} | ${m.r2.counts.agree}/${m.r2.counts.targets} | ${m.newlyRegressedVsR1.length} | ${m.newlyRegressedVsOriginal.length} |`), '',
  'Full JSON retains all three fixed-truth confusion matrices, raw counts/rates, every new regression and assignment disagreement, causal witnesses and per-class P50/P95/P99/max.', '',
  '## Baseline Verdict Latency', '', '| Class | Original P95 ms | R1 P95 ms | R2 P95 ms |', '|---|---:|---:|---:|',
  ...['CORRECT', 'MISSING', 'WRONG', 'INCOMPLETE_CHORD', 'EXTRA'].map(k => `| ${k} | ${baseline.original.fiveVerdictLatency[k].ms.p95?.toFixed(2)} | ${baseline.r1ImmutableReference.fiveVerdictLatency[k].ms.p95?.toFixed(2)} | ${baseline.r2.fiveVerdictLatency[k].ms.p95?.toFixed(2)} |`), '',
  'Class-conditional counts are retained. Product latency SLO is not frozen; these are logical replay finalization times, not new UI/runtime qualifications.', '',
  'No neural inference or runtime sessions. No production ledger changes. Historical XC2 and R1 reports unchanged. F5/R4/9G-B remain unchanged, microphonefalse, noD4, no production winner. Commercial qualificationNOT_PERFORMED.', ''];
await writeFile(`${REPORTS}/phase9g_xc2_r2_direct_conflict_summary_2026-10-16.md`, lines.join('\n'), { flag: 'wx' });
const evidence = [];
for (const name of (await readdir(REPORTS)).filter(n => n.startsWith('phase9g_xc2_r2_') && !n.includes('evidence_manifest')).sort()) evidence.push({ path: `${REPORTS}/${name}`, sha256: await fileSha(`${REPORTS}/${name}`) });
await atomicJson(`${REPORTS}/phase9g_xc2_r2_evidence_manifest_2026-10-16.json`, { phase: PHASE, finalReportPath: reportPath,
  finalReportCanonicalSha256: report.reportCanonicalSha256, finalReportFilesystemSha256: await fileSha(reportPath), files: evidence,
  note: 'Manifest generated only after final report packaging. No intermediate report SHA is labeled as final; manifest excludes itself.' });
console.log(JSON.stringify({ disposition, recovery: Object.fromEntries(Object.entries(baseline.recovery).map(([k, r]) => [k, `${r.recoveredCount}/${r.r1Count}`])), reportPath }));
