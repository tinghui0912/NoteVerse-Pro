#!/usr/bin/env node

import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { executeOfficialXc1StageACell } from './xc1_stage_a_candidate_registry.mjs';
import { REPO_ROOT, safeResolve } from './xc1_browser_runtime_shared.mjs';

const CANDIDATES = ['robust-browser-v1', 'online-amt-k8-browser-v1', 'basic-pitch-browser-v1'];

function parseArgs(argv) {
  const args = { channel: 'chrome', headed: true };
  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) throw new Error(`XC1_STAGE_A_MATRIX_UNKNOWN_POSITIONAL:${key}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) args[key.slice(2)] = true;
    else {
      args[key.slice(2)] = value;
      index += 1;
    }
  }
  for (const required of ['manifest', 'output-root', 'f4-commit', 'f4-freeze-sha256']) {
    if (!args[required]) throw new Error(`XC1_STAGE_A_MATRIX_MISSING_ARG:--${required}`);
  }
  return args;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function materializeCellStageRoot({ take, cellRoot }) {
  const audioDir = path.join(cellRoot, 'audio');
  const manifestsDir = path.join(cellRoot, 'manifests');
  await mkdir(audioDir, { recursive: true });
  await mkdir(manifestsDir, { recursive: true });
  const sourcePcm = safeResolve(REPO_ROOT, take.canonicalPcm.sourceRelativePath);
  await copyFile(sourcePcm, path.join(audioDir, 'input.pcm'));
  const cellManifest = {
    schemaVersion: 1,
    fixtureClass: 'SMD_STAGE_A_SCORE_BLIND_CELL',
    takes: [{
      takeId: take.takeId,
      sourceAcousticWavSha256: take.sourceAcousticWavSha256,
      canonicalPcm: {
        relativeStageAPath: 'audio/input.pcm',
        sha256: take.canonicalPcm.sha256,
        byteSize: take.canonicalPcm.byteSize,
        sampleCount: take.canonicalPcm.sampleCount,
        sampleRateHz: take.canonicalPcm.sampleRateHz,
        dtype: take.canonicalPcm.dtype,
      },
      scoreableInterior: take.scoreableInterior,
    }],
  };
  const manifestPath = path.join(manifestsDir, 'stage_a_manifest.json');
  await writeJson(manifestPath, cellManifest);
  return manifestPath;
}

async function runCell({ deploymentId, take, outputRoot, channel, headed, f4Commit, f4FreezeSha256 }) {
  const cellRoot = path.join(outputRoot, 'stage_a_cell_roots', deploymentId, take.takeId);
  const outputPath = path.join(outputRoot, 'predictions', deploymentId, `${take.takeId}.json`);
  const manifestPath = await materializeCellStageRoot({ take, cellRoot });
  try {
    return await executeOfficialXc1StageACell({
      deploymentId,
      takeId: take.takeId,
      stageARoot: cellRoot,
      stageAManifestPath: manifestPath,
      outputPath,
      browserChannel: channel,
      headed,
      evidenceMode: 'scientific_prediction',
      f4Commit,
      f4FreezeSha256,
    });
  } catch (error) {
    const receipt = {
      schemaVersion: 1,
      stage: 'XC1_STAGE_A_SCIENTIFIC_PREDICTION_FAILURE',
      status: 'XC1_STAGE_A_CELL_FAILED',
      deploymentId,
      takeId: take.takeId,
      f4Commit,
      f4FreezeSha256,
      noScoreTruthInput: true,
      error: String(error && error.stack ? error.stack : error),
    };
    await writeJson(outputPath, receipt);
    return receipt;
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const manifest = await readJson(path.resolve(args.manifest));
  if (manifest.truthFieldsExcluded !== true || manifest.midiPathsExcluded !== true) {
    throw new Error('XC1_STAGE_A_MATRIX_REQUIRES_SANITIZED_MANIFEST');
  }
  const outputRoot = path.resolve(args['output-root']);
  const requestedCandidates = args['deployment-id'] ? [args['deployment-id']] : CANDIDATES;
  const requestedTakes = args['take-id']
    ? manifest.takes.filter((take) => take.takeId === args['take-id'])
    : manifest.takes;
  const cells = [];
  for (const deploymentId of requestedCandidates) {
    if (!CANDIDATES.includes(deploymentId)) throw new Error(`XC1_STAGE_A_MATRIX_UNKNOWN_DEPLOYMENT:${deploymentId}`);
    for (const take of requestedTakes) {
      const receipt = await runCell({
        deploymentId,
        take,
        outputRoot,
        channel: args.channel,
        headed: args.headed !== false,
        f4Commit: args['f4-commit'],
        f4FreezeSha256: args['f4-freeze-sha256'],
      });
      cells.push({
        deploymentId,
        takeId: take.takeId,
        status: receipt.status,
      });
    }
  }
  const summary = {
    schemaVersion: 1,
    phase: 'PHASE_9G_XC1_R3C_SCIENTIFIC_SEMANTICS_F4_FULL_SEALED_BAKEOFF',
    artifact: 'xc1_stage_a_matrix_runner_summary',
    manifestPath: path.relative(REPO_ROOT, path.resolve(args.manifest)).replaceAll('\\', '/'),
    outputRoot: path.relative(REPO_ROOT, outputRoot).replaceAll('\\', '/'),
    expectedCellCount: requestedCandidates.length * requestedTakes.length,
    completedCellCount: cells.length,
    cells,
  };
  await writeJson(path.join(outputRoot, 'stage_a_matrix_summary.json'), summary);
  if (cells.some((cell) => cell.status !== 'XC1_STAGE_A_SCIENTIFIC_PREDICTION_COMPLETE')) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
