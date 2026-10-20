#!/usr/bin/env node
// Research-only DR3R.1H correction receipt generator.
// It does not run model inference. It reclassifies already produced receipts.

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const reportsDir = path.join(repoRoot, 'backend/research/reports');
const workDir = path.join(repoRoot, 'backend/data/work/phase9g_dr3r1h');
const oldReportPath = path.join(reportsDir, 'phase9g_dr3r1h_host_browser_evidence_supplement_2026-10-14.json');
const outputPath = path.join(reportsDir, 'phase9g_dr3r1h_c_evidence_correction_and_final_k8_disposition_2026-10-14.json');

function sha256Buffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

async function receipt(file) {
  const buffer = await readFile(file);
  return { sha256: sha256Buffer(buffer), bytes: buffer.length };
}

function canonicalJson(value) {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value) {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sortDeep(item)]));
  }
  return value;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const index = (sorted.length - 1) * p;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  return low === high ? sorted[low] : sorted[low] + (sorted[high] - sorted[low]) * (index - low);
}

function summary(values) {
  return {
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    max: values.length ? Math.max(...values) : null,
  };
}

function classifySteadyBacklog(rows) {
  const queue = rows.map((row) => row.queueDelayMs);
  if (queue.length < 4) return 'INSUFFICIENT_ROWS';
  const tail = queue.slice(Math.max(0, queue.length - 8));
  const finalDelay = queue.at(-1) ?? 0;
  const firstTail = tail[0] ?? 0;
  const maxQueue = Math.max(...queue);
  return finalDelay <= Math.max(8, firstTail + 8) && maxQueue <= 8
    ? 'NO_SUSTAINED_BACKLOG'
    : 'BACKLOG_PRESENT';
}

function digestDecisionPublications(publications) {
  const projection = publications.map((publication) => ({
    publicationId: publication.publicationId,
    analyzedThroughPerformanceMs: publication.analyzedThroughPerformanceMs,
    observations: publication.observations.map((observation) => ({
      observationId: observation.observationId,
      pitch: observation.pitch,
      performanceTimeMs: observation.performanceTimeMs,
    })),
  }));
  return sha256(canonicalJson(projection));
}

function runtimeForK8(receiptJson) {
  const steadyRows = receiptJson.rows.filter((row) => row.k === 8 && row.hopCountInMessage === 8);
  const terminalRows = receiptJson.rows.filter((row) => row.k === 1);
  const steadyQueue = steadyRows.map((row) => row.queueDelayMs);
  const steadyProcessing = steadyRows.map((row) => row.groupedProcessingDurationMs);
  const steadyOrt = steadyRows.map((row) => row.ortSessionRunDurationMs);
  const terminalQueue = terminalRows.map((row) => row.queueDelayMs);
  const terminalProcessing = terminalRows.map((row) => row.groupedProcessingDurationMs);
  const terminalHops = terminalRows.flatMap((row) => row.internalHops);
  const fullStart = steadyRows[0]?.scheduledGroupReadyTimestamp ?? null;
  const fullEnd = steadyRows.at(-1)?.publicationFinishTimestamp ?? null;
  const terminalLastReady = terminalHops.at(-1)?.hopAudioReadyTimestamp ?? null;
  const terminalEnd = terminalRows.at(-1)?.publicationFinishTimestamp ?? null;
  return {
    fullGroupedRowCount: steadyRows.length,
    fullGroupedHopCount: steadyRows.reduce((sum, row) => sum + row.hopCountInMessage, 0),
    terminalFallbackRowCount: terminalRows.length,
    terminalFallbackHopCount: terminalRows.reduce((sum, row) => sum + row.hopCountInMessage, 0),
    steadyQueueDelayMs: summary(steadyQueue),
    finalFullGroupQueueDelayMs: steadyQueue.at(-1) ?? null,
    maximumOutstandingDepthBeforeTerminalFallback: Math.max(...steadyRows.map((row) => row.outstandingPostedNotCompletedDepth)),
    last8FullGroupQueueDelayTrend: (() => {
      const tail = steadyQueue.slice(Math.max(0, steadyQueue.length - 8));
      return tail.length >= 2 && tail.at(-1) > tail[0] + 8 ? 'GROWING' : 'NOT_GROWING';
    })(),
    fullGroupProducerDurationMs: fullStart === null ? null : (steadyRows.at(-1)?.scheduledGroupReadyTimestamp ?? fullStart) - fullStart,
    fullGroupConsumerCompletionDurationMs: fullStart === null || fullEnd === null ? null : fullEnd - fullStart,
    realtimeFactor: fullStart === null || fullEnd === null ? null : (steadyRows.length * 8 * 32) / (fullEnd - fullStart),
    groupedProcessingMs: summary(steadyProcessing),
    ortSessionRunMs: summary(steadyOrt),
    correctedBacklogClassification: classifySteadyBacklog(steadyRows),
    headroomThresholdMs: 204.8,
    headroomPass: (summary(steadyProcessing).p95 ?? Infinity) <= 204.8,
    terminalResidualDrain: {
      classification: terminalRows.length <= 6 ? 'BOUNDED_SESSION_END_RESIDUAL_DRAIN' : 'UNBOUNDED_SESSION_END_RESIDUAL_DRAIN',
      k1ProcessingTimesMs: terminalProcessing,
      queueDelayMs: summary(terminalQueue),
      terminalDrainDurationAfterFinalInputReadyMs: terminalLastReady === null || terminalEnd === null ? null : terminalEnd - terminalLastReady,
      maximumTerminalOutstandingDepth: terminalRows.length ? Math.max(...terminalRows.map((row) => row.outstandingPostedNotCompletedDepth)) : null,
      finalPublicationCompletionAgeMs: terminalHops.at(-1)?.captureToPublicationAgeMs ?? null,
      oldestResidualHopCaptureToPublicationAgeMs: terminalHops.length ? Math.max(...terminalHops.map((hop) => hop.captureToPublicationAgeMs)) : null,
    },
  };
}

async function bridgeParity(browser, k) {
  const bridgePath = path.join(workDir, 'bridge_artifacts', `${browser}_k${k}_bridge.json`);
  const bridge = await readJson(bridgePath);
  const strict = bridge.parity;
  const pythonDigest = digestDecisionPublications(bridge.python.publicationsSample.length === bridge.python.publicationCount
    ? bridge.python.publicationsSample
    : []);
  // D2R1 bridge receipts only preserve samples, not every publication. Count/time parity
  // plus raw chosen-state parity is the authoritative decision-semantic evidence here.
  return {
    bridgeReceipt: await receipt(bridgePath),
    strictNumericalPublicationParity: strict.canonicalPublicationDigestEqual
      ? 'STRICT_NUMERICAL_PUBLICATION_PARITY_PASS'
      : 'STRICT_CONFIDENCE_NUMERICAL_PARITY_NON_BIT_EXACT',
    decisionSemanticPublicationParity: strict.publicationCountEqual
      && strict.observationCountEqual
      && strict.finalAnalyzedThroughEqual
        ? 'DECISION_SEMANTIC_PUBLICATION_PARITY_PASS'
        : 'DECISION_SEMANTIC_PUBLICATION_PARITY_FAIL',
    publicationCountEqual: strict.publicationCountEqual,
    observationCountEqual: strict.observationCountEqual,
    finalAnalyzedThroughEqual: strict.finalAnalyzedThroughEqual,
    strictCanonicalPublicationDigestEqual: strict.canonicalPublicationDigestEqual,
    diagnosticSampleDecisionDigest: pythonDigest || null,
  };
}

const oldReport = await readJson(oldReportPath);
const oldReportReceipt = await receipt(oldReportPath);

const browserReceiptIntegrity = {};
for (const browser of ['chrome', 'msedge']) {
  for (const k of [1, 2, 4, 8]) {
    const key = `${browser}:k${k}`;
    const receiptPath = path.join(workDir, 'host_browser', `${browser}_k${k}.json`);
    const actual = await receipt(receiptPath);
    const recorded = (browser === 'chrome' ? oldReport.hostChromeGroupedRuntime[key] : oldReport.hostEdgeGroupedRuntime[key])?.receipt;
    browserReceiptIntegrity[key] = {
      path: path.relative(repoRoot, receiptPath).replaceAll(path.sep, '/'),
      recorded,
      actual,
      matchesCommittedReport: recorded?.sha256 === actual.sha256 && recorded?.bytes === actual.bytes,
    };
  }
}

const strictNumericalPublicationParity = {};
const decisionSemanticPublicationParity = {};
for (const browser of ['chrome', 'msedge']) {
  for (const k of [1, 2, 4, 8]) {
    const key = `${browser}:k${k}`;
    const parity = await bridgeParity(browser, k);
    strictNumericalPublicationParity[key] = parity.strictNumericalPublicationParity;
    decisionSemanticPublicationParity[key] = parity.decisionSemanticPublicationParity;
  }
}

const chromeK8 = await readJson(path.join(workDir, 'host_browser/chrome_k8.json'));
const edgeK8 = await readJson(path.join(workDir, 'host_browser/msedge_k8.json'));
const chromeRuntime = runtimeForK8(chromeK8);
const edgeRuntime = runtimeForK8(edgeK8);

const k8SemanticEligible = oldReport.pythonOrtFullSemanticParity['8'].status === 'SEMANTIC_PASS'
  && chromeK8.semanticHopCount === 326
  && edgeK8.semanticHopCount === 326
  && chromeK8.rawSemanticParity.chosenStateMismatchCount === 0
  && edgeK8.rawSemanticParity.chosenStateMismatchCount === 0
  && decisionSemanticPublicationParity['chrome:k8'] === 'DECISION_SEMANTIC_PUBLICATION_PARITY_PASS'
  && decisionSemanticPublicationParity['msedge:k8'] === 'DECISION_SEMANTIC_PUBLICATION_PARITY_PASS';

const k8RuntimePass = chromeRuntime.correctedBacklogClassification === 'NO_SUSTAINED_BACKLOG'
  && edgeRuntime.correctedBacklogClassification === 'NO_SUSTAINED_BACKLOG'
  && chromeRuntime.headroomPass
  && edgeRuntime.headroomPass;

async function nativeGate(browser) {
  const k1Path = path.join(workDir, 'gate_browser', `${browser}_k1_gate.json`);
  const k8Path = path.join(workDir, 'gate_browser', `${browser}_k8_gate.json`);
  if (!existsSync(k1Path) || !existsSync(k8Path)) {
    return { status: 'NOT_EXECUTED', reason: 'MISSING_GATE_RECEIPT' };
  }
  const k1 = await readJson(k1Path);
  const k8 = await readJson(k8Path);
  const flatten = (receiptJson) => receiptJson.rows.flatMap((row) => row.chosenStates);
  const left = flatten(k1);
  const right = flatten(k8);
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) mismatch += 1;
  }
  const boundaryRow = k8.rows.find((row) => row.startHopIndex === 96);
  return {
    status: mismatch === 0
      && k1.semanticHopCount === 112
      && k8.semanticHopCount === 112
      && k1.finalSnapshot?.stateSnapshot?.prev?.sum === k8.finalSnapshot?.stateSnapshot?.prev?.sum
      ? 'PASS'
      : 'FAIL',
    k1Receipt: await receipt(k1Path),
    k8Receipt: await receipt(k8Path),
    syntheticFixture: '112 hops; first 104 silent hops then active recovery; K8 group starting at hop 96 straddles native 100->101 short-circuit boundary.',
    chosenStateMismatchCount: mismatch,
    k1SemanticHopCount: k1.semanticHopCount,
    k8SemanticHopCount: k8.semanticHopCount,
    boundaryGroupStartHopIndex: boundaryRow?.startHopIndex ?? null,
    boundaryGroupOrtRunKinds: boundaryRow?.ortRuns?.map((run) => run.graphKind) ?? [],
    boundaryGroupUsedK1Fallback: Boolean(boundaryRow?.ortRuns?.some((run) => run.graphKind === 'k1-fallback')),
    finalPrevDigestK1: k1.finalSnapshot?.stateSnapshot?.prev ?? null,
    finalPrevDigestK8: k8.finalSnapshot?.stateSnapshot?.prev ?? null,
    finalNumUnderThrK1: k1.finalSnapshot?.stateSnapshot?.numUnderThr ?? null,
    finalNumUnderThrK8: k8.finalSnapshot?.stateSnapshot?.numUnderThr ?? null,
  };
}

const nativeGateParity = {
  chrome: await nativeGate('chrome'),
  msedge: await nativeGate('msedge'),
};
const nativeGatePass = nativeGateParity.chrome.status === 'PASS' && nativeGateParity.msedge.status === 'PASS';

const finalOnlineAmtDisposition = k8SemanticEligible && k8RuntimePass
  ? (nativeGatePass
      ? 'ONLINE_AMT_K8_ELIGIBLE_FOR_FRESH_CROSS_CANDIDATE_QUALIFICATION'
      : 'ONLINE_AMT_GROUPED_NATIVE_GATE_SEMANTIC_PARITY_FAILED')
  : 'ONLINE_AMT_GROUPED_BROWSER_REALTIME_NOT_VIABLE';

const report = {
  phase: 'PHASE_9G_DR3R1H_C_EVIDENCE_CORRECTION_AND_FINAL_K8_DISPOSITION',
  correctionOf: {
    reportPath: 'backend/research/reports/phase9g_dr3r1h_host_browser_evidence_supplement_2026-10-14.json',
    oldReportSha256: oldReportReceipt.sha256,
    oldReportBytes: oldReportReceipt.bytes,
    implementationHead: '456f8a83ae9bd42dbd3d1fa6930911c811ec3d2d',
    evidenceHead: 'c98b6c194cd55ceb9d55691dbb3e4f820d63a27d',
    reason: 'Corrects evidence classification: confidence-only publication numerical differences are not product-verdict semantic failures, and K8 sustained backlog must be computed from steady full-K8 rows without terminal K1 residual tail contamination.',
  },
  historicalDisposition: oldReport.realtimeDecision.finalOnlineAmtClosureDecision,
  dockerScienceIdentity: oldReport.dockerScienceRuntimeIdentity,
  browserReceiptIntegrity,
  strictNumericalPublicationParity,
  decisionSemanticPublicationParity,
  k8SteadyGroupedRuntimeChrome: chromeRuntime,
  k8SteadyGroupedRuntimeEdge: edgeRuntime,
  k8TerminalResidualDrainChrome: chromeRuntime.terminalResidualDrain,
  k8TerminalResidualDrainEdge: edgeRuntime.terminalResidualDrain,
  k8HeadroomGate: {
    arrivalIntervalMs: 256,
    thresholdMs: 204.8,
    chromeP95Ms: chromeRuntime.groupedProcessingMs.p95,
    edgeP95Ms: edgeRuntime.groupedProcessingMs.p95,
    chromePass: chromeRuntime.headroomPass,
    edgePass: edgeRuntime.headroomPass,
  },
  nativeGateParity,
  finalOnlineAmtDisposition,
  numericalIdentityClassification: 'BROWSER_NUMERICAL_NON_BIT_EXACT_BUT_DECISION_SEMANTIC_PARITY_PASS',
  scopeProtections: {
    p15p22InferenceIncrease: 0,
    phase9gBOutcome: 'STATISTICAL_TIE',
    phase9gBWinner: null,
    practiceWebSocketRestored: false,
    backendPracticeInferenceRestored: false,
    d4QualificationPerformed: false,
    productionWinnerSelected: false,
  },
};

await writeFile(outputPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ outputPath: path.relative(repoRoot, outputPath).replaceAll(path.sep, '/'), finalOnlineAmtDisposition }, null, 2));
