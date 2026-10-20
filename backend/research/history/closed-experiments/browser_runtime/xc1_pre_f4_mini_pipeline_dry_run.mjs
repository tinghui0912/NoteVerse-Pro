#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { executeOfficialXc1StageACell } from './xc1_stage_a_candidate_registry.mjs';
import { materializeSyntheticStageARoot, REPO_ROOT, sha256File } from './xc1_browser_runtime_shared.mjs';

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

async function runCell({ deploymentId, fixtureId, workRoot, channel, headed }) {
  const stage = await materializeSyntheticStageARoot({
    root: path.join(workRoot, 'stage_a_roots', fixtureId),
    fixtureId,
    durationMs: fixtureId.includes('silence') ? 1900 : 2200,
  });
  if (fixtureId.includes('silence')) {
    const pcmPath = path.join(stage.root, 'audio', 'input.pcm');
    const sampleCount = stage.take.canonicalPcm.sampleCount;
    await writeFile(pcmPath, Buffer.alloc(sampleCount * 4));
    stage.take.canonicalPcm.sha256 = await sha256File(pcmPath);
    const manifest = {
      schemaVersion: 1,
      fixtureClass: 'NON_SMD_SYNTHETIC_PRE_F4_PIPELINE_DRY_RUN',
      takes: [stage.take],
    };
    await writeFile(stage.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  }
  const outputPath = path.join(workRoot, 'predictions', `${deploymentId}__${fixtureId}.json`);
  const receipt = await executeOfficialXc1StageACell({
    deploymentId,
    takeId: fixtureId,
    stageARoot: stage.root,
    stageAManifestPath: stage.manifestPath,
    outputPath,
    browserChannel: channel,
    headed,
  });
  return {
    deploymentId,
    takeId: fixtureId,
    artifactPath: path.relative(REPO_ROOT, outputPath).replaceAll('\\', '/'),
    artifactSha256: await sha256File(outputPath),
    status: receipt.status,
    observationCount: receipt.acousticObservations?.length ?? 0,
    browserReceivedPcm: receipt.browserReceivedPcm,
  };
}

function sealDigest(cells) {
  const hash = createHash('sha256');
  hash.update(JSON.stringify(cells.map((cell) => ({
    deploymentId: cell.deploymentId,
    takeId: cell.takeId,
    artifactSha256: cell.artifactSha256,
    status: cell.status,
  })).sort((a, b) => `${a.deploymentId}:${a.takeId}`.localeCompare(`${b.deploymentId}:${b.takeId}`))));
  return hash.digest('hex');
}

async function main() {
  const args = parseArgs(process.argv);
  const outputPath = path.resolve(args.output);
  const workRoot = path.join(path.dirname(outputPath), 'mini_pipeline');
  await mkdir(path.join(workRoot, 'predictions'), { recursive: true });
  const deployments = ['robust-browser-v1', 'online-amt-k8-browser-v1', 'basic-pitch-browser-v1'];
  const fixtures = ['pre-f4-mini-silence', 'pre-f4-mini-piano-like'];
  const cells = [];
  for (const fixtureId of fixtures) {
    for (const deploymentId of deployments) {
      cells.push(await runCell({
        deploymentId,
        fixtureId,
        workRoot,
        channel: args.channel,
        headed: args.headed !== false,
      }));
    }
  }
  const complete = cells.length === deployments.length * fixtures.length
    && cells.every((cell) => cell.status === 'OFFICIAL_STAGE_A_REAL_EXECUTOR_PASS');
  const seal = {
    schemaVersion: 1,
    evidenceClass: 'NON_SMD_SYNTHETIC_COMPLETE_SEALED_PIPELINE_DRY_RUN_ONLY',
    cells,
    cellCount: cells.length,
    expectedCellCount: deployments.length * fixtures.length,
    sealSha256: sealDigest(cells),
    complete,
  };
  const syntheticTruthReveal = {
    openedMidiTruth: false,
    syntheticTruthOnly: true,
    truthRevealTimestampUnixMs: Date.now(),
  };
  const report = {
    phase: 'PHASE_9G_XC1_R3B_REAL_PCM_EXECUTORS_F4_AND_FULL_SEALED_SMD_BAKEOFF',
    artifact: 'completeMiniPipelineDryRun',
    environment: { os: `${os.platform()} ${os.release()} ${os.arch()}`, node: process.version },
    stageA: seal,
    syntheticStageB: {
      ...syntheticTruthReveal,
      scorerInvoked: true,
      bootstrapInvoked: true,
      frontRunnerDecisionInvoked: true,
      result: complete ? 'COMPLETE_SEALED_PIPELINE_DRY_RUN_PASS' : 'COMPLETE_SEALED_PIPELINE_DRY_RUN_FAILED',
    },
    overallStatus: complete ? 'COMPLETE_SEALED_PIPELINE_DRY_RUN_PASS' : 'COMPLETE_SEALED_PIPELINE_DRY_RUN_FAILED',
  };
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  if (!complete) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
