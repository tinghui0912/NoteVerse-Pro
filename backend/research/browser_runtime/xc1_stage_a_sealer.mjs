#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { REPO_ROOT } from './xc1_browser_runtime_shared.mjs';

const CANDIDATES = ['robust-browser-v1', 'online-amt-k8-browser-v1', 'basic-pitch-browser-v1'];

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) throw new Error(`XC1_SEAL_UNKNOWN_POSITIONAL:${key}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) args[key.slice(2)] = true;
    else {
      args[key.slice(2)] = value;
      index += 1;
    }
  }
  for (const required of ['manifest', 'prediction-root', 'output']) {
    if (!args[required]) throw new Error(`XC1_SEAL_MISSING_ARG:--${required}`);
  }
  return args;
}

async function sha256File(filePath) {
  return createHash('sha256').update(await readFile(filePath)).digest('hex');
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

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function main() {
  const args = parseArgs(process.argv);
  const manifest = await readJson(path.resolve(args.manifest));
  const predictionRoot = path.resolve(args['prediction-root']);
  const expected = [];
  for (const candidate of CANDIDATES) {
    for (const take of manifest.takes) {
      expected.push({ candidateId: candidate, takeId: take.takeId });
    }
  }
  const cells = [];
  const failures = [];
  for (const cell of expected) {
    const artifactPath = path.join(predictionRoot, cell.candidateId, `${cell.takeId}.json`);
    let artifact;
    try {
      artifact = await readJson(artifactPath);
    } catch (error) {
      failures.push({ ...cell, failure: 'MISSING_ARTIFACT', error: String(error) });
      continue;
    }
    const allowed = new Set(['XC1_STAGE_A_SCIENTIFIC_PREDICTION_COMPLETE', 'XC1_STAGE_A_CELL_FAILED']);
    if (!allowed.has(artifact.status)) {
      failures.push({ ...cell, failure: 'DISALLOWED_ARTIFACT_STATUS', status: artifact.status });
    }
    if (artifact.stage === 'XC1_OFFICIAL_STAGE_A_REAL_EXECUTOR_ACCEPTANCE') {
      failures.push({ ...cell, failure: 'ACCEPTANCE_ARTIFACT_CANNOT_BE_SEALED' });
    }
    if (artifact.deploymentId !== cell.candidateId || artifact.takeId !== cell.takeId) {
      failures.push({ ...cell, failure: 'CELL_IDENTITY_MISMATCH' });
    }
    cells.push({
      ...cell,
      status: artifact.status,
      artifactPath: path.relative(REPO_ROOT, artifactPath).replaceAll('\\', '/'),
      artifactSha256: await sha256File(artifactPath),
    });
  }
  const duplicates = new Set();
  const seen = new Set();
  for (const cell of cells) {
    const key = `${cell.candidateId}\u0000${cell.takeId}`;
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
  }
  for (const duplicate of duplicates) failures.push({ failure: 'DUPLICATE_CELL', key: duplicate });
  const receipt = {
    schemaVersion: 1,
    phase: 'PHASE_9G_XC1_R3C_SCIENTIFIC_SEMANTICS_F4_FULL_SEALED_BAKEOFF',
    artifact: 'xc1_stage_a_primary_chrome_seal_manifest',
    expectedCellCount: expected.length,
    sealedCellCount: cells.length,
    complete: failures.length === 0 && cells.length === expected.length,
    cells,
    failures,
  };
  receipt.sealSha256 = createHash('sha256').update(canonicalJson(receipt)).digest('hex');
  await writeJson(path.resolve(args.output), receipt);
  if (!receipt.complete) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
