#!/usr/bin/env node
// Research-only Phase 9E-A.1 runner/auditor for the ByteDance chunked candidate.
//
// This command intentionally does not integrate with production Practice. It
// verifies local model identity and audits causal-case DEVELOPMENT metadata for
// eligibility as Practice v2 Continuous benchmark scenarios. If no eligible
// scenario exists, it writes a BLOCKED_NOT_RUN artifact instead of manufacturing
// acoustic metrics.

import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const EXPECTED_MODEL_SHA256 = '6ba3bc4e73607f9cd021e69858fd3ff969a3941c7a93876d5be5cedb53038cf5';
const EXPECTED_MODEL_BYTES = 98691493;

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      args[key.slice(2)] = true;
    } else {
      args[key.slice(2)] = value;
      index += 1;
    }
  }
  return args;
}

const args = parseArgs(process.argv);
const repoRoot = path.resolve(args['repo-root'] ?? process.cwd());
const modelPath = path.resolve(repoRoot, args.model ?? 'backend/data/work/bytedance_browser_runtime_feasibility/bytedance_note_model_fixed_anchor.onnx');
const causalManifestPath = path.resolve(repoRoot, args['causal-manifest'] ?? 'backend/data/work/datasets/maestro-v3.0.0/production_step_development_set/public_step_causal_cases_manifest.json');
const outputDir = path.resolve(repoRoot, args['output-dir'] ?? 'backend/research/reports');
const gitHead = String(args['git-head'] ?? 'UNKNOWN');

await mkdir(outputDir, { recursive: true });

const modelIdentity = existsSync(modelPath)
  ? { path: modelPath, sha256: await sha256File(modelPath), bytes: statSync(modelPath).size, available: true }
  : { path: modelPath, available: false };

const modelStatus = modelIdentity.available
  && modelIdentity.sha256 === EXPECTED_MODEL_SHA256
  && modelIdentity.bytes === EXPECTED_MODEL_BYTES
  ? 'PASS'
  : 'BLOCKED';

const causalManifest = existsSync(causalManifestPath)
  ? JSON.parse(await readFile(causalManifestPath, 'utf8'))
  : null;
const cases = Array.isArray(causalManifest?.cases) ? causalManifest.cases : [];
const eligibility = cases.map((item) => ({
  caseId: String(item.case_id ?? item.caseId ?? 'unknown-case'),
  status: 'EXCLUDED_INCOMPLETE_SCORE_INTERVAL',
  reason: 'The causal-case manifest is an old STEP/target-case contract and does not prove a complete Practice v2 Continuous ExpectedStrike interval.',
  sourceAudioSha256: item.source_audio_sha256 ?? item.sourceAudioSha256 ?? null,
  sourceMidiSha256: item.source_midi_sha256 ?? item.sourceMidiSha256 ?? null,
}));

const artifact = {
  schemaVersion: 1,
  artifact: 'phase9e_a_1_bytedance_runner_audit',
  generatedAt: new Date(0).toISOString(),
  researchHarnessGitHead: gitHead,
  command: process.argv.join(' '),
  modelIdentity: {
    expectedSha256: EXPECTED_MODEL_SHA256,
    expectedBytes: EXPECTED_MODEL_BYTES,
    ...modelIdentity,
    status: modelStatus,
  },
  causalManifest: {
    path: causalManifestPath,
    available: Boolean(causalManifest),
    caseCount: cases.length,
  },
  eligibilitySummary: {
    eligibleContinuousScenarioCount: 0,
    excludedCount: eligibility.length,
    reasons: {
      EXCLUDED_INCOMPLETE_SCORE_INTERVAL: eligibility.length,
    },
  },
  eligibility,
  result: {
    status: 'BLOCKED_NOT_RUN',
    reason: modelStatus === 'PASS'
      ? 'No causal case proved a complete Practice v2 Continuous score interval; model execution was not run.'
      : 'Claimed ByteDance ONNX model identity is missing or mismatched.',
    candidateScenarioRunCount: 0,
  },
};

const outputPath = path.join(outputDir, 'bytedance_chunked_phase9e_a1_runner_audit_2026-10-07.json');
await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(outputPath);

async function sha256File(filePath) {
  const buffer = await readFile(filePath);
  return createHash('sha256').update(buffer).digest('hex');
}
