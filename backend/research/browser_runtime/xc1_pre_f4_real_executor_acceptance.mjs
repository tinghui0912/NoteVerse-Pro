#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { executeOfficialXc1StageACell } from './xc1_stage_a_candidate_registry.mjs';
import { assertNoSmokeStatus, REPO_ROOT } from './xc1_browser_runtime_shared.mjs';

function parseArgs(argv) {
  const args = { channel: 'chrome', headed: true };
  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) throw new Error(`unknown positional argument ${key}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) args[key.slice(2)] = true;
    else {
      args[key.slice(2)] = value;
      index += 1;
    }
  }
  if (!args.output) throw new Error('missing --output');
  return args;
}

async function runCell({ deploymentId, outputDir, channel, headed }) {
  const cellOutput = path.join(outputDir, `${deploymentId}.json`);
  const receipt = await executeOfficialXc1StageACell({
    deploymentId,
    takeId: 'pre-f4-non-smd-synthetic-smoke',
    stageARoot: REPO_ROOT,
    outputPath: cellOutput,
    browserChannel: channel,
    headed,
  });
  assertNoSmokeStatus(receipt);
  return receipt;
}

async function main() {
  const args = parseArgs(process.argv);
  const outputPath = path.resolve(args.output);
  const outputDir = path.join(path.dirname(outputPath), 'official_stage_a_cells');
  await mkdir(outputDir, { recursive: true });

  const cells = {};
  for (const deploymentId of [
    'robust-browser-v1',
    'online-amt-k8-browser-v1',
    'basic-pitch-browser-v1',
  ]) {
    const started = Date.now();
    try {
      const receipt = await runCell({
        deploymentId,
        outputDir,
        channel: args.channel,
        headed: args.headed !== false,
      });
      cells[deploymentId] = {
        ...receipt,
        startedAtUnixMs: started,
      };
    } catch (error) {
      cells[deploymentId] = {
        status: 'OFFICIAL_STAGE_A_REAL_EXECUTOR_FAILED',
        deploymentId,
        noScoreTruthInput: true,
        error: String(error && error.stack ? error.stack : error),
      };
    }
  }

  const report = {
    phase: 'PHASE_9G_XC1_R3A_UNIFIED_REAL_EXECUTORS_F4_AND_FULL_SEALED_BAKEOFF',
    artifact: 'officialPreF4RealExecutorAcceptance',
    supersedesClassificationOnly: {
      priorReport: 'backend/research/reports/phase9g_xc1_r3_pre_f4_real_executor_acceptance_2026-10-14.json',
      priorClassification: 'PRE_F4_BROWSER_ENVIRONMENT_AND_MODEL_FEASIBILITY_PASS',
      currentRequirement: 'OFFICIAL_STAGE_A_EXECUTOR_ACCEPTANCE_PASS',
    },
    acceptanceCommandUsesOfficialRegistry: true,
    acceptanceScript: path.relative(REPO_ROOT, fileURLToPath(import.meta.url)).replaceAll('\\', '/'),
    environment: { os: `${os.platform()} ${os.release()} ${os.arch()}`, node: process.version },
    cells,
    overallStatus: Object.values(cells).every((cell) => cell.status === 'OFFICIAL_STAGE_A_REAL_EXECUTOR_PASS')
      ? 'OFFICIAL_STAGE_A_EXECUTOR_ACCEPTANCE_PASS'
      : 'OFFICIAL_STAGE_A_EXECUTOR_ACCEPTANCE_FAILED',
  };
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  if (report.overallStatus !== 'OFFICIAL_STAGE_A_EXECUTOR_ACCEPTANCE_PASS') process.exitCode = 2;
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
