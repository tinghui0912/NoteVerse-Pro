import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { atomicJson, fileSha, digest } from './xc1_artifacts.mjs';
import { describe } from './robust_runtime_evidence_analysis.mjs';

export const PHASE = 'PHASE_9G_XC2_R1_BOUNDED_FINALIZATION_AND_RUNTIME_DECONFOUNDING';
export const OLD_ROOT = 'backend/data/work/xc2_robust_product_baseline_v1';
export const ROOT = 'backend/data/work/xc2_r1_bounded_runtime';
export const load = async file => JSON.parse(await readFile(file, 'utf8'));
export function components(items) {
  const result = [];
  for (const item of [...items].sort((a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id))) {
    let last = result.at(-1);
    if (!last || item.start > last.end) { last = { start: item.start, end: item.end, items: [] }; result.push(last); }
    last.end = Math.max(last.end, item.end); last.items.push(item);
  }
  return result;
}
export function scenarioComponents(scenario) {
  const groups = new Map(), pitches = new Map();
  for (const s of scenario.expected) {
    if (!groups.has(s.groupId)) groups.set(s.groupId, { id: s.groupId, start: s.timeMs - 250, end: s.timeMs + 250, strikes: [] });
    const g = groups.get(s.groupId); g.start = Math.min(g.start, s.timeMs - 250); g.end = Math.max(g.end, s.timeMs + 250); g.strikes.push(s);
    if (!pitches.has(s.pitch)) pitches.set(s.pitch, []);
    pitches.get(s.pitch).push({ ...s, id: s.strikeId, start: s.timeMs - 250, end: s.timeMs + 250 });
  }
  return { groups, all: components([...groups.values()]), same: [...pitches].flatMap(([pitch, strikes]) => components(strikes).map(c => ({ ...c, pitch }))) };
}
function componentSummary(list) {
  return { componentCount: list.length, memberCount: describe(list.map(c => c.items.length)),
    spanMs: describe(list.map(c => c.end - c.start)),
    transitiveClosureBeyondMemberDeadlineMs: describe(list.flatMap(c => c.items.map(s => c.end - s.end))) };
}
export function analyticalQueue(rows, service) {
  let finish = -Infinity;
  return rows.map(row => { const start = Math.max(row.receiveTimestamp, finish); const delay = start - row.receiveTimestamp;
    finish = start + service(row); return delay; });
}
export async function diagnose() {
  const reports = 'backend/research/reports';
  const historicalFiles = (await readdir(reports)).filter(n => n.startsWith('phase9g_xc2_') && !n.startsWith('phase9g_xc2_r1_')).sort();
  const historical = [];
  for (const n of historicalFiles) historical.push({ path: `${reports}/${n}`, sha256: await fileSha(`${reports}/${n}`) });
  const truth = await load(`${OLD_ROOT}/evaluation_benchmark.json`);
  const metrics = await load(`${OLD_ROOT}/metrics/evaluation/LINEAR_A_600_220.json`);
  const audits = new Map(metrics.audit.map(a => [a.scenarioId, a]));
  const all = [], same = [], examples = Object.fromEntries(['MISSING', 'WRONG', 'INCOMPLETE_CHORD', 'CORRECT'].map(k => [k, []]));
  for (const clip of truth.clips) {
    const raw = await load(`${OLD_ROOT}/raw/EVALUATION_LINEAR_600_220_1.20.1/${clip.clipId}.json`);
    for (const scenario of clip.scenarios) {
      const c = scenarioComponents(scenario); all.push(...c.all); same.push(...c.same);
      const audit = audits.get(scenario.id);
      for (const groupId of scenario.targetGroupIds) {
        const v = audit.verdicts.find(v => v.groupId === groupId);
        if (!examples[v?.verdict]) continue;
        const group = c.groups.get(groupId), relevant = c.same.filter(x => x.items.some(s => s.groupId === groupId));
        const whole = c.all.find(x => x.items.some(g => g.id === groupId));
        const required = v.verdict === 'CORRECT' ? Math.max(...relevant.map(x => x.end)) : Math.max(whole.end, ...relevant.map(x => x.end));
        const localPub = raw.publications.A.find(p => p.analyzedThroughPerformanceMs >= group.end) ?? raw.publications.A.at(-1);
        const affected = v.verdict === 'CORRECT' ? relevant.flatMap(x => x.items.map(s => ({ id: s.groupId, start: s.start, end: s.end }))) : whole.items;
        const later = affected.filter(g => g.end > group.end);
        examples[v.verdict].push({ clipId: clip.clipId, scenarioId: scenario.id, targetGroup: groupId,
          targetEventTimeMs: v.performanceTimeMs, localLegalDeadlineMs: group.end, actualFinalizationTimeMs: v.finalizationTimeMs,
          latencyMs: v.finalizationLatencyMs, componentRequiredFrontierMs: required,
          componentStartMs: v.verdict === 'CORRECT' ? Math.min(...relevant.map(x => x.start)) : whole.start,
          componentEndMs: required, groupsInComponent: [...new Set(affected.map(g => g.id))],
          laterGroupsForcingComponentWait: later.map(g => ({ groupId: g.id, legalStartMs: g.start, legalEndMs: g.end,
            canConsumeAnyEvidenceInTargetLegalInterval: g.start <= group.end && g.end >= group.start })),
          directTransitiveDelayMs: Math.max(0, required - group.end),
          firstLocalDeadlineCoveredPublication: { publicationId: localPub.publicationId, availabilityTimeMs: localPub.availabilityTimeMs },
          avoidableWaitAfterLocalPublicationMs: Math.max(0, v.finalizationTimeMs - localPub.availabilityTimeMs) });
      }
    }
  }
  const runtime = [];
  const receipt = await load(`${reports}/phase9g_xc2_causal_execution_receipts_2026-10-16.json`);
  // Read unique raw streams, never counterfactual-replay copies, for runtime.
  const rawDir = `${OLD_ROOT}/raw`;
  for (const dir of (await readdir(rawDir)).filter(d => d.startsWith('EVALUATION_')).sort()) {
    for (const file of (await readdir(`${rawDir}/${dir}`)).filter(n => n.endsWith('.json')).sort()) {
      const raw = await load(`${rawDir}/${dir}/${file}`), rows = raw.runtime.runtimeRows;
      const decoders = Object.fromEntries(Object.entries(raw.publications).map(([k, pubs]) => [k, describe(pubs.map(p => p.decoderProcessingMs))]));
      runtime.push({ path: `${rawDir}/${dir}/${file}`, clipId: raw.clipId, resampler: raw.resampler, ownedMs: raw.ownedMs, futureMs: raw.futureMs,
        pureOrtMs: describe(rows.map(r => r.ortSessionRunDurationMs)), decoderProcessingMs: decoders,
        totalResearchHarnessMs: describe(rows.map(r => r.processingMs)),
        nonOrtCriticalPathOverheadMs: describe(rows.map(r => r.processingMs - r.ortSessionRunDurationMs)),
        measuredResearchQueueMs: describe(rows.map(r => r.queueDelayMs)),
        analyticalPureOrtQueueMs: describe(analyticalQueue(rows, r => r.ortSessionRunDurationMs)),
        analyticalOrtPlusDecoderAQueueMs: describe(analyticalQueue(rows, (r) => r.ortSessionRunDurationMs + (raw.publications.A?.[rows.indexOf(r)]?.decoderProcessingMs ?? 0))),
        overheadAttribution: 'Base64 conversion, IPC, raw writes, hashing and all decoder work share this overhead; historical receipt does not separately instrument these stages.',
        analyticalQualification: 'COUNTERFACTUAL_SERVICE_QUEUE_SIMULATION_NOT_MEASURED_RUNTIME_QUALIFICATION' });
    }
  }
  const result = { phase: PHASE, startingHead: '16bed4591e4ee135578b3a283373517bdd15029b',
    status: 'EXISTING_EVIDENCE_ANALYSIS_NO_NEW_MODEL_INFERENCE', historicalFiles: historical, historicalFilesDigest: digest(historical),
    originalDisposition: 'ROBUST_PRODUCT_BASELINE_MULTIPLE_PARETO_CANDIDATES',
    originalSevenClassification: 'OBSERVATIONAL_PARETO_UNDER_ORIGINAL_XC2_FINALIZATION_AND_RESEARCH_RUNTIME_HARNESS',
    componentWeighting: 'Scenario-expanded baseline EVALUATION components; repeated physical clips are not independent replicates.',
    samePitchComponents: componentSummary(same), allGroupWrongComponents: componentSummary(all),
    examples: Object.fromEntries(Object.entries(examples).map(([k, rows]) => [k, rows.sort((a, b) => b.directTransitiveDelayMs - a.directTransitiveDelayMs).slice(0, 5)])),
    runtime, priorReceiptSha256: await fileSha(`${reports}/phase9g_xc2_causal_execution_receipts_2026-10-16.json`),
    originalRuntimeReceiptTopLevelKeys: Object.keys(receipt),
    interpretation: 'Component closure creates score-time holds independent of ORT duration. Local-publication comparison removes neural and capture latency from the avoidable hold estimate. No causal claim of GPU/thermal drift.',
    expectedTimelineValidity: 'XC2 beatPosition = physicalPerformanceTimeMs * 120 / 60000; not independent-score early/late timing qualification.',
    productLatencySlo: 'PRODUCT_LATENCY_SLO_NOT_YET_FROZEN' };
  await atomicJson(`${ROOT}/existing_evidence_diagnosis.json`, result);
  return { samePitchComponents: result.samePitchComponents, allGroupWrongComponents: result.allGroupWrongComponents, runtimeStreams: runtime.length,
    examples: Object.fromEntries(Object.entries(result.examples).map(([k, rows]) => [k, rows.map(r => ({ delay: r.directTransitiveDelayMs, latency: r.latencyMs }))])) };
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) console.log(JSON.stringify(await diagnose()));
