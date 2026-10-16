import { pathToFileURL } from 'node:url';
import { load, ROOT, OLD_ROOT, PHASE } from './xc2_r1_diagnose.mjs';
import { BoundedContinuousFinalizationLedger } from './xc2_r1_bounded_finalizer.mjs';
import { evaluateProductVariant, compactProduct, pitchName, pairedClipBootstrap } from './xc2_product_metrics.mjs';
import { atomicJson, fileSha, digest, validateArtifactDigest } from './xc1_artifacts.mjs';
import { describe } from './robust_runtime_evidence_analysis.mjs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { REPO_ROOT, RUNTIME_NODE_MODULES } from './xc1_browser_runtime_shared.mjs';
const { createJiti } = createRequire(import.meta.url)(path.join(RUNTIME_NODE_MODULES, 'jiti'));
const { assignObservedAttacksToExpectedStrikes: match } = createJiti(import.meta.url)(path.join(REPO_ROOT, 'apps/customer-web/src/lib/practice/audio-analysis/continuous/performance-reconciler.ts'));
export function boundedReplay(scenario, publications) {
  const l = new BoundedContinuousFinalizationLedger(scenario.expected.map((s, i) => ({ strikeId: s.strikeId, groupId: s.groupId,
    pitch: pitchName(s.pitch), expectedPerformanceTimeMs: scenario.beatPositions[i] * 60000 / scenario.fixedBpm, renderNoteIds: [] })));
  for (const p of publications) l.publish({ ...p, observations: p.observations.map(o => ({ ...o, pitch: pitchName(o.pitch) })) });
  const last = publications.at(-1), r = l.completeNaturalScope(last.analyzedThroughPerformanceMs, last.availabilityTimeMs);
  const ids = r.verdicts.flatMap(v => v.consumedObservationIds);
  if (new Set(ids).size !== ids.length || r.lowLevel.strikes.some(s => s.verdict === 'PENDING') || r.pendingObservationIds.length) throw new Error('R1_OWNERSHIP_OR_FINALITY');
  for (const v of r.verdicts) {
    const required = v.witness.requiredAnalysisFrontierMs;
    const first = publications.find(p => p.analyzedThroughPerformanceMs >= required);
    if (required > v.witness.enablingAnalysisFrontierMs || !first || first.availabilityTimeMs !== v.witness.publicationAvailabilityTimeMs) throw new Error('R1_WITNESS_NOT_FIRST_LEGAL_PUBLICATION');
    if (v.groupId) {
      const deadline = Math.max(...scenario.expected.filter(s => s.groupId === v.groupId).map(s => s.timeMs)) + 250;
      if (Math.abs(required - Math.min(deadline, last.analyzedThroughPerformanceMs)) > 1e-8) throw new Error('R1_NONLOCAL_GROUP_HORIZON');
    }
  }
  return r;
}
function naturalResidual(raw, clip, decoder) {
  const physical = clip.notes.filter(n => n.timeMs >= 1380 && n.timeMs < 27780), events = raw.publications[decoder].flatMap(p => p.observations);
  const pairs = match({ assignmentWindowMs: 50, expectedStrikes: physical.map(n => ({ strikeId: n.id, groupId: n.id, pitch: pitchName(n.pitch), expectedPerformanceTimeMs: n.timeMs, renderNoteIds: [] })),
    observedAttacks: events.map(e => ({ ...e, pitch: pitchName(e.pitch), source: 'ACOUSTIC' })) });
  const used = new Set(pairs.values()), residual = events.filter((_, i) => !used.has(i));
  const rows = residual.map(e => { const same = physical.filter(n => n.pitch === e.pitch), nearest = same.reduce((best, n) => Math.abs(n.timeMs - e.performanceTimeMs) < Math.abs((best?.timeMs ?? Infinity) - e.performanceTimeMs) ? n : best, null);
    const duplicate = same.some(n => Math.abs(n.timeMs - e.performanceTimeMs) <= 50 && [...pairs].some(([i]) => physical[i].id === n.id));
    const boundary = events.some(other => other.observationId !== e.observationId && other.pitch === e.pitch && Math.abs(other.performanceTimeMs - e.performanceTimeMs) <= .001);
    return { observationId: e.observationId, pitch: e.pitch, performanceTimeMs: e.performanceTimeMs, nearestSamePitchPhysicalMs: nearest?.timeMs ?? null,
      nearestSamePitchDistanceMs: nearest ? Math.abs(nearest.timeMs - e.performanceTimeMs) : null,
      bucket: boundary ? 'OWNERSHIP_BOUNDARY_DUPLICATE' : duplicate ? 'DUPLICATE_RETRIGGER' : nearest && Math.abs(nearest.timeMs - e.performanceTimeMs) <= 250 ? 'TIMING_OUTSIDE_50MS_ACOUSTIC_TOLERANCE' : 'UNMATCHED_ACOUSTIC_FALSE_ONSET' }; });
  return { clipId: clip.clipId, physicalClipCount: 1, scoreableMinutes: 26400 / 60000, residualCount: rows.length,
    residualFalsePositivesPerMinute: rows.length / (26400 / 60000), duplicateRetriggerCount: rows.filter(r => r.bucket === 'DUPLICATE_RETRIGGER').length,
    pitchDistribution: Object.fromEntries([...new Set(rows.map(r => r.pitch))].sort((a, b) => a - b).map(p => [p, rows.filter(r => r.pitch === p).length])),
    nearestSamePitchDistanceMs: describe(rows.map(r => r.nearestSamePitchDistanceMs).filter(Number.isFinite)), rows };
}
function delta(a, b) { return Object.fromEntries(Object.keys(a).map(k => [k, a[k] === null || b[k] === null ? null : a[k] - b[k]])); }
export async function runReplay() {
  const freeze = await load('backend/research/reports/phase9g_xc2_r1_policy_freeze_2026-10-16.json');
  for (const s of freeze.sources) if (await fileSha(s.path) !== s.sha256) throw new Error('R1_SOURCE_DRIFT');
  const summary = await load('backend/research/reports/phase9g_xc2_product_verdict_latency_final_2026-10-16.json');
  const configurations = summary.ort120Main.candidates, output = [];
  const receipts = await load('backend/research/reports/phase9g_xc2_causal_execution_receipts_2026-10-16.json');
  const byPath = new Map(receipts.receipts.map(r => [r.path.replaceAll('\\', '/'), r]));
  for (const split of ['DEVELOPMENT', 'EVALUATION']) {
    const truth = await load(`${OLD_ROOT}/${split.toLowerCase()}_benchmark.json`);
    for (const c of configurations) {
      const raws = [];
      for (const clip of truth.clips) {
        const p = `${OLD_ROOT}/raw/${split}_${c.resampler}_${c.ownedMs}_${c.futureMs}_1.20.1/${clip.clipId}.json`, receipt = byPath.get(p);
        if (!receipt || await fileSha(p) !== receipt.fileSha256) throw new Error(`R1_EXISTING_RAW_SEAL_DRIFT:${p}`);
        const raw = await load(p); validateArtifactDigest(raw); raws.push(raw);
      }
      if (split === 'EVALUATION' && await fileSha(c.metricsPath) !== c.metricsSha256) throw new Error('R1_EXISTING_METRICS_DRIFT');
      const original = await load(`${OLD_ROOT}/metrics/${split === 'EVALUATION' ? 'evaluation' : 'geometry'}/${c.id}.json`);
      const bounded = evaluateProductVariant(raws, truth, c.decoder, c.id, { replay: boundedReplay });
      const residual = truth.clips.map(clip => naturalResidual(raws.find(r => r.clipId === clip.clipId), clip, c.decoder));
      let assignmentsChanged = 0, witnessCount = 0;
      for (let i = 0; i < original.audit.length; i++) {
        const old = new Map(original.audit[i].lowLevel.strikes.map(s => [s.strikeId, s]));
        for (const s of bounded.audit[i].lowLevel.strikes) { const prior = old.get(s.strikeId); if (prior.verdict !== s.verdict || prior.matchedObservationId !== s.matchedObservationId) assignmentsChanged++; }
        witnessCount += bounded.audit[i].verdicts.length;
      }
      const row = { split, id: c.id, original: compactProduct(original), bounded: compactProduct(bounded), ratesDeltaBoundedMinusOriginal: delta(bounded.rates, original.rates),
        countsDeltaBoundedMinusOriginal: delta(bounded.counts, original.counts),
        latencyDeltaMs: Object.fromEntries(Object.keys(bounded.fiveVerdictLatency).map(k => [k, delta(bounded.fiveVerdictLatency[k].ms, original.fiveVerdictLatency[k].ms)])),
        pairedScenarioDifferences: pairedClipBootstrap(bounded, original), assignmentChanges: assignmentsChanged,
        consumptionViolations: 0, witnessAudit: { verdictCount: witnessCount, unrelatedFutureWaitViolations: 0 }, naturalResidual: residual,
        targetExtraInterpretation: 'Counterfactual scenario-weighted precision/recall; not natural extra prevalence.',
        population: 'POST_XC2_DIAGNOSTIC_ONLY_NOT_FRESH_EVALUATION' };
      if (c.id === 'LINEAR_A_600_220') {
        const falseExtras = [];
        for (let i = 0; i < original.audit.length; i++) {
          const scenario = truth.clips.flatMap(x => x.scenarios).find(s => s.id === original.audit[i].scenarioId);
          const clip = truth.clips.find(x => x.scenarios.some(s => s.id === scenario.id));
          const events = new Map(raws.find(r => r.clipId === clip.clipId).publications[c.decoder].flatMap(p => p.observations).map(e => [e.observationId, e]));
          const extras = original.audit[i].verdicts.filter(v => v.verdict === 'EXTRA');
          const targetPairs = match({ assignmentWindowMs: 50, expectedStrikes: scenario.targetExtra.map(n => ({ strikeId: n.id, groupId: n.id, pitch: pitchName(n.pitch), expectedPerformanceTimeMs: n.timeMs, renderNoteIds: [] })),
            observedAttacks: extras.map(v => ({ ...events.get(v.evidenceObservationIds[0]), pitch: pitchName(events.get(v.evidenceObservationIds[0]).pitch), source: 'ACOUSTIC' })) });
          const targetMatched = new Set(targetPairs.values());
          for (let j = 0; j < extras.length; j++) {
            const v = extras[j];
            const e = events.get(v.evidenceObservationIds[0]);
            if (targetMatched.has(j)) continue;
            const natural = residual.find(r => r.clipId === clip.clipId).rows.find(r => r.observationId === e.observationId);
            const nearestExpected = scenario.expected.filter(s => s.pitch === e.pitch).reduce((d, s) => Math.min(d, Math.abs(s.timeMs - e.performanceTimeMs)), Infinity);
            const incompatible = scenario.expected.some(s => s.pitch !== e.pitch && Math.abs(s.timeMs - e.performanceTimeMs) <= 250);
            const bucket = natural?.bucket === 'OWNERSHIP_BOUNDARY_DUPLICATE' ? natural.bucket : natural?.bucket === 'DUPLICATE_RETRIGGER' ? natural.bucket
              : nearestExpected > 250 && nearestExpected < 500 ? 'TIMING_OUTSIDE_EXPECTED_ASSIGNMENT_WINDOW'
              : !natural && incompatible ? 'PITCH_SUBSTITUTION_RESIDUAL' : natural ? 'UNMATCHED_ACOUSTIC_FALSE_ONSET' : 'OTHER_AMBIGUOUS';
            falseExtras.push({ scenarioId: scenario.id, observationId: e.observationId, bucket, event: e });
          }
        }
        row.baselineFalseTargetExtraBuckets = { rows: falseExtras, count: falseExtras.length,
          definition: 'Original EXTRA not within 50ms same-pitch of selected counterfactual targetExtra; natural diagnostic has separate unamplified rows. Ordered bucket precedence is frozen source code.' };
      }
      const outputPath = `${ROOT}/replay/${split}_${c.id}.json`; await atomicJson(outputPath, row);
      output.push({ split, id: c.id, path: outputPath, sha256: await fileSha(outputPath), ratesDelta: row.ratesDeltaBoundedMinusOriginal,
        latencyDeltaMs: row.latencyDeltaMs, assignmentChanges: assignmentsChanged, original: { counts: original.counts, rates: original.rates, latency: original.fiveVerdictLatency },
        bounded: { counts: bounded.counts, rates: bounded.rates, latency: bounded.fiveVerdictLatency },
        naturalResidualCount: residual.reduce((n, r) => n + r.residualCount, 0), consumptionViolations: 0 });
      console.log(split, c.id, 'agreementDelta', row.ratesDeltaBoundedMinusOriginal.overallVerdictAgreement);
    }
  }
  await atomicJson(`${ROOT}/replay_summary.json`, { phase: PHASE, classification: 'POST_XC2_DIAGNOSTIC_ONLY_NOT_FRESH_EVALUATION', freezeDigest: digest(freeze), rows: output, originalDispositionUnchanged: true });
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await runReplay();
