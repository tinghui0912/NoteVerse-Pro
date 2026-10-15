import { createRequire } from 'node:module';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { REPO_ROOT, RUNTIME_NODE_MODULES } from './xc1_browser_runtime_shared.mjs';
import { describe } from './robust_runtime_evidence_analysis.mjs';
import { classifyBacklog } from './xc1_browser_semantics.mjs';
import { inclusiveFrontier } from './xc2_decoders.mjs';
const { createJiti } = createRequire(import.meta.url)(path.join(RUNTIME_NODE_MODULES, 'jiti'));
const jiti = createJiti(import.meta.url);
const { ResearchFiveVerdictProjector } = jiti(path.join(REPO_ROOT, 'apps/customer-web/src/lib/practice/research/xc2-five-verdict-projector.ts'));
const { assignObservedAttacksToExpectedStrikes } = jiti(path.join(REPO_ROOT, 'apps/customer-web/src/lib/practice/audio-analysis/continuous/performance-reconciler.ts'));
export const CLASSES = ['CORRECT', 'MISSING', 'WRONG', 'INCOMPLETE_CHORD', 'EXTRA'];
export function pitchName(midi) { return ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][midi % 12] + (Math.floor(midi / 12) - 1); }
export function latencySummary(values) {
  const ms = describe(values);
  return { ms, beats: Object.fromEntries([60, 90, 120, 160].map(bpm => [bpm,
    Object.fromEntries(['p50', 'p95', 'p99', 'max'].map(key => [key, ms[key] === null ? null : ms[key] * bpm / 60000]))])) };
}
export function replay(scenario, publications) {
  const expected = scenario.expected.map((strike, i) => ({ strikeId: strike.strikeId, groupId: strike.groupId,
    pitch: pitchName(strike.pitch), expectedPerformanceTimeMs: scenario.beatPositions[i] * 60000 / scenario.fixedBpm, renderNoteIds: [] }));
  const ledger = new ResearchFiveVerdictProjector(expected);
  for (const pub of publications) ledger.publish({ ...pub, observations: pub.observations.map(event => ({
    observationId: event.observationId, pitch: pitchName(event.pitch), performanceTimeMs: event.performanceTimeMs,
    confidence: event.confidence, source: 'ACOUSTIC', availabilityTimeMs: pub.availabilityTimeMs })) });
  const last = publications.at(-1);
  const result = ledger.completeNaturalScope(last.analyzedThroughPerformanceMs, last.availabilityTimeMs);
  const consumed = result.verdicts.flatMap(row => row.consumedObservationIds);
  if (new Set(consumed).size !== consumed.length || result.lowLevel.strikes.some(s => s.verdict === 'PENDING')) throw new Error('XC2_CONSUMPTION_OR_FINALITY_AUDIT_FAILED');
  return result;
}

export function oraclePublications(notes) {
  const byTime = new Map();
  for (const note of notes.filter(n => n.timeMs >= 1380 && n.timeMs < 27780)) {
    if (!byTime.has(note.timeMs)) byTime.set(note.timeMs, []);
    byTime.get(note.timeMs).push({ observationId: note.id, pitch: note.pitch, performanceTimeMs: note.timeMs, confidence: 1, availabilityTimeMs: note.timeMs });
  }
  return [...byTime].sort((a, b) => a[0] - b[0]).map(([time, observations]) => ({ publicationId: `oracle:${time}`,
    analyzedThroughPerformanceMs: time, availabilityTimeMs: time, observations }))
    .concat([{ publicationId: 'oracle:end', analyzedThroughPerformanceMs: inclusiveFrontier(27780), availabilityTimeMs: 27780, observations: [] }]);
}

export function validateCounterfactuals(truth) {
  return { ...truth, clips: truth.clips.map(clip => {
    const publications = oraclePublications(clip.notes), exclusions = [];
    const scenarios = clip.scenarios.filter(scenario => {
      const reference = replay(scenario, publications);
      const valid = scenario.targetGroupIds.every(id => reference.verdicts.some(v => v.groupId === id && v.verdict === scenario.conceptualTargetVerdict))
        && scenario.targetExtra.every(note => reference.verdicts.some(v => v.verdict === 'EXTRA' && v.evidenceObservationIds.includes(note.id)));
      if (!valid) exclusions.push({ scenarioId: scenario.id, reason: 'PHYSICAL_MIDI_ORACLE_COUNTERFACTUAL_AMBIGUITY', candidateOutputUsed: false });
      return valid;
    });
    return { ...clip, scenarios, exclusions };
  }) };
}

function matchExtras(expected, actual) {
  return assignObservedAttacksToExpectedStrikes({ assignmentWindowMs: 50,
    expectedStrikes: expected.map((event, index) => ({ strikeId: String(index), groupId: String(index), pitch: event.pitch,
      expectedPerformanceTimeMs: event.performanceTimeMs, renderNoteIds: [] })),
    observedAttacks: actual.map(event => ({ observationId: event.id, pitch: event.pitch,
      performanceTimeMs: event.performanceTimeMs, confidence: 1, source: 'ACOUSTIC' })) });
}

export function evaluateProductVariant(raws, truth, decoder, id) {
  const counts = { targets: 0, agree: 0, correctTP: 0, correctFP: 0, correctFN: 0, missing: 0, missingDetected: 0, missingFalseMatched: 0,
    wrong: 0, wrongDetected: 0, wrongFalseCorrect: 0, incomplete: 0, incompleteDetected: 0, incompleteFalseComplete: 0,
    completeChord: 0, exactChord: 0, extrasTP: 0, extrasPredicted: 0, extrasTruth: 0, expectedAttackTP: 0, expectedAttackTruth: 0 };
  const latencies = Object.fromEntries(CLASSES.map(key => [key, []])), allLatencies = Object.fromEntries(CLASSES.map(key => [key, []]));
  const targetRows = [], audit = [], familyCoverage = {}, perClip = [], runtime = [], acoustic = [];
  for (const clip of truth.clips) {
    const raw = raws.find(row => row.clipId === clip.clipId);
    if (!raw || raw.decoderFailures[decoder]) return { id, decoder, status: 'CANDIDATE_DECODER_EXECUTION_FAILED', error: raw?.decoderFailures[decoder] ?? 'missing clip' };
    const publications = raw.publications[decoder], oracle = oraclePublications(clip.notes);
    const before = { ...counts };
    for (const scenario of clip.scenarios) {
      familyCoverage[scenario.family] = (familyCoverage[scenario.family] ?? 0) + 1;
      const reference = replay(scenario, oracle), actual = replay(scenario, publications);
      const byGroup = new Map(actual.verdicts.filter(row => row.groupId).map(row => [row.groupId, row]));
      const refByGroup = new Map(reference.verdicts.filter(row => row.groupId).map(row => [row.groupId, row]));
      const expectedExtras = reference.verdicts.filter(row => row.verdict === 'EXTRA').map(row => ({ ...row, pitch: pitchName(clip.notes.find(n => n.id === row.evidenceObservationIds[0]).pitch) }));
      const observed = new Map(publications.flatMap(pub => pub.observations).map(event => [event.observationId, event]));
      const actualExtras = actual.verdicts.filter(row => row.verdict === 'EXTRA').map(row => ({ ...row, pitch: pitchName(observed.get(row.evidenceObservationIds[0]).pitch) }));
      const pairs = matchExtras(expectedExtras, actualExtras);
      counts.extrasTP += pairs.size; counts.extrasPredicted += actualExtras.length; counts.extrasTruth += expectedExtras.length;
      counts.expectedAttackTruth += reference.lowLevel.strikes.filter(s => s.verdict === 'MATCHED').length;
      const referenceMatched = new Set(reference.lowLevel.strikes.filter(s => s.verdict === 'MATCHED').map(s => s.strikeId));
      counts.expectedAttackTP += actual.lowLevel.strikes.filter(s => s.verdict === 'MATCHED' && referenceMatched.has(s.strikeId)).length;
      for (const verdict of actual.verdicts) allLatencies[verdict.verdict].push(verdict.finalizationLatencyMs);
      for (const groupId of scenario.targetGroupIds) {
        const wanted = refByGroup.get(groupId), got = byGroup.get(groupId);
        if (!wanted || !got || wanted.verdict !== scenario.conceptualTargetVerdict) throw new Error(`XC2_AMBIGUOUS_COUNTERFACTUAL:${scenario.id}`);
        const expected = wanted.verdict, actualClass = got.verdict, agreement = expected === actualClass;
        counts.targets += 1; counts.agree += Number(agreement);
        if (expected === 'CORRECT') { counts.correctTP += Number(agreement); counts.correctFN += Number(!agreement); }
        else counts.correctFP += Number(actualClass === 'CORRECT');
        if (expected === 'MISSING') { counts.missing += 1; counts.missingDetected += Number(agreement); counts.missingFalseMatched += Number(actualClass === 'CORRECT'); }
        if (expected === 'WRONG') { counts.wrong += 1; counts.wrongDetected += Number(agreement); counts.wrongFalseCorrect += Number(actualClass === 'CORRECT'); }
        if (expected === 'INCOMPLETE_CHORD') { counts.incomplete += 1; counts.incompleteDetected += Number(agreement); counts.incompleteFalseComplete += Number(actualClass === 'CORRECT'); }
        if (scenario.family === 'CORRECT_CHORD') { counts.completeChord += 1; counts.exactChord += Number(actualClass === 'CORRECT'); }
        if (agreement) latencies[expected].push(got.finalizationLatencyMs);
        targetRows.push({ id: scenario.id + ':' + groupId, clipId: clip.clipId, family: scenario.family,
          truth: expected, predicted: actualClass, agreement, latencyMs: got.finalizationLatencyMs });
      }
      for (const extra of scenario.targetExtra) {
        const index = expectedExtras.findIndex(event => event.evidenceObservationIds.includes(extra.id));
        const match = pairs.get(index), got = match === undefined ? null : actualExtras[match];
        counts.targets += 1; counts.agree += Number(!!got);
        if (got) latencies.EXTRA.push(got.finalizationTimeMs - extra.timeMs);
        targetRows.push({ id: scenario.id + ':' + extra.id, clipId: clip.clipId, family: scenario.family,
          truth: 'EXTRA', predicted: got ? 'EXTRA' : 'NOT_DETECTED', agreement: !!got, latencyMs: got ? got.finalizationTimeMs - extra.timeMs : null });
      }
      audit.push({ scenarioId: scenario.id, observationConsumptionCount: actual.observationConsumption.length,
        consumedUnique: true, verdicts: actual.verdicts, lowLevel: actual.lowLevel,
        observationConsumption: actual.observationConsumption });
    }
    perClip.push({ clipId: clip.clipId, counts: Object.fromEntries(Object.keys(counts).map(key => [key, counts[key] - before[key]])) });
    const steady = raw.runtime.runtimeRows.filter(row => !row.shiftedFinalWindow);
    runtime.push({ clipId: clip.clipId, modelLoadMs: raw.runtime.modelLoadMs, firstInferenceMs: raw.runtime.runtimeRows[0].ortSessionRunDurationMs,
      processingMs: describe(steady.map(row => row.processingMs)), arrivalCadenceMs: raw.ownedMs,
      queueDelayMs: describe(steady.map(row => row.queueDelayMs)), backlog: classifyBacklog(steady, raw.ownedMs),
      inputReadyToPublicationMs: describe(steady.map(row => row.publicationFinishTimestamp - row.scheduledReadyTimestamp)),
      historical480MsDiagnostic: describe(steady.map(row => row.processingMs)).p95 <= 480 });
    const physical = clip.notes.filter(n => n.timeMs >= 1380 && n.timeMs < 27780);
    const events = publications.flatMap(pub => pub.observations);
    const matched = assignObservedAttacksToExpectedStrikes({ assignmentWindowMs: 50,
      expectedStrikes: physical.map(n => ({ strikeId: n.id, groupId: n.id, pitch: pitchName(n.pitch), expectedPerformanceTimeMs: n.timeMs, renderNoteIds: [] })),
      observedAttacks: events.map(e => ({ observationId: e.observationId, pitch: pitchName(e.pitch), performanceTimeMs: e.performanceTimeMs, confidence: e.confidence, source: 'ACOUSTIC' })) });
    acoustic.push({ clipId: clip.clipId, physicalOnsets: physical.length, predictedOnsets: events.length, matched50ms: matched.size,
      f1: 2 * matched.size / (physical.length + events.length || 1), evidenceLayer: 'ACOUSTIC_ONSET_TRANSCRIPTION_DIAGNOSTIC_NOT_PRODUCT_CORRECTNESS' });
  }
  return { id, decoder, status: 'PRODUCT_VERDICT_EVALUATION_COMPLETE', counts, rates: rates(counts), familyCoverage, perClip,
    fiveVerdictLatency: Object.fromEntries(CLASSES.map(key => [key, latencySummary(latencies[key])])),
    allFinalizedVerdictLatencyIncludingBackground: Object.fromEntries(CLASSES.map(key => [key, latencySummary(allLatencies[key])])),
    latencyDefinition: 'Targeted correctly-classified verdicts; missing/incorrect classifications counted in correctness, not silently assigned zero latency. All background/incorrect verdict latency is also retained.',
    targetRows, audit, runtime, runtimeSustainable: runtime.every(row => row.backlog.noSustainedBacklog), acousticDiagnostics: acoustic };
}

export function rates(c) {
  const div = (a, b) => b ? a / b : null;
  return { overallVerdictAgreement: div(c.agree, c.targets), correctPrecision: div(c.correctTP, c.correctTP + c.correctFP),
    correctRecall: div(c.correctTP, c.correctTP + c.correctFN), correctMissingRate: div(c.missingDetected, c.missing),
    falseMatchOnGroundTruthMissing: div(c.missingFalseMatched, c.missing), wrongNoteDetection: div(c.wrongDetected, c.wrong),
    wrongNoteFalseCorrect: div(c.wrongFalseCorrect, c.wrong), incompleteChordDetection: div(c.incompleteDetected, c.incomplete),
    falseCompleteChordAcceptance: div(c.incompleteFalseComplete, c.incomplete), chordExactCompleteness: div(c.exactChord, c.completeChord),
    extraPrecision: div(c.extrasTP, c.extrasPredicted), extraRecall: div(c.extrasTP, c.extrasTruth), expectedStrikeRecall: div(c.expectedAttackTP, c.expectedAttackTruth) };
}
export function safetyVector(candidate) {
  if (candidate.status !== 'PRODUCT_VERDICT_EVALUATION_COMPLETE') return null;
  const r = candidate.rates;
  return [r.wrongNoteFalseCorrect, r.falseMatchOnGroundTruthMissing, r.falseCompleteChordAcceptance,
    r.overallVerdictAgreement === null ? null : 1 - r.overallVerdictAgreement,
    r.expectedStrikeRecall === null ? null : 1 - r.expectedStrikeRecall,
    r.extraPrecision === null ? null : 1 - r.extraPrecision, r.extraRecall === null ? null : 1 - r.extraRecall];
}
export function pareto(candidates, includeLatency = false) {
  const usable = candidates.filter(c => safetyVector(c)?.every(Number.isFinite));
  const vector = candidate => [...safetyVector(candidate), ...(includeLatency ? CLASSES.map(k => candidate.fiveVerdictLatency[k].ms.p95 ?? Infinity) : [])];
  return usable.filter(candidate => !usable.some(other => {
    if (other.id === candidate.id) return false;
    const a = vector(other), b = vector(candidate);
    return a.every((v, i) => v <= b[i]) && a.some((v, i) => v < b[i]);
  }));
}

export function pairedClipBootstrap(a, b) {
  const clips = a.perClip.map(row => row.clipId).sort();
  if (JSON.stringify(clips) !== JSON.stringify(b.perClip.map(row => row.clipId).sort())) throw new Error('UNPAIRED_CLIPS');
  const ar = new Map(a.perClip.map(row => [row.clipId, rates(row.counts)])), br = new Map(b.perClip.map(row => [row.clipId, rates(row.counts)]));
  const metrics = ['overallVerdictAgreement', 'wrongNoteFalseCorrect', 'falseMatchOnGroundTruthMissing', 'falseCompleteChordAcceptance'];
  let state = 13371;
  const random = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
  const draws = Object.fromEntries(metrics.map(key => [key, []]));
  for (let i = 0; i < 5000; i += 1) {
    const sample = Array.from({ length: clips.length }, () => clips[Math.floor(random() * clips.length)]);
    for (const metric of metrics) {
      const delta = sample.map(id => ar.get(id)[metric] === null || br.get(id)[metric] === null ? null : ar.get(id)[metric] - br.get(id)[metric]);
      if (delta.every(Number.isFinite)) draws[metric].push(delta.reduce((x, y) => x + y, 0) / delta.length);
    }
  }
  return { candidateA: a.id, candidateB: b.id, unit: 'clip', seed: 13371, draws: 5000, algorithm: 'xorshift32; paired whole-clip resampling; no individual strikes as replicates',
    metrics: Object.fromEntries(metrics.map(metric => {
      const values = draws[metric], sorted = [...values].sort((x, y) => x - y);
      const q = fraction => { const x = (sorted.length - 1) * fraction, lo = Math.floor(x); return sorted[lo] + (sorted[Math.ceil(x)] - sorted[lo]) * (x - lo); };
      return [metric, { validDraws: values.length, ci95: values.length ? [q(.025), q(.975)] : null,
        allDrawsSha256: createHash('sha256').update(JSON.stringify(values)).digest('hex') }];
    })), pairedScenarioDifferences: a.targetRows.map(row => { const other = b.targetRows.find(r => r.id === row.id); if (!other) throw new Error('UNPAIRED_SCENARIOS'); return { id: row.id, agreementDelta: Number(row.agreement) - Number(other.agreement), latencyDeltaMs: row.latencyMs !== null && other.latencyMs !== null ? row.latencyMs - other.latencyMs : null }; }) };
}

export function compactProduct(candidate) { const { audit: _audit, targetRows: _targets, ...summary } = candidate; return summary; }
