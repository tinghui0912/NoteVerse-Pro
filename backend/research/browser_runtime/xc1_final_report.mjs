#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { REPO_ROOT, RUNTIME_NODE_MODULES } from './xc1_browser_runtime_shared.mjs';
import { atomicJson, PHASE, fileSha } from './xc1_artifacts.mjs';
const freezePath = process.argv[2];
const freeze = JSON.parse(await readFile(freezePath, 'utf8'));
const root = path.join(REPO_ROOT, freeze.runRoot);
const read = async name => JSON.parse(await readFile(path.join(root, name), 'utf8'));
const stageB = await read('stage_b.json');
const currentHead = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const git = args => execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
const tiePath = 'backend/research/reports/phase9g_b3_official_product_blind_replacement_result_2026-10-11.json';
const tie = JSON.parse(await readFile(path.join(REPO_ROOT, tiePath), 'utf8'));
if (tie.benchmarkOutcome !== 'STATISTICAL_TIE' || tie.winner !== null
  || git(['rev-parse', `${freeze.startingRemoteHead}:${tiePath}`]) !== git(['rev-parse', `HEAD:${tiePath}`])) throw new Error('XC1_HISTORICAL_PROTECTION_FAILED');
const { createJiti } = createRequire(import.meta.url)(path.join(RUNTIME_NODE_MODULES, 'jiti'));
const capability = createJiti(import.meta.url)(path.join(REPO_ROOT, 'apps/customer-web/src/lib/practice/input-capability.ts'));
const actual = capability.evaluatePracticeInputCapabilities();
const productMic = capability.getSelectedMicrophoneCapability({ ...actual, microphoneCapture: { supported: true, status: 'AVAILABLE' } }, 'CONTINUOUS_PLAY');
if (productMic.supported) throw new Error('XC1_PRODUCTION_MICROPHONE_PROTECTION_FAILED');
const productionChanges = git(['diff', '--name-only', freeze.startingRemoteHead, 'HEAD', '--', 'backend/app', 'apps/customer-web/src'])
  .split('\n').filter(file => file && !file.endsWith('.test.ts') && !file.endsWith('.test.tsx'));
if (productionChanges.length) throw new Error('XC1_UNEXPECTED_PRODUCT_IMPLEMENTATION_CHANGE');
async function github(endpoint) {
  const response = await fetch(`https://api.github.com/repos/tinghui0912/NoteVerse-Pro/${endpoint}`, { headers: { 'User-Agent': 'NoteVerse-XC1-evidence', Accept: 'application/vnd.github+json' } });
  return { httpStatus: response.status, body: await response.json() };
}
const runtime = await read('runtime_report.json');
const seal = await read('seals/primary_chrome.json');
const edge = await read('edge_parity.json');
const compactRuntime = Object.fromEntries(Object.entries(runtime.candidates).map(([candidate, value]) => [candidate, {
  runtimeEligible: value.runtimeEligible, xc1DeploymentIdentitySha256: value.xc1DeploymentIdentitySha256,
  receipts: value.receipts.map(({ steadyRows: _steady, terminalResidualRows, ...row }) => ({ ...row,
    terminalResidualGroupCount: terminalResidualRows.length })) }]));
const report = { phase: PHASE, startingRemoteHead: freeze.startingRemoteHead,
  historicalF4Invalidation: freeze.historicalF4, r3cReportReclassifications: freeze.r3cReclassifications,
  implementationCommitI5: freeze.implementationCommitI5, prospectiveFreezeCommitF5: currentHead,
  evidenceCommitE5: { resolution: 'commit containing this evidence-only report; SHA reported after push' },
  candidateIdentities: freeze.candidateIdentities, sourceHashBoundary: freeze.sourceHashBoundary,
  robustSelectedOrtVersion: freeze.robustSelectedOrtWebVersion, robustRuntimeAb: freeze.robustAb,
  semanticAcceptance: freeze.semanticParity, productionPathDryRun: freeze.productionPathDryRun,
  canonicalPcmVerification: freeze.canonicalPcmVerification, truthIsolation: freeze.truthIsolation,
  primaryCoverage: { expectedCells: seal.expectedCellCount, actualSuccessfulCells: seal.cells.filter(row => row.status === 'XC1_STAGE_A_SCIENTIFIC_PREDICTION_COMPLETE').length },
  primarySeal: { canonicalSha256: seal.artifactCanonicalSha256, filesystemSha256: await fileSha(path.join(root, 'seals/primary_chrome.json')), cells: seal.cells },
  persistedTruthReveal: await read('truth_reveal.json'), runtimeEvidence: compactRuntime, edgeEvidence: edge,
  primary50ms: stageB.primary50ms, sensitivity25ms: stageB.sensitivity25ms, sensitivity100ms: stageB.sensitivity100ms,
  pairedBootstrap: stageB.pairedBootstrap, scientificDisposition: stageB.scientificFrontRunnerDecision,
  aggregateMetricsByTolerance: stageB.aggregateMetricsByTolerance,
  knownEvidenceLimitations: ['Scientific SMD non-commercial evaluation only.', 'NO_DOCUMENTED_OVERLAP is not proof of disjoint training data.',
    'Browser probabilities are non-bit-exact; measured numerical deltas retained.', 'Performer and repeated piece clustering unavailable; take-level bootstrap.',
    'No absolute product feedback latency SLO is established.'], commercialQualificationStatus: 'NOT_PERFORMED',
  scopeProtections: { phase9GB: { outcome: tie.benchmarkOutcome, winner: tie.winner, gitBlobUnchanged: true },
    productionMicrophone: productMic.supported, productionChanges, inferenceTakeIds: [...new Set(seal.cells.map(row => row.takeId))],
    p15p22InferenceIncrease: seal.cells.filter(row => /(?:^|[-_:])p(?:1[5-9]|2[0-2])(?:$|[-_:])/i.test(row.takeId)).length,
    noD4: true, productionWinnerSelected: false, practiceWebSocketRestored: false, backendPracticeInferenceRestored: false },
  githubStatusesAndWorkflowRuns: { queriedHead: currentHead,
    combinedStatus: await github(`commits/${currentHead}/status`), workflowRuns: await github(`actions/runs?head_sha=${currentHead}&per_page=100`) } };
const output = path.join(REPO_ROOT, 'backend/research/reports/phase9g_xc1_r3d_f5_full_scientific_result_2026-10-14.json');
await atomicJson(output, report);
console.log(JSON.stringify({ report: output, scientificDisposition: report.scientificDisposition }));
