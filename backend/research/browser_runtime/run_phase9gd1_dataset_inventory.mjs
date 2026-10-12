#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '../../..');
const reportsDir = path.join(repoRoot, 'backend/research/reports');

const AUDIO_EXTS = new Set(['.wav', '.flac', '.mp3', '.ogg', '.m4a']);
const MIDI_EXTS = new Set(['.mid', '.midi']);
const SCORE_EXTS = new Set(['.musicxml', '.mxl', '.xml', '.krn']);
const ALIGN_EXTS = new Set(['.match', '.align', '.corresp', '.tsv']);

function rel(filePath) {
  return path.relative(repoRoot, filePath).replaceAll(path.sep, '/');
}

async function walk(root) {
  const out = [];
  if (!existsSync(root)) return out;
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walk(full)));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

async function sha256Prefix(filePath, maxBytes = 1024 * 1024) {
  const buffer = await readFile(filePath);
  const slice = buffer.subarray(0, Math.min(buffer.byteLength, maxBytes));
  return createHash('sha256').update(slice).digest('hex');
}

function classifyExt(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (AUDIO_EXTS.has(ext)) return 'audio';
  if (MIDI_EXTS.has(ext)) return 'midi';
  if (SCORE_EXTS.has(ext)) return 'score';
  if (ALIGN_EXTS.has(ext)) return 'alignment';
  if (['.json', '.csv', '.md', '.txt', '.zip'].includes(ext)) return 'metadata';
  return 'other';
}

async function summarizeDataset({ id, name, rootRel, role, trainingOverlapStatus, licenseStatus }) {
  const root = path.join(repoRoot, rootRel);
  const exists = existsSync(root);
  const files = exists ? await walk(root) : [];
  const counts = { total: files.length, audio: 0, midi: 0, score: 0, alignment: 0, metadata: 0, other: 0 };
  let totalBytes = 0;
  const formats = new Map();
  for (const file of files) {
    const st = await stat(file);
    totalBytes += st.size;
    const kind = classifyExt(file);
    counts[kind] += 1;
    const ext = path.extname(file).toLowerCase() || '<none>';
    formats.set(ext, (formats.get(ext) ?? 0) + 1);
  }
  const representativeFiles = files
    .filter((file) => classifyExt(file) !== 'audio' || !/_p(1[5-9]|2[0-2])(?:\D|$)/.test(rel(file)))
    .slice(0, 8);
  const representatives = [];
  for (const file of representativeFiles) {
    const st = await stat(file);
    representatives.push({
      path: rel(file),
      byteSize: st.size,
      kind: classifyExt(file),
      sha256FirstMiB: await sha256Prefix(file),
    });
  }
  return {
    datasetId: id,
    name,
    localRoot: rootRel,
    localRootExists: exists,
    fileCount: counts.total,
    audioCount: counts.audio,
    midiCount: counts.midi,
    musicXmlScoreCount: counts.score,
    matchAlignmentCount: counts.alignment,
    metadataCount: counts.metadata,
    otherCount: counts.other,
    totalBytes,
    formats: Object.fromEntries([...formats.entries()].sort(([a], [b]) => a.localeCompare(b))),
    audioMidiPairingEvidence: inferPairing(id, counts, files),
    representativeIdentities: representatives,
    metadataVersionEvidence: inferVersionEvidence(id, files),
    knownLicenseEvidence: licenseStatus,
    trainingOverlapStatus,
    currentlyAllowedResearchRole: role,
  };
}

function inferPairing(id, counts, files) {
  if (id === 'maestro-v3.0.0') {
    return counts.audio > 0 && counts.midi > 0
      ? 'MAESTRO CSV and mirrored audio/MIDI names are locally present; known training-domain overlap excludes final ranking use.'
      : 'Incomplete local MAESTRO media inventory.';
  }
  if (id === 'vienna-4x22') {
    return 'Real piano audio is locally present; MIDI/alignment availability is counted separately and must be verified before fixed-BPM proxy scoring.';
  }
  if (files.length === 0) return 'No local files found.';
  return 'Pairing not established by this lightweight inventory.';
}

function inferVersionEvidence(id, files) {
  if (id === 'maestro-v3.0.0') {
    const csv = files.find((file) => path.basename(file) === 'maestro-v3.0.0.csv');
    return csv ? { type: 'csv', path: rel(csv) } : null;
  }
  if (id === 'vienna-4x22') {
    const zip = files.find((file) => path.basename(file) === 'audio.zip');
    return zip ? { type: 'archive', path: rel(zip) } : null;
  }
  return null;
}

const datasets = [
  {
    id: 'vienna-4x22',
    name: 'Vienna 4x22 public proxy',
    rootRel: 'backend/data/work/public_proxy/vienna-4x22',
    trainingOverlapStatus: 'UNKNOWN_REQUIRES_VERIFICATION',
    licenseStatus: 'LOCAL_LICENSE_EVIDENCE_NOT_VERIFIED_IN_THIS_PHASE',
    role: 'PUBLIC_EXTERNAL_PROXY_CANDIDATE_AFTER_OVERLAP_AND_ALIGNMENT_VERIFICATION',
  },
  {
    id: 'maestro-v3.0.0',
    name: 'MAESTRO v3.0.0',
    rootRel: 'backend/data/work/datasets/maestro-v3.0.0',
    trainingOverlapStatus: 'KNOWN_TRAINING_DOMAIN_OVERLAP',
    licenseStatus: 'PUBLIC_DATASET_LICENSE_EVIDENCE_EXPECTED_FROM_UPSTREAM_METADATA; LOCAL_LICENSE_FILE_NOT_REQUIRED_FOR_THIS_DEV_ONLY_ROLE',
    role: 'DEVELOPMENT_ADAPTER_VALIDATION_ONNX_PARITY_PIPELINE_DEBUGGING_ONLY',
  },
  {
    id: 'smd',
    name: 'Saarland Music Data / SMD',
    rootRel: 'backend/data/work/datasets/smd',
    trainingOverlapStatus: 'UNKNOWN_NOT_LOCALLY_VERIFIED',
    licenseStatus: 'NOT_LOCALLY_VERIFIED',
    role: 'POTENTIAL_NATIVE_PAIRED_AMT_TRUTH_AFTER_LICENSE_AND_OVERLAP_VERIFICATION',
  },
  {
    id: 'maps',
    name: 'MAPS',
    rootRel: 'backend/data/work/datasets/maps',
    trainingOverlapStatus: 'UNKNOWN_NOT_LOCALLY_VERIFIED',
    licenseStatus: 'NOT_LOCALLY_VERIFIED',
    role: 'ACOUSTIC_TRANSCRIPTION_STRESS_REFERENCE_NOT_NATIVE_FIXED_BPM_PRACTICE',
  },
];

const inventory = {
  artifact: 'phase9g_d1_local_public_dataset_inventory',
  phase: '9G-D.1',
  scannedRoots: [
    'backend/data/work/public_proxy',
    'backend/data/work/datasets',
    'models',
  ],
  privacyBoundary: 'Repository-local research/work roots only; no unrelated personal directories scanned.',
  p15p22CandidateInferenceIncrease: 0,
  datasets: [],
};

for (const dataset of datasets) {
  inventory.datasets.push(await summarizeDataset(dataset));
}

const gap = {
  artifact: 'phase9g_d1_public_external_selection_gap',
  phase: '9G-D.1',
  noFinalWinnerSelected: true,
  phase9gBHistoricalConclusion: { outcome: 'STATISTICAL_TIE', winner: null },
  laneA_nativePairedAmtTruth: {
    definition: 'real audio + synchronized same-performance MIDI; evaluates recovered notes/onsets independently of score following',
    status: 'PROTOCOL_NOT_FROZEN',
    missingBeforeUse: [
      'training-overlap verification for non-MAESTRO corpora',
      'license/provenance verification',
      'take/piece/source-level statistical unit inventory',
      'candidate identities and browser runtime identities frozen prospectively',
    ],
  },
  laneB_fixedBpmPracticeProxy: {
    definition: 'deterministic fixed-BPM proxy only where score/performance alignment can transform audio, MIDI truth, and score timing identically',
    status: 'PROTOCOL_NOT_FROZEN',
    missingBeforeUse: [
      'trustworthy score-to-performance alignment availability by take',
      'candidate-independent transformation policy',
      'public-proxy labeling that does not imply native NoteVerse microphone capture',
      'pre-registered safety/latency/resource metrics and tie policy before final scoring',
    ],
  },
  datasetUseConstraints: {
    maestro: 'Development/parity/debugging only because training-domain overlap is known.',
    vienna4x22: 'Promising public proxy; overlap, license, and alignment sufficiency remain to be verified.',
    smd: 'Potential native paired AMT truth; local presence/license/overlap not established here.',
    maps: 'Useful stress reference; not assumed to represent human fixed-BPM Practice.',
  },
};

await writeFile(
  path.join(reportsDir, 'phase9g_d1_local_public_dataset_inventory_2026-10-12.json'),
  JSON.stringify(inventory, null, 2),
  'utf8',
);
await writeFile(
  path.join(reportsDir, 'phase9g_d1_public_external_selection_gap_2026-10-12.json'),
  JSON.stringify(gap, null, 2),
  'utf8',
);

console.log(JSON.stringify({ inventory, gap }, null, 2));
