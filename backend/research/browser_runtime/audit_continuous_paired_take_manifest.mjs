#!/usr/bin/env node
// Research-only validator for Continuous Practice v2 paired-take manifests.
// The policy lives in apps/customer-web TypeScript; this CLI is only a Node entry point.

import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createJiti } from '../../../apps/customer-web/node_modules/jiti/lib/jiti.mjs';

const args = parseArgs(process.argv);
const repoRoot = path.resolve(args['repo-root'] ?? process.cwd());
const manifestRel = args.manifest ?? 'backend/research/fixtures/continuous_paired_take_manifest_v2_empty_development_2026-10-08.json';
const outputRel = args.output ?? 'backend/research/reports/continuous_paired_take_manifest_v2_audit_2026-10-08.json';
const outputPath = path.resolve(repoRoot, outputRel);

const jiti = createJiti(import.meta.url, { alias: { '@': path.join(repoRoot, 'apps/customer-web/src') } });
const corpus = await jiti.import(path.join(repoRoot, 'apps/customer-web/src/lib/practice/research/continuous-paired-take-corpus.ts'));

let manifest = null;
let audit = null;
let blocker = null;
try {
  if (args.index) {
    const indexRel = args.index;
    const index = JSON.parse(await readFile(path.resolve(repoRoot, indexRel), 'utf8'));
    const entries = [
      ...(index.developmentManifests ?? []).map((manifestPath) => ({ split: 'DEVELOPMENT', manifestPath })),
      ...(index.calibrationManifests ?? []).map((manifestPath) => ({ split: 'CALIBRATION', manifestPath })),
      ...(index.evaluationManifests ?? []).map((manifestPath) => ({ split: 'EVALUATION', manifestPath })),
    ];
    const manifests = [];
    const manifestAudits = [];
    for (const entry of entries) {
      const loaded = JSON.parse(await readFile(path.resolve(repoRoot, entry.manifestPath), 'utf8'));
      manifests.push(loaded);
      manifestAudits.push({ path: entry.manifestPath, audit: corpus.auditContinuousPairedTakeCorpus(loaded, { repoRoot }) });
    }
    const splitLeakage = corpus.detectContinuousSplitLeakage(manifests.map((loaded) => ({ split: loaded.split, takes: loaded.takes })));
    audit = {
      schemaVersion: 2,
      artifact: 'continuous_paired_take_corpus_index_audit',
      index: { path: indexRel, sha256: sha256Json(index) },
      manifestAudits,
      splitLeakage,
      status: splitLeakage.length ? 'BLOCKED' : 'CORPUS_SCHEMA_READY',
      productAccuracyMetric: false,
    };
    if (splitLeakage.length) blocker = `split leakage: ${splitLeakage.join('; ')}`;
  } else {
    manifest = JSON.parse(await readFile(path.resolve(repoRoot, manifestRel), 'utf8'));
    audit = corpus.auditContinuousPairedTakeCorpus(manifest, { repoRoot });
    if (audit.splitLeakage?.length) {
      blocker = `split leakage: ${audit.splitLeakage.join('; ')}`;
    }
  }
} catch (error) {
  blocker = error instanceof Error ? error.message : String(error);
}

const takes = Array.isArray(manifest?.takes) ? manifest.takes : [];
const report = {
  schemaVersion: 2,
  artifact: 'continuous_paired_take_manifest_v2_audit',
  generatedAt: new Date().toISOString(),
  manifest: args.index ? undefined : {
    path: manifestRel,
    available: Boolean(manifest),
    sha256: manifest ? sha256Json(manifest) : null,
  },
  ...(audit ?? {
    takeCount: takes.length,
    scoreableTakeCount: 0,
    blockedTakeCount: takes.length,
    countsBySplit: manifest?.split ? { [manifest.split]: takes.length } : {},
    countsByFamily: {},
    blockers: Object.fromEntries(takes.map((take) => [take.takeId ?? 'unknown', [blocker ?? 'Manifest validation failed.']])),
    splitLeakage: [],
    candidateEligibility: {},
    realRecordedTakeCount: 0,
    scoreableRealTakeCount: 0,
    status: 'BLOCKED',
    nextAction: 'RECORD_REAL_PAIRED_DEVELOPMENT_TAKES',
    productAccuracyMetric: false,
  }),
  blocker,
};

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(outputRel);

function sha256Json(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(',')}}`;
}

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
