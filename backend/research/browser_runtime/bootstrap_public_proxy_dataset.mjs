#!/usr/bin/env node
// Small public-proxy bootstrap/audit entry point. It intentionally does not download
// large datasets unless a caller supplies an explicit local path.

import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const args = parseArgs(process.argv);
const repoRoot = path.resolve(args['repo-root'] ?? process.cwd());
const datasetId = args.dataset ?? 'vienna-4x22';
const sourceRoot = args['source-root'];
const outputRel = args.output ?? `backend/research/reports/${datasetId}_public_proxy_bootstrap_2026-10-08.json`;
const registryPath = path.join(repoRoot, 'backend/research/policies/public_piano_dataset_registry_2026-10-08.json');
const registry = JSON.parse(await readFile(registryPath, 'utf8'));
const dataset = registry.datasets.find((item) => item.datasetId === datasetId);

let status = 'BLOCKED_SOURCE_NOT_AVAILABLE';
let importedPerformanceCount = 0;
let blocker = null;
if (!dataset) {
  status = 'BLOCKED_UNKNOWN_DATASET';
  blocker = `Unknown datasetId: ${datasetId}`;
} else if (sourceRoot) {
  const absolute = path.resolve(repoRoot, sourceRoot);
  if (!existsSync(absolute) || !statSync(absolute).isDirectory()) {
    blocker = `Source root missing: ${sourceRoot}`;
  } else {
    status = 'PUBLIC_PROXY_SOURCE_AVAILABLE_NOT_IMPORTED';
    blocker = 'Phase 9F-A.1 records source availability only; product import requires explicit score-to-PracticeScoreArtifact binding.';
  }
} else {
  blocker = 'No --source-root supplied; large public datasets are not downloaded by default.';
}

const report = {
  schemaVersion: 1,
  artifact: 'public_proxy_dataset_bootstrap',
  generatedAt: new Date().toISOString(),
  datasetId,
  dataset,
  status,
  blocker,
  importedPerformanceCount,
  productAccuracyMetric: false,
  mayEnterLockedProductEvaluation: false,
  registrySha256: createHash('sha256').update(JSON.stringify(registry)).digest('hex'),
};
const outputPath = path.resolve(repoRoot, outputRel);
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(outputRel);

function parseArgs(argv) {
  const parsed = {};
  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) parsed[key.slice(2)] = true;
    else {
      parsed[key.slice(2)] = value;
      index += 1;
    }
  }
  return parsed;
}
