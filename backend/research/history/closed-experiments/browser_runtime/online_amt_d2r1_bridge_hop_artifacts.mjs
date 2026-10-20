#!/usr/bin/env node
// Research-only Phase 9G-D.2R.1 bridge runner. It feeds Online-AMT hop
// artifacts through the authoritative TypeScript publication bridge.

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) args[key.slice(2)] = true;
    else {
      args[key.slice(2)] = next;
      index += 1;
    }
  }
  return args;
}

const args = parseArgs(process.argv);
if (!args['python-artifact']) throw new Error('missing --python-artifact');
if (!args.output) throw new Error('missing --output');

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const { createJiti } = require(path.join(repoRoot, 'apps/customer-web/node_modules/jiti'));
const jiti = createJiti(import.meta.url);
const mod = jiti(path.join(repoRoot, 'apps/customer-web/src/lib/practice/research/online-amt-stateful-streaming.ts'));

const TIMING_CORRECTION_MS = -162.93750000004252;
const OWNED_SAMPLES = 320 * 512;
const CONTEXT_TAIL_SAMPLES = 6 * 512;

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

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

function scenario() {
  return {
    scenarioId: 'phase9gd2r1-online-amt-p07-runtime-fixture',
    performerId: 'p07',
    fixedBpm: 120,
    audio: {
      sourceAudioPath: 'backend/data/work/public_proxy/vienna-4x22/audio-extracted/audio/Chopin_Ballade/Chopin_op38_p07.wav',
      sourceAudioSha256: 'nonblind-p07-runtime-fixture',
      nativeSampleRateHz: 44100,
      clipStartMs: 0,
      clipEndMs: 10240,
      performanceOriginSourceMs: 0,
    },
    completion: { performanceTimeMs: 10240 },
  };
}

function runArtifact(label, artifact) {
  const run = mod.runOnlineAmtStreamingCandidateFromHopArtifact({
    scenario: scenario(),
    artifact,
    candidateId: 'online-amt-browser-v1',
    command: `phase9g-d2r1 ${label} TypeScript bridge`,
    runtime: 'typescript-authoritative-online-amt-bridge',
    timingCorrectionMs: TIMING_CORRECTION_MS,
  });
  const observations = run.publications.flatMap((publication) => publication.observations);
  const semanticPublications = run.publications.map((publication) => ({
    publicationId: publication.publicationId,
    observations: publication.observations,
    analyzedThroughPerformanceMs: publication.analyzedThroughPerformanceMs,
  }));
  return {
    label,
    publicationCount: run.publications.length,
    observationCount: observations.length,
    finalAnalyzedThroughPerformanceMs: run.publications.at(-1)?.analyzedThroughPerformanceMs ?? null,
    canonicalPublicationDigest: sha256(canonicalJson(semanticPublications)),
    runtimePublicationDigest: sha256(canonicalJson(run.publications)),
    publicationsSample: run.publications.slice(0, 3).concat(run.publications.slice(-3)),
  };
}

const pythonArtifactPath = path.resolve(args['python-artifact']);
const browserArtifactPath = args['browser-artifact'] ? path.resolve(args['browser-artifact']) : null;
const pythonArtifact = await readJson(pythonArtifactPath);
const python = runArtifact('python', pythonArtifact);
let browser = null;
if (browserArtifactPath) {
  browser = runArtifact('browser', await readJson(browserArtifactPath));
}
const requirement = mod.onlineAmtSegmentTailRequirement(OWNED_SAMPLES, TIMING_CORRECTION_MS);
const receipt = {
  schemaVersion: 1,
  artifact: 'phase9g_d2r1_online_amt_publication_bridge_runtime_receipt',
  timingCorrectionMs: TIMING_CORRECTION_MS,
  ownedSamples: OWNED_SAMPLES,
  contextTailSamples: CONTEXT_TAIL_SAMPLES,
  authoritativeTailRequirement: requirement,
  python,
  browser,
  parity: browser ? {
    publicationCountEqual: python.publicationCount === browser.publicationCount,
    observationCountEqual: python.observationCount === browser.observationCount,
    finalAnalyzedThroughEqual: python.finalAnalyzedThroughPerformanceMs === browser.finalAnalyzedThroughPerformanceMs,
    canonicalPublicationDigestEqual: python.canonicalPublicationDigest === browser.canonicalPublicationDigest,
  } : null,
};
await writeFile(path.resolve(args.output), JSON.stringify(receipt, null, 2) + '\n', 'utf8');
console.log(JSON.stringify(receipt, null, 2));
