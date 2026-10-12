#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { open, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '../../..');
const reportsDir = path.join(repoRoot, 'backend/research/reports');
const registryPath = path.join(repoRoot, 'backend/research/policies/public_piano_dataset_registry_2026-10-08.json');

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
  const handle = await open(filePath, 'r');
  try {
    const { size } = await handle.stat();
    const byteCount = Math.min(size, maxBytes);
    const buffer = Buffer.alloc(byteCount);
    const { bytesRead } = await handle.read(buffer, 0, byteCount, 0);
    return createHash('sha256').update(buffer.subarray(0, bytesRead)).digest('hex');
  } finally {
    await handle.close();
  }
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

function splitCsvLine(line) {
  const values = [];
  let current = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"' && line[i + 1] === '"') {
      current += '"';
      i += 1;
    } else if (char === '"') {
      inQuote = !inQuote;
    } else if (char === ',' && !inQuote) {
      values.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current);
  return values;
}

async function parseCsv(filePath) {
  const lines = (await readFile(filePath, 'utf8')).trim().split(/\r?\n/);
  const headers = splitCsvLine(lines[0]);
  return lines.slice(1).filter(Boolean).map((line) => {
    const values = splitCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
  });
}

async function summarizeGeneric({ id, name, rootRel, role, trainingOverlapStatus, licenseStatus }) {
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
  const representatives = [];
  for (const file of files.slice(0, 8)) {
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
    representativeIdentities: representatives,
    knownLicenseEvidence: licenseStatus,
    trainingOverlapStatus,
    currentlyAllowedResearchRole: role,
  };
}

async function summarizeMaestro() {
  const rootRel = 'backend/data/work/datasets/maestro-v3.0.0';
  const root = path.join(repoRoot, rootRel);
  const csvPath = path.join(root, 'maestro-v3.0.0.csv');
  const files = await walk(root);
  const rows = existsSync(csvPath) ? await parseCsv(csvPath) : [];
  const officialAudio = new Set(rows.map((row) => row.audio_filename).filter(Boolean));
  const officialMidi = new Set(rows.map((row) => row.midi_filename).filter(Boolean));
  const presentAudioRows = rows.filter((row) => existsSync(path.join(root, row.audio_filename)));
  const presentMidiRows = rows.filter((row) => existsSync(path.join(root, row.midi_filename)));
  const pairedRows = rows.filter((row) => existsSync(path.join(root, row.audio_filename)) && existsSync(path.join(root, row.midi_filename)));
  const wavs = files.filter((file) => path.extname(file).toLowerCase() === '.wav');
  const derivedResearchAudio = wavs.filter((file) => !officialAudio.has(rel(file).replace(`${rootRel}/`, '')));
  return {
    ...(await summarizeGeneric({
      id: 'maestro-v3.0.0',
      name: 'MAESTRO v3.0.0',
      rootRel,
      trainingOverlapStatus: 'KNOWN_TRAINING_DOMAIN_OVERLAP',
      licenseStatus: {
        upstreamDatasetUrl: 'https://magenta.withgoogle.com/datasets/maestro',
        license: 'CC BY-NC-SA 4.0',
        note: 'MAESTRO is explicitly retained for development/parity/debugging only because ByteDance and Online-AMT upstream declarations cite MAESTRO v2.0.0 training.',
      },
      role: 'DEVELOPMENT_ADAPTER_VALIDATION_ONNX_PARITY_PIPELINE_DEBUGGING_ONLY',
    })),
    officialMetadata: {
      csvPath: existsSync(csvPath) ? rel(csvPath) : null,
      metadataRowCount: rows.length,
      officialSourceAudioRowsLocallyPresent: presentAudioRows.length,
      officialSourceMidiRowsLocallyPresent: presentMidiRows.length,
      exactLocallyPairedSourceRows: pairedRows.length,
      pairedRowsBySplit: countBy(pairedRows, 'split'),
      pairedRowsByYear: countBy(pairedRows, 'year'),
      uniquePieces: new Set(pairedRows.map((row) => `${row.canonical_composer}|${row.canonical_title}`)).size,
      uniqueComposers: new Set(pairedRows.map((row) => row.canonical_composer).filter(Boolean)).size,
      officialAudioPathCountInCsv: officialAudio.size,
      officialMidiPathCountInCsv: officialMidi.size,
      derivedResearchAudioCount: derivedResearchAudio.length,
    },
    trainingDeclarationEvidence: [
      {
        modelFamily: 'ByteDance piano_transcription',
        sourceUrl: 'https://github.com/bytedance/piano_transcription/blob/master/README.md',
        declaration: 'Upstream documentation states training used MAESTRO v2.0.0.',
      },
      {
        modelFamily: 'Online-AMT',
        sourceUrl: 'https://github.com/jdasam/online_amt',
        declaration: 'Upstream documentation states the pretrained model was trained with MAESTRO v2.0.0.',
      },
    ],
  };
}

async function summarizeVienna() {
  const rootRel = 'backend/data/work/public_proxy/vienna-4x22';
  const root = path.join(repoRoot, rootRel);
  const files = await walk(root);
  const sourceWavs = files.filter((file) => file.includes(`${path.sep}audio-extracted${path.sep}`) && path.extname(file).toLowerCase() === '.wav');
  const sourceMidis = files.filter((file) => file.includes(`${path.sep}vienna4x22-metadata${path.sep}midi${path.sep}`) && MIDI_EXTS.has(path.extname(file).toLowerCase()));
  const matches = files.filter((file) => file.includes(`${path.sep}vienna4x22-metadata${path.sep}match${path.sep}`) && path.extname(file).toLowerCase() === '.match');
  const wavByStem = new Map(sourceWavs.map((file) => [path.basename(file, path.extname(file)), file]));
  const midiByStem = new Map(sourceMidis.map((file) => [path.basename(file, path.extname(file)), file]));
  const matchByStem = new Map(matches.map((file) => [path.basename(file, path.extname(file)), file]));
  const pairedStems = [...wavByStem.keys()].filter((stem) => midiByStem.has(stem)).sort();
  const alignmentCoveredPairs = pairedStems.filter((stem) => matchByStem.has(stem));
  return {
    ...(await summarizeGeneric({
      id: 'vienna-4x22',
      name: 'Vienna 4x22 public proxy',
      rootRel,
      trainingOverlapStatus: 'NO_DOCUMENTED_OVERLAP_IN_PUBLISHED_TRAINING_DECLARATIONS',
      licenseStatus: {
        upstreamDatasetUrl: 'https://github.com/CPJKU/vienna4x22',
        doi: '10.21939/4X22',
        versionEvidence: 'Repository README describes the official Vienna 4x22 dataset and v1.0.0 match files.',
        license: 'CC BY 4.0',
      },
      role: 'PUBLIC_EXTERNAL_PROXY_CANDIDATE_AFTER_PROTOCOL_AND_ALIGNMENT_VERIFICATION',
    })),
    structuralPairing: {
      sourceWavCount: sourceWavs.length,
      sourceMidiCount: sourceMidis.length,
      exactWavMidiStemPairCount: pairedStems.length,
      unmatchedWavCount: sourceWavs.length - pairedStems.length,
      unmatchedMidiCount: sourceMidis.length - pairedStems.length,
      matchAlignmentFileCount: matches.length,
      alignmentCoveredPairCount: alignmentCoveredPairs.length,
      pieceCount: new Set(pairedStems.map((stem) => stem.replace(/_p\d+$/, ''))).size,
      performerTakeCount: pairedStems.length,
      representativePairStems: pairedStems.slice(0, 8),
    },
    trainingDeclarationEvidence: [
      {
        modelFamily: 'ByteDance/Online-AMT',
        declaration: 'Published training declarations inspected for this phase cite MAESTRO v2.0.0 and do not document Vienna 4x22.',
      },
    ],
  };
}

function countBy(rows, field) {
  const out = {};
  for (const row of rows) {
    const key = row[field] || '<missing>';
    out[key] = (out[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

const publicRegistry = existsSync(registryPath)
  ? {
      path: rel(registryPath),
      sha256: createHash('sha256').update(await readFile(registryPath)).digest('hex'),
    }
  : null;

const inventory = {
  artifact: 'phase9g_d1r_corrected_local_public_dataset_inventory',
  phase: '9G-D.1R',
  correctedFrom: 'phase9g_d1_local_public_dataset_inventory',
  correctionSummary: [
    'MAESTRO official media counts are derived from maestro-v3.0.0.csv rather than recursive WAV counts.',
    'Derived research WAV clips under the MAESTRO root are counted separately.',
    'Vienna source WAV/MIDI/match files are structurally paired by exact stem.',
    'Representative hashing uses first-N-byte reads rather than loading complete media files.',
  ],
  scannedRoots: ['backend/data/work/public_proxy', 'backend/data/work/datasets', 'models'],
  privacyBoundary: 'Repository-local research/work roots only; no unrelated personal directories scanned.',
  publicDatasetRegistryEvidence: publicRegistry,
  p15p22CandidateInferenceIncrease: 0,
  datasets: [
    await summarizeVienna(),
    await summarizeMaestro(),
    await summarizeGeneric({
      id: 'smd',
      name: 'Saarland Music Data / SMD',
      rootRel: 'backend/data/work/datasets/smd',
      trainingOverlapStatus: 'NO_DOCUMENTED_OVERLAP_IN_PUBLISHED_TRAINING_DECLARATIONS',
      licenseStatus: {
        upstreamDatasetUrl: 'https://audiolabs-erlangen.com/resources/MIR/SMD/midi',
        license: 'CC BY-NC-SA 3.0 Unported',
        note: 'Public availability does not imply commercial-product permission; SMD was not downloaded in this correction phase.',
      },
      role: 'POTENTIAL_NATIVE_PAIRED_AMT_TRUTH_AFTER_LICENSE_AND_OVERLAP_PROTOCOL_FREEZE',
    }),
    await summarizeGeneric({
      id: 'maps',
      name: 'MAPS',
      rootRel: 'backend/data/work/datasets/maps',
      trainingOverlapStatus: 'UNKNOWN_NOT_LOCALLY_VERIFIED',
      licenseStatus: 'NOT_LOCALLY_VERIFIED_IN_THIS_PHASE',
      role: 'ACOUSTIC_TRANSCRIPTION_STRESS_REFERENCE_NOT_NATIVE_FIXED_BPM_PRACTICE',
    }),
  ],
};

const gap = {
  artifact: 'phase9g_d1r_public_external_selection_gap',
  phase: '9G-D.1R',
  noFinalWinnerSelected: true,
  phase9gBHistoricalConclusion: { outcome: 'STATISTICAL_TIE', winner: null },
  laneA_nativePairedAmtTruth: {
    definition: 'real audio + synchronized same-performance MIDI; evaluates recovered notes/onsets independently of score following',
    status: 'PROTOCOL_NOT_FROZEN',
    missingBeforeUse: [
      'license/provenance decisions for non-MAESTRO corpora',
      'take/piece/source-level statistical unit inventory',
      'candidate identities and browser runtime identities frozen prospectively',
      'clustered resampling policy that does not treat individual strikes as independent performances',
    ],
  },
  laneB_fixedBpmPracticeProxy: {
    definition: 'deterministic fixed-BPM proxy only where score/performance alignment can transform audio, MIDI truth, and score timing identically',
    status: 'PROTOCOL_NOT_FROZEN',
    missingBeforeUse: [
      'candidate-independent score-to-performance transformation policy',
      'public-proxy labeling that does not imply native NoteVerse microphone capture',
      'pre-registered safety/latency/resource metrics and tie policy before final scoring',
    ],
  },
  datasetUseConstraints: {
    maestro: 'Development/parity/debugging only because training-domain overlap is known.',
    vienna4x22: 'Promising public proxy; published training declarations inspected here do not document overlap, but that is not a mathematical disjointness proof.',
    smd: 'Potential native paired AMT truth; CC BY-NC-SA 3.0 licensing requires product-use review before metric participation.',
    maps: 'Useful stress reference; not assumed to represent human fixed-BPM Practice.',
  },
};

await writeFile(
  path.join(reportsDir, 'phase9g_d1r_corrected_local_public_dataset_inventory_2026-10-12.json'),
  JSON.stringify(inventory, null, 2),
  'utf8',
);
await writeFile(
  path.join(reportsDir, 'phase9g_d1r_public_external_selection_gap_2026-10-12.json'),
  JSON.stringify(gap, null, 2),
  'utf8',
);

console.log(JSON.stringify({ inventory, gap }, null, 2));
