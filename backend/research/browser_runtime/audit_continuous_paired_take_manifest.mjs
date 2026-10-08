#!/usr/bin/env node
// Research-only validator for Continuous Practice v2 paired-take manifests.
// It audits source-of-truth readiness before any acoustic candidate is run.

import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const args = parseArgs(process.argv);
const repoRoot = path.resolve(args['repo-root'] ?? process.cwd());
const manifestRel = args.manifest ?? 'backend/data/work/continuous/continuous_paired_take_manifest_v1.json';
const outputRel = args.output ?? 'backend/research/reports/continuous_paired_take_manifest_v1_audit_2026-10-08.json';
const manifestPath = path.resolve(repoRoot, manifestRel);
const outputPath = path.resolve(repoRoot, outputRel);

let manifest = null;
let blocker = null;
try {
  manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  validateManifest(manifest);
} catch (error) {
  blocker = error instanceof Error ? error.message : String(error);
}

const takes = Array.isArray(manifest?.takes) ? manifest.takes : [];
const audit = {
  schemaVersion: 1,
  artifact: 'continuous_paired_take_manifest_v1_audit',
  generatedAt: new Date().toISOString(),
  manifest: {
    path: manifestRel,
    available: Boolean(manifest),
    sha256: manifest ? sha256Json(manifest) : null,
  },
  takeCount: takes.length,
  scoreableTakeCount: blocker ? 0 : takes.length,
  blockedTakeCount: blocker ? takes.length : 0,
  countsBySplit: countBy(takes, (take) => take.split),
  countsByFamily: countFamilies(takes),
  splitLeakage: manifest ? detectLeakage(takes) : [],
  blocker,
  realRecordedTakeCount: takes.length,
  scoreableRealTakeCount: blocker ? 0 : takes.length,
  status: blocker ? 'BLOCKED' : (takes.length === 0 ? 'CAPTURE_PIPELINE_READY' : 'PASS'),
  nextAction: takes.length === 0 ? 'RECORD_REAL_PAIRED_DEVELOPMENT_TAKES' : 'RUN_FROZEN_DEVELOPMENT_CANDIDATES_ONLY',
  productAccuracyMetric: false,
};

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(audit, null, 2)}\n`);
console.log(outputRel);

function validateManifest(input) {
  if (input.schemaVersion !== 1 || !input.manifestId || !Array.isArray(input.takes)) {
    throw new Error('Manifest requires schemaVersion 1, manifestId, and takes array.');
  }
  const leakage = detectLeakage(input.takes);
  if (leakage.length > 0) throw new Error(`split leakage: ${leakage.join('; ')}`);
  for (const take of input.takes) validateTake(take);
}

function validateTake(take) {
  if (!take.takeId || !take.captureSessionId) throw new Error('take identity missing');
  if (!take.product?.completion?.kind || !Number.isFinite(take.product.completion.performanceTimeMs)) {
    throw new Error(`${take.takeId}: missing authoritative completion`);
  }
  if (!take.score?.practiceScoreArtifactSha256 || !Array.isArray(take.score.expectedStrikes) || take.score.expectedStrikes.length === 0) {
    throw new Error(`${take.takeId}: missing PracticeScoreArtifact-derived expected strikes`);
  }
  if (!take.audio?.sha256 || !take.midi?.sha256 || take.midi.sameTake !== true) {
    throw new Error(`${take.takeId}: audio/MIDI same-take identities are required`);
  }
  if (take.sync?.quality === 'INSUFFICIENT_SYNCHRONIZATION') {
    throw new Error(`${take.takeId}: insufficient synchronization`);
  }
}

function detectLeakage(takes) {
  const byIdentity = new Map();
  for (const take of takes) {
    for (const identity of [take.audio?.sha256, take.midi?.sha256, take.captureSessionId].filter(Boolean)) {
      const splits = byIdentity.get(identity) ?? new Set();
      splits.add(take.split);
      byIdentity.set(identity, splits);
    }
  }
  return [...byIdentity.entries()]
    .filter(([, splits]) => splits.size > 1)
    .map(([identity, splits]) => `${identity} appears in ${[...splits].sort().join(',')}`);
}

function countBy(items, fn) {
  return items.reduce((counts, item) => {
    const key = fn(item) ?? 'UNKNOWN';
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function countFamilies(takes) {
  return takes.reduce((counts, take) => {
    for (const tag of take.taxonomy ?? []) counts[tag] = (counts[tag] ?? 0) + 1;
    return counts;
  }, {});
}

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
