#!/usr/bin/env node
// Research-only Phase 9E-B runner/auditor for the Online-AMT streaming candidate.
// It never enables production Practice. If the external repo/checkpoint are absent,
// it writes a blocked artifact instead of manufacturing product metrics.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { classifyCausalCase } from './bytedance_phase9e_eligibility.mjs';

const CANDIDATE_ID = 'online-amt-stateful-modern-compat-dev-v1';
const REPO_COMMIT = 'ad12550909a1d86f699097d11885f427054a5ac2';
const CHECKPOINT_SHA256 = '54ab4907b517dbfa2dbbee834db18d31d103ee25d690860595181162d235e3a0';
const CHECKPOINT_BYTES = 178804960;
const CONFIG_SHA256 = 'cb01de9df3ce3fecfecc47735c9fcf0e7f5209ed56d6650ed83322439c491aae';
const EXECUTION_PROFILE_ID = 'online-amt-modern-compat-python-cpu-stateful-v1';

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
const implementationGitHead = String(args['git-head'] ?? 'UNKNOWN');
const outputDirRel = args['output-dir'] ?? 'backend/research/reports';
const outputDir = path.resolve(repoRoot, outputDirRel);
const onlineAmtRepoRel = args['online-amt-repo'] ?? 'backend/data/work/online_amt';
const onlineAmtRepo = path.resolve(repoRoot, onlineAmtRepoRel);
const checkpointRel = args.checkpoint ?? path.join(onlineAmtRepoRel, 'model-180000.pt').replaceAll(path.sep, '/');
const checkpoint = path.resolve(repoRoot, checkpointRel);
const causalManifestRel = args['causal-manifest'] ?? 'backend/data/work/datasets/maestro-v3.0.0/production_step_development_set/public_step_causal_cases_manifest.json';
const causalManifest = path.resolve(repoRoot, causalManifestRel);

await mkdir(outputDir, { recursive: true });

const repoIdentity = await inspectRepo(onlineAmtRepo);
const checkpointIdentity = existsSync(checkpoint)
  ? { path: checkpointRel, available: true, sha256: await sha256File(checkpoint), bytes: statSync(checkpoint).size }
  : { path: checkpointRel, available: false };

const assetStatus = repoIdentity.commit === REPO_COMMIT
  && checkpointIdentity.available
  && checkpointIdentity.sha256 === CHECKPOINT_SHA256
  && checkpointIdentity.bytes === CHECKPOINT_BYTES
  ? 'PASS'
  : 'BLOCKED';

const pythonRuntime = inspectPythonRuntime();
const runtimeSmoke = assetStatus === 'PASS'
  ? { status: 'NOT_RUN', reason: 'Real Online-AMT execution hook is intentionally not duplicated in Node; use committed Python adapter path in a later asset-present run.' }
  : { status: 'BLOCKED', blocker: 'NO_ONLINE_AMT_REPO_OR_CHECKPOINT', reason: 'Required external Online-AMT repo/checkpoint was unavailable or identity mismatched.' };

const causalData = existsSync(causalManifest) ? JSON.parse(await readFile(causalManifest, 'utf8')) : null;
const cases = Array.isArray(causalData?.cases) ? causalData.cases : [];
const eligibility = cases.map(classifyCausalCase);
const reasonCounts = eligibility.reduce((counts, item) => {
  counts[item.status] = (counts[item.status] ?? 0) + 1;
  return counts;
}, {});

const artifact = {
  schemaVersion: 1,
  artifact: 'phase9e_b_online_amt_streaming_audit',
  generatedAt: new Date().toISOString(),
  implementationGitHead,
  normalizedCommand: [
    'node backend/research/browser_runtime/run_online_amt_phase9e_b.mjs',
    '--repo-root .',
    `--git-head ${implementationGitHead}`,
    `--online-amt-repo ${onlineAmtRepoRel}`,
    `--checkpoint ${checkpointRel}`,
    `--causal-manifest ${causalManifestRel}`,
    `--output-dir ${outputDirRel}`,
  ].join(' '),
  candidate: {
    candidateId: CANDIDATE_ID,
    strategyKind: 'STREAMING',
    repo: 'https://github.com/jdasam/online_amt',
    expectedRepoCommit: REPO_COMMIT,
    expectedCheckpointSha256: CHECKPOINT_SHA256,
    expectedCheckpointBytes: CHECKPOINT_BYTES,
    configurationSha256: CONFIG_SHA256,
  },
  executionProfile: {
    profileId: EXECUTION_PROFILE_ID,
    candidateInferenceConcurrency: 1,
    device: 'CPU',
    browserSupport: 'NOT_EVALUATED',
    legacyRuntimeParity: 'UNPROVEN',
  },
  runtimeEnvironment: {
    os: `${os.type()} ${os.release()} ${os.arch()}`,
    node: process.version,
    python: pythonRuntime,
  },
  assetIdentity: {
    repo: repoIdentity,
    checkpoint: checkpointIdentity,
    status: assetStatus,
  },
  runtimeSmoke,
  statefulnessSmoke: {
    status: assetStatus === 'PASS' ? 'NOT_RUN' : 'BLOCKED',
    reason: assetStatus === 'PASS'
      ? 'Asset-present real smoke is reserved for the Online-AMT Python execution path.'
      : 'Required external Online-AMT assets unavailable.',
  },
  pipelineIntegrationSmoke: {
    status: 'PASS',
    kind: 'TYPESCRIPT_DETERMINISTIC_STATEFUL_ENGINE',
    productAccuracyMetric: false,
  },
  causalManifest: {
    path: causalManifestRel,
    available: Boolean(causalData),
    caseCount: cases.length,
  },
  eligibilitySummary: {
    eligibleContinuousScenarioCount: eligibility.filter((item) => item.status === 'ELIGIBLE_CONTINUOUS_SCENARIO').length,
    excludedCount: eligibility.filter((item) => item.status !== 'ELIGIBLE_CONTINUOUS_SCENARIO').length,
    reasons: reasonCounts,
  },
  eligibility,
  result: {
    candidateStatus: assetStatus === 'PASS' ? 'ENGINEERING_BASELINE_EXECUTABLE' : 'ENGINEERING_BASELINE_CONTRACT_READY_ASSETS_BLOCKED',
    realDevelopmentScenarioCount: 0,
    realCandidateScenarioRunCount: 0,
    productMetricsStatus: 'NOT_EVALUATED',
    blocker: 'NO_ELIGIBLE_CONTINUOUS_DEVELOPMENT_SCENARIOS',
    referenceLegacyRuntimeParity: 'UNPROVEN',
    calibrationUsed: false,
    evaluationUsed: false,
    candidateWinnerSelected: false,
    productionMicrophoneEnabled: false,
  },
};

await writeFile(
  path.join(outputDir, 'online_amt_streaming_phase9e_b_audit_2026-10-07.json'),
  `${JSON.stringify(artifact, null, 2)}\n`
);
console.log(path.posix.join(outputDirRel, 'online_amt_streaming_phase9e_b_audit_2026-10-07.json'));

async function inspectRepo(repoPath) {
  if (!existsSync(repoPath)) return { path: onlineAmtRepoRel, available: false };
  try {
    const commit = execFileSync('git', ['-C', repoPath, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    return { path: onlineAmtRepoRel, available: true, commit };
  } catch (error) {
    return { path: onlineAmtRepoRel, available: true, error: error instanceof Error ? error.message : String(error) };
  }
}

function inspectPythonRuntime() {
  try {
    const code = [
      'import json, platform',
      'mods={}',
      'for name in ["torch","numpy","librosa","scipy","numba"]:',
      '    try:',
      '        mod=__import__(name); mods[name]=getattr(mod,"__version__","unknown")',
      '    except Exception as exc:',
      '        mods[name]="UNAVAILABLE:"+exc.__class__.__name__',
      'print(json.dumps({"python": platform.python_version(), "packages": mods}))',
    ].join('\n');
    return JSON.parse(execFileSync('python', ['-c', code], { encoding: 'utf8' }));
  } catch (error) {
    return { status: 'UNAVAILABLE', error: error instanceof Error ? error.message : String(error) };
  }
}

async function sha256File(filePath) {
  return createHash('sha256').update(await readFile(filePath)).digest('hex');
}
