import { readFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, WORK, PHASE, newJson, hash } from './continuous-runtime-protocol.mjs';
const id = process.argv[2];
if (id !== 'v1') throw new Error('UNEXPECTED_INVALIDATION_TARGET');
const work = path.join(WORK, id), failure = JSON.parse(await readFile(path.join(work, 'browser_failure.json'), 'utf8'));
const reports = path.join(ROOT, 'backend/research/reports');
await copyFile(path.join(work, 'browser_failure.json'), path.join(reports, 'continuous_microphone_browser_invalid_v1_2026-10-17.json'));
await copyFile(path.join(work, 'verification/verification.json'), path.join(reports, 'continuous_microphone_verification_invalid_v1_2026-10-17.json'));
await newJson(path.join(reports, 'continuous_microphone_runtime_invalidation_v1_2026-10-17.json'), {
  phase: PHASE, status: 'INVALIDATED_QUALIFICATION_EVIDENCE_NOT_REUSABLE_FOR_ACCEPTANCE',
  invalidatedAt: new Date().toISOString(), freeze: failure.proof, executionStartedAt: failure.executionStartedAt,
  reason: 'QUALIFICATION_HARNESS_MISCLASSIFIED_PINNED_ORT_SHAPE_CPU_WARNINGS_AS_ERRORS',
  runtimeSourceChangeRequired: false, modelIdentityChange: false, productCoreChange: false,
  actualModelRuns: failure.completedResults.reduce((n, r) => n + r.result.snapshot.diagnostics.at(-1).actualSessionRunCount, 0),
  completedSourceRates: failure.completedResults.map(r => r.rate),
  originalFailureSha256: hash(await readFile(path.join(work, 'browser_failure.json'))),
  nextAction: 'Tooling-only repair, new implementation/tooling commit, new prospective remote freeze, full tests/build and both browser rates rerun. No old acceptance evidence reused.',
});
