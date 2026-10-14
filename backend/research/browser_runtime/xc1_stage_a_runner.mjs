#!/usr/bin/env node

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { executeOfficialXc1StageACell } from './xc1_stage_a_candidate_registry.mjs';

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) throw new Error(`XC1_STAGE_A_UNKNOWN_POSITIONAL:${key}`);
    const name = key.slice(2);
    if ([
      'executor',
      'executor-path',
      'executor-callback',
      'model-path',
      'graph-path',
      'thresholds',
      'decoder',
      'truth-midi',
      'expected-pitches',
    ].includes(name)) {
      throw new Error(`XC1_STAGE_A_FORBIDDEN_CLI_OPTION:${key}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      args[name] = true;
    } else {
      args[name] = value;
      index += 1;
    }
  }
  return args;
}

function requireArg(args, key) {
  if (!args[key]) throw new Error(`XC1_STAGE_A_MISSING_ARG:--${key}`);
  return args[key];
}

async function main() {
  const args = parseArgs(process.argv);
  const deploymentId = requireArg(args, 'deployment-id');
  const takeId = requireArg(args, 'take-id');
  const stageARoot = path.resolve(requireArg(args, 'stage-a-root'));
  const outputPath = path.resolve(requireArg(args, 'output'));
  const request = {
    deploymentId,
    candidateId: args['candidate-id'],
    takeId,
    stageARoot,
    canonicalPcmPath: args['canonical-pcm'] ? path.resolve(args['canonical-pcm']) : undefined,
    outputPath,
    robustOnnxPath: args['robust-onnx'] ? path.resolve(args['robust-onnx']) : undefined,
    onlineAmtK8OnnxPath: args['online-amt-k8-onnx'] ? path.resolve(args['online-amt-k8-onnx']) : undefined,
    onlineAmtK1OnnxPath: args['online-amt-k1-onnx'] ? path.resolve(args['online-amt-k1-onnx']) : undefined,
    basicPitchWorkDir: args['basic-pitch-work-dir'] ? path.resolve(args['basic-pitch-work-dir']) : undefined,
    browserChannel: args['browser-channel'] ?? 'chrome',
    headed: args.headed === true,
  };
  const result = await executeOfficialXc1StageACell(request);
  if (!result || typeof result !== 'object') {
    await writeFile(outputPath, `${JSON.stringify({ result }, null, 2)}\n`, 'utf8');
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
