import { readFile, writeFile } from 'node:fs/promises';
import { gzipSync, gunzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { DirectConflictReservationFinalizer } from './xc2_r2_direct_conflict_finalizer.mjs';
import { boundedReplay } from './xc2_r1_replay.mjs';
import { evaluateProductVariant, compactProduct, pitchName } from './xc2_product_metrics.mjs';
import { atomicJson, digest, fileSha, validateArtifactDigest } from './xc1_artifacts.mjs';

export const PHASE = 'PHASE_9G_XC2_R2_DIRECT_CONFLICT_RESERVATION';
export const ROOT = 'backend/data/work/xc2_r2_direct_conflict';
export const REPORTS = 'backend/research/reports';
export const FREEZE = `${REPORTS}/phase9g_xc2_r2_policy_freeze_2026-10-16.json`;
export const load = async p => JSON.parse(await readFile(p, 'utf8'));
const signature = s => `${s.verdict}:${s.matchedObservationId ?? ''}`;
export function replayR2(scenario, publications) {
  const expected = scenario.expected.map((s, i) => ({ strikeId: s.strikeId, groupId: s.groupId, pitch: pitchName(s.pitch),
    expectedPerformanceTimeMs: scenario.beatPositions[i] * 60000 / scenario.fixedBpm, renderNoteIds: [] }));
  const ledger = new DirectConflictReservationFinalizer(expected);
  for (const p of publications) ledger.publish({ ...p, observations: p.observations.map(o => ({ ...o, pitch: pitchName(o.pitch) })) });
  const last = publications.at(-1), r = ledger.completeNaturalScope(last.analyzedThroughPerformanceMs, last.availabilityTimeMs);
  const ids = r.verdicts.flatMap(v => v.consumedObservationIds);
  if (new Set(ids).size !== ids.length || new Set(r.observationConsumption.map(v => v.observationId)).size !== r.observationConsumption.length
    || r.lowLevel.strikes.some(s => s.verdict === 'PENDING') || r.pendingObservationIds.length || r.provisionalReservations.length) throw new Error('R2_FINAL_OWNERSHIP_OR_CLOSURE_VIOLATION');
  for (const s of r.strikeWitnesses) {
    const first = publications.find(p => p.analyzedThroughPerformanceMs >= s.requiredFrontierMs);
    if (!first || first.availabilityTimeMs !== s.availabilityTimeMs || s.unclampedRequiredFrontierMs > s.targetTimeMs + 750 + 1e-8) throw new Error('R2_STRIKE_HORIZON_OR_ENABLING_PUBLICATION');
  }
  for (const v of r.verdicts) {
    const first = publications.find(p => p.analyzedThroughPerformanceMs >= v.witness.requiredAnalysisFrontierMs);
    if (!first || first.availabilityTimeMs !== v.witness.publicationAvailabilityTimeMs) throw new Error('R2_VERDICT_NOT_FIRST_HORIZON_COVERING_PUBLICATION');
    if (v.witness.requiredAnalysisFrontierMs > v.witness.enablingAnalysisFrontierMs) throw new Error('R2_FRONTIER_WITNESS');
  }
  // Every irreversible cohort commitment names only the anchor. Proposals are
  // intentionally not classified as observations' semantic owners.
  for (const c of r.cohortSolves) if (c.committedStrikeIds.length !== 1 || c.committedStrikeIds[0] !== c.anchorStrikeId) throw new Error('R2_PREMATURE_COHORT_COMMIT');
  return r;
}
function confusion(rows) {
  const result = {}; for (const r of rows) { const k = `${r.truth} -> ${r.predicted}`; result[k] = (result[k] ?? 0) + 1; } return result;
}
function stripArchiveContext(v) { const { scenarioId: _s, clipId: _c, ...content } = v; return content; }
export function extraTargetWitness(extra, publications, result) {
  const last = publications.at(-1), owners = new Map(result.observationConsumption.map(r => [r.observationId, r]));
  const candidates = publications.flatMap(p => p.observations).filter(o => o.pitch === extra.pitch && Math.abs(o.performanceTimeMs - extra.timeMs) <= 50);
  return { kind: 'DOWNSTREAM_EXTRA_TARGET_DETECTION_AUDIT_NOT_A_NEW_SEMANTIC_VERDICT', targetPerformanceTimeMs: extra.timeMs,
    scoringToleranceMs: 50, analyzedThroughPerformanceMs: last.analyzedThroughPerformanceMs,
    enablingScopeCompletionPublicationId: last.publicationId, publicationAvailabilityTimeMs: last.availabilityTimeMs,
    candidates: candidates.map(o => ({ observationId: o.observationId, performanceTimeMs: o.performanceTimeMs,
      semanticOwner: owners.get(o.observationId) ?? null, extraVerdictWitness: result.verdicts.find(v => v.verdict === 'EXTRA' && v.evidenceObservationIds.includes(o.observationId))?.witness ?? null })),
    note: 'The unchanged original50ms one-to-one EXTRA scorer decides detection. For undetected targets this records all eligible acoustic evidence and its final owner rather than inventing an EXTRA finalization time.' };
}

export async function runStudy() {
  const freeze = await load(FREEZE);
  for (const x of [...freeze.sources, ...freeze.historicalReports, ...freeze.inputs]) if (await fileSha(x.path) !== x.sha256) throw new Error(`R2_FROZEN_INPUT_OR_SOURCE_DRIFT:${x.path}`);
  const rawReceipts = await load(`${REPORTS}/phase9g_xc2_causal_execution_receipts_2026-10-16.json`);
  const rawByPath = new Map(rawReceipts.receipts.map(r => [r.path.replaceAll('\\', '/'), r]));
  const originalReport = await load(`${REPORTS}/phase9g_xc2_product_verdict_latency_final_2026-10-16.json`);
  const r1Summary = await load('backend/data/work/xc2_r1_bounded_runtime/replay_summary.json');
  const r1Witnesses = await load(`${REPORTS}/phase9g_xc2_r1_bounded_witness_manifest_2026-10-16.json`);
  const summary = [];
  // Baseline is fully replayed before the prospectively selected confirmation.
  for (const configId of freeze.configurations) for (const split of ['DEVELOPMENT', 'EVALUATION']) {
    const c = originalReport.ort120Main.candidates.find(c => c.id === configId);
    const truth = await load(`backend/data/work/xc2_robust_product_baseline_v1/${split.toLowerCase()}_benchmark.json`);
    const originalPath = `backend/data/work/xc2_robust_product_baseline_v1/metrics/${split === 'EVALUATION' ? 'evaluation' : 'geometry'}/${configId}.json`;
    const original = await load(originalPath), originalAudits = new Map(original.audit.map(r => [r.scenarioId, r]));
    const r1Receipt = r1Summary.rows.find(r => r.id === configId && r.split === split);
    if (await fileSha(r1Receipt.path) !== r1Receipt.sha256) throw new Error('R1_REFERENCE_METRICS_CHANGED');
    const r1Reference = await load(r1Receipt.path);
    const wr = r1Witnesses.rows.find(r => r.id === configId && r.split === split);
    if (await fileSha(wr.path) !== wr.sha256) throw new Error('R1_WITNESS_CHANGED');
    const archived = JSON.parse(gunzipSync(await readFile(wr.path))), archivedByScenario = new Map();
    for (const v of archived) { if (!archivedByScenario.has(v.scenarioId)) archivedByScenario.set(v.scenarioId, []); archivedByScenario.get(v.scenarioId).push(stripArchiveContext(v)); }
    const raws = [];
    for (const clip of truth.clips) {
      const p = `backend/data/work/xc2_robust_product_baseline_v1/raw/${split}_${c.resampler}_${c.ownedMs}_${c.futureMs}_1.20.1/${clip.clipId}.json`;
      if (await fileSha(p) !== rawByPath.get(p)?.fileSha256) throw new Error('ORIGINAL_ACOUSTIC_SEAL_CHANGED');
      const raw = await load(p); validateArtifactDigest(raw); raws.push(raw);
    }
    const audits = [], assignmentDifferences = [], r1Targets = new Map(), r2Targets = new Map(), extraWitnesses = new Map();
    let r1OriginalChanges = 0;
    const result = evaluateProductVariant(raws, truth, c.decoder, c.id, { replay: (scenario, publications) => {
      // Reconstruct only to audit against the immutable R1 archive, never relabel R1.
      const r1 = boundedReplay(scenario, publications), r2 = replayR2(scenario, publications), old = originalAudits.get(scenario.id);
      if (digest(r1.verdicts) !== digest(archivedByScenario.get(scenario.id))) throw new Error('R1_REFERENCE_REPRODUCTION_DISAGREEMENT');
      const oldMap = new Map(old.lowLevel.strikes.map(s => [s.strikeId, s])), r1Map = new Map(r1.lowLevel.strikes.map(s => [s.strikeId, s]));
      for (const s of r2.lowLevel.strikes) {
        const a = oldMap.get(s.strikeId), b = r1Map.get(s.strikeId);
        if (signature(a) !== signature(b)) r1OriginalChanges++;
        if (signature(s) !== signature(a) || signature(s) !== signature(b)) assignmentDifferences.push({ scenarioId: scenario.id,
          strikeId: s.strikeId, groupId: s.groupId, pitch: s.pitch, performanceTimeMs: s.expectedPerformanceTimeMs,
          original: { verdict: a.verdict, matchedObservationId: a.matchedObservationId ?? null },
          r1: { verdict: b.verdict, matchedObservationId: b.matchedObservationId ?? null },
          r2: { verdict: s.verdict, matchedObservationId: s.matchedObservationId ?? null },
          changedVsOriginal: signature(s) !== signature(a), changedVsR1: signature(s) !== signature(b),
          witness: r2.strikeWitnesses.find(w => w.strikeId === s.strikeId) });
      }
      for (const groupId of scenario.targetGroupIds) {
        const key = `${scenario.id}:${groupId}`;
        r1Targets.set(key, r1.verdicts.find(v => v.groupId === groupId)); r2Targets.set(key, r2.verdicts.find(v => v.groupId === groupId));
      }
      for (const extra of scenario.targetExtra) extraWitnesses.set(`${scenario.id}:${extra.id}`, extraTargetWitness(extra, publications, r2));
      audits.push({ scenarioId: scenario.id, snapshot: r2 }); return r2;
    } });
    if (r1OriginalChanges !== r1Reference.assignmentChanges) throw new Error('R1_ASSIGNMENT_CHANGE_COUNT_MISMATCH');
    const r2TargetMap = new Map(result.targetRows.map(r => [r.id, r])), r1Delta = new Map(r1Reference.pairedScenarioDifferences.pairedScenarioDifferences.map(r => [r.id, r]));
    const cases = original.targetRows.map(a => {
      const b = a.truth === 'EXTRA' ? { verdict: Number(a.agreement) + r1Delta.get(a.id).agreementDelta ? 'EXTRA' : 'NOT_DETECTED' } : r1Targets.get(a.id);
      const c = r2TargetMap.get(a.id), v = r2Targets.get(a.id);
      return { targetId: a.id, clipId: a.clipId, family: a.family, truth: a.truth, original: a.predicted, r1: b.verdict, r2: c.predicted,
        originalLatencyMs: a.latencyMs, r1LatencyMs: a.latencyMs === null || r1Delta.get(a.id).latencyDeltaMs === null ? null : a.latencyMs + r1Delta.get(a.id).latencyDeltaMs,
        r2LatencyMs: c.latencyMs, recoveredR1Error: b.verdict !== a.truth && c.predicted === a.truth,
        newlyRegressedVsR1: b.verdict === a.truth && c.predicted !== a.truth,
        newlyRegressedVsOriginal: a.predicted === a.truth && c.predicted !== a.truth,
        r2CausalWitness: v?.witness ?? extraWitnesses.get(a.id), r2EvidenceObservationIds: v?.evidenceObservationIds ?? extraWitnesses.get(a.id)?.candidates.map(c => c.observationId) ?? [],
        extraWitnessLocation: a.truth === 'EXTRA' ? 'Lossless policy audit: corresponding scenario snapshot EXTRA verdicts and consumption IDs' : null };
    });
    const recovery = {};
    for (const [truthClass, r1Class, n] of [['MISSING', 'WRONG', 9], ['INCOMPLETE_CHORD', 'WRONG', 4], ['CORRECT', 'INCOMPLETE_CHORD', 3], ['CORRECT', 'WRONG', 1], ['CORRECT', 'MISSING', 2]]) {
      const rows = cases.filter(r => r.truth === truthClass && r.r1 === r1Class);
      if (split === 'EVALUATION' && configId === 'LINEAR_A_600_220' && rows.length !== n) throw new Error('R1_REGRESSION_CATEGORY_COUNT_CHANGED');
      recovery[`${truthClass}_TO_${r1Class}`] = { r1Count: rows.length, recoveredCount: rows.filter(r => r.recoveredR1Error).length,
        remainingCount: rows.filter(r => !r.recoveredR1Error).length, cases: rows };
    }
    const auditPath = `${ROOT}/${split}_${configId}_audit.json.gz`;
    await writeFile(auditPath, gzipSync(Buffer.from(JSON.stringify({ audits, assignmentDifferences }))), { flag: 'wx' });
    const metrics = { phase: PHASE, configuration: configId, split, freezeDigest: digest(freeze),
      classification: 'POST_XC2_DIAGNOSTIC_ONLY_NOT_FRESH_EVALUATION',
      original: compactProduct(original), r1ImmutableReference: r1Reference.bounded, r2: compactProduct(result),
      runtimeFieldsAreHistoricalOnly: true, fixedTruthConfusion: {
        original: confusion(cases.map(r => ({ truth: r.truth, predicted: r.original }))),
        r1: confusion(cases.map(r => ({ truth: r.truth, predicted: r.r1 }))), r2: confusion(cases.map(r => ({ truth: r.truth, predicted: r.r2 }))) },
      recovery, targetCases: cases, newlyRegressedVsR1: cases.filter(r => r.newlyRegressedVsR1), newlyRegressedVsOriginal: cases.filter(r => r.newlyRegressedVsOriginal),
      assignmentChanges: { r1VsOriginal: r1OriginalChanges, r2VsOriginal: assignmentDifferences.filter(r => r.changedVsOriginal).length,
        r2VsR1: assignmentDifferences.filter(r => r.changedVsR1).length },
      ownershipAudit: { semanticViolations: 0, prematureFutureCohortCommits: 0, provisionalReservationsInSemanticOwnership: 0,
        allTerminalSnapshotsClosed: true, verdicts: audits.reduce((n, a) => n + a.snapshot.verdicts.length, 0) },
      horizonAudit: { strikeMaxBeyondTargetMs: Math.max(...audits.flatMap(a => a.snapshot.strikeWitnesses.map(w => w.unclampedRequiredFrontierMs - w.targetTimeMs))),
        verdictMaxRequiredBeyondTargetMs: Math.max(...audits.flatMap(a => a.snapshot.verdicts.map(v => v.witness.requiredAnalysisFrontierMs - v.performanceTimeMs))),
        extraMaxRequiredBeyondObservationMs: Math.max(0, ...audits.flatMap(a => a.snapshot.verdicts.filter(v => v.verdict === 'EXTRA').map(v => v.witness.requiredAnalysisFrontierMs - v.performanceTimeMs))) },
      auditPath, auditSha256: await fileSha(auditPath), originalMetricsPath: originalPath, originalMetricsSha256: await fileSha(originalPath),
      r1MetricsPath: r1Receipt.path, r1MetricsSha256: r1Receipt.sha256, r1WitnessPath: wr.path, r1WitnessSha256: wr.sha256,
      latencyInterpretation: 'Identical sealed acoustic publication availability clock; diagnostic logical finalization replay, no new runtime/UI timing qualification.' };
    const output = `${ROOT}/${split}_${configId}_metrics.json`; await atomicJson(output, metrics);
    summary.push({ configuration: configId, split, path: output, sha256: await fileSha(output), auditPath, auditSha256: metrics.auditSha256 });
    console.log(JSON.stringify({ configuration: configId, split, agreement: result.rates.overallVerdictAgreement, assignmentChanges: metrics.assignmentChanges,
      newlyRegressedVsR1: metrics.newlyRegressedVsR1.length, recovery: Object.fromEntries(Object.entries(recovery).map(([k, r]) => [k, `${r.recoveredCount}/${r.r1Count}`])) }));
  }
  await atomicJson(`${ROOT}/replay_summary.json`, { phase: PHASE, freezeDigest: digest(freeze), results: summary, newNeuralInferenceCount: 0, runtimeSessionsExecuted: 0 });
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await runStudy();
