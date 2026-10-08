import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Midi } from '@tonejs/midi';

import { planByteDanceScoreAwareChunks, validateByteDanceSourceContext } from './bytedance-score-aware-chunked';
import { validateBenchmarkScenario, type BenchmarkScenario } from './continuous-analyzer-bakeoff';
import { ONLINE_AMT_STREAMING_BASELINE_CONFIG, onlineAmtSegmentTailRequirement } from './online-amt-stateful-streaming';
import { assertPracticeScoreArtifact, type PracticeScope, type PracticeScoreArtifact } from '../local-core/artifact';
import { buildContinuousExpectedStrikes } from '../local-core/continuous-expected-strikes';
import type { PracticeTempoSelection } from '../local-core/practice-tempo';

type Split = 'DEVELOPMENT' | 'CALIBRATION' | 'EVALUATION';
type CompletionKind = 'NATURAL' | 'MANUAL';
type SyncQuality = 'SHARED_CAPTURE_CLOCK_VERIFIED' | 'CALIBRATED_OFFSET' | 'INSUFFICIENT_SYNCHRONIZATION';
type CandidateId = 'bytedance-score-aware-chunked-dev-v1' | 'online-amt-stateful-modern-compat-dev-v1';
type CandidateEligibility = 'ELIGIBLE' | 'INELIGIBLE_INSUFFICIENT_CONTEXT' | 'INELIGIBLE_INVALID_CORPUS_TAKE';

export type ContinuousPairedTakeManifest = {
  schemaVersion: 2;
  manifestId: string;
  split: Split;
  policy: { policyId: string; policyVersion: string; policySha256: string };
  takes: readonly ContinuousPairedTake[];
  evaluationLock?: { locked: boolean; lockProjectionSha256: string };
};

export type ContinuousPairedTake = {
  takeId: string;
  captureSessionId: string;
  score: {
    practiceScoreArtifactPath: string;
    practiceScoreArtifactSha256: string;
    practiceScoreArtifactSchemaVersion: number;
    sourceScorePath?: string;
    sourceScoreSha256?: string;
  };
  practice: {
    tempoSelection: PracticeTempoSelection;
    scope: PracticeScope;
    completion: { kind: CompletionKind; performanceTimeMs: number };
    pauseIntervalsMs?: readonly { startMs: number; endMs: number }[];
  };
  audio: {
    path: string;
    sha256: string;
    container: 'RIFF_WAVE';
    encoding: 'PCM16' | 'FLOAT32';
    sampleRateHz: number;
    channelCount: number;
    sampleFrameCount: number;
    durationMs: number;
    performanceOriginSourceMs: number;
  };
  physicalMidi: {
    sourceKind: 'BROWSER_CAPTURE_EVENT_LOG' | 'SYNCHRONIZED_PERFORMANCE_MIDI';
    path: string;
    sha256: string;
    sameTakeAudioSha256: string;
    exportedSmfPath?: string;
    exportedSmfSha256?: string;
  };
  segments: readonly {
    segmentId: string;
    sourcePerformanceStartSampleBoundary: number;
    sourcePerformanceEndSampleBoundary: number;
    sourceContextTailEndSampleBoundary: number;
    performanceStartMs: number;
    performanceEndMs: number;
  }[];
  sync: {
    quality: SyncQuality;
    method: string;
    sharedCaptureClockId?: string;
    offsetMs?: number;
    uncertaintyMs?: number;
    calibrationArtifactPath?: string;
    calibrationArtifactSha256?: string;
  };
  familyTags?: readonly string[];
  expectedGroupFamilyTags?: Record<string, readonly string[]>;
  captureInstructions?: readonly string[];
  performerId?: string;
  setupId?: string;
  pieceId?: string;
  publicProxy?: { status: 'PUBLIC_EXTERNAL_PROXY_NOT_PRODUCT_CAPTURE'; datasetId: string };
};

export type ContinuousPairedTakeImportReceipt = {
  takeId: string;
  scenario: BenchmarkScenario;
  practiceScoreArtifactSha256: string;
  derivedExpectedStrikeCount: number;
  derivedPhysicalAttackCount: number;
  sourceAudioSha256: string;
  sourceMidiSha256: string;
};

export type ContinuousCorpusAudit = {
  schemaVersion: 2;
  takeCount: number;
  scoreableTakeCount: number;
  blockedTakeCount: number;
  countsBySplit: Record<Split, number>;
  countsByFamily: Record<string, number>;
  blockers: Record<string, string[]>;
  splitLeakage: string[];
  candidateEligibility: Record<CandidateId, Record<string, CandidateEligibility>>;
  realRecordedTakeCount: number;
  scoreableRealTakeCount: number;
  status: 'CORPUS_SCHEMA_READY' | 'CAPTURE_HARNESS_READY' | 'CAPTURE_PIPELINE_READY' | 'BLOCKED';
  nextAction: 'RECORD_REAL_PAIRED_DEVELOPMENT_TAKES' | 'RUN_FROZEN_DEVELOPMENT_CANDIDATES_ONLY';
  productAccuracyMetric: false;
};

export type ImportContinuousPairedTakeOptions = { repoRoot?: string };

export function importContinuousPairedTakeAsBenchmarkScenario(
  manifest: ContinuousPairedTakeManifest,
  takeId: string,
  options: ImportContinuousPairedTakeOptions = {},
): BenchmarkScenario {
  return importContinuousPairedTake(manifest, takeId, options).scenario;
}

export function importContinuousPairedTake(
  manifest: ContinuousPairedTakeManifest,
  takeId: string,
  options: ImportContinuousPairedTakeOptions = {},
): ContinuousPairedTakeImportReceipt {
  if (manifest.schemaVersion !== 2) throw new Error('Only ContinuousPairedTakeManifest schemaVersion 2 is accepted.');
  validateManifestSplit(manifest.split);
  const take = manifest.takes.find((candidate) => candidate.takeId === takeId);
  if (!take) throw new Error(`Continuous paired take not found: ${takeId}`);
  validateTakeShape(take);
  validateSync(take);

  const repoRoot = options.repoRoot ?? process.cwd();
  const artifact = loadPracticeScoreArtifact(take, repoRoot);
  const audio = readAndVerifyWav(take.audio, repoRoot);
  const physical = derivePhysicalMidiAttacks(take, repoRoot);
  validateSegments(take, audio);

  const expectedStrikes = buildContinuousExpectedStrikes({
    artifact,
    tempoSelection: take.practice.tempoSelection,
    scope: take.practice.scope,
  });
  if (expectedStrikes.length === 0) throw new Error('PracticeScoreArtifact-derived ExpectedStrike timeline is empty.');
  const scenario: BenchmarkScenario = {
    scenarioId: take.takeId,
    schemaVersion: 1,
    split: manifest.split,
    familyTags: take.familyTags ?? [],
    source: {
      sourceAudioPath: normalizeResearchPath(take.audio.path),
      sourceAudioSha256: take.audio.sha256,
      sourceMidiPath: normalizeResearchPath(take.physicalMidi.path),
      sourceMidiSha256: take.physicalMidi.sha256,
      provenance: take.publicProxy?.status ?? 'CONTINUOUS_PAIRED_TAKE_MANIFEST_V2',
    },
    audio: {
      nativeSampleRateHz: audio.sampleRateHz,
      channelPolicy: `${audio.channelCount}_channel_${take.audio.encoding}`,
      clipStartMs: 0,
      clipEndMs: audio.durationMs,
      performanceOriginSourceMs: take.audio.performanceOriginSourceMs,
      sourceDurationMs: audio.durationMs,
      pcmIdentity: take.audio.sha256,
    },
    expectedStrikes,
    physicalGroundTruth: {
      status: 'RECORDED',
      sourceKind: 'PAIRED_PHYSICAL_MIDI',
      source: normalizeResearchPath(take.physicalMidi.path),
      attacks: physical.noteOns,
    },
    completion: take.practice.completion,
    taxonomy: buildTaxonomy(take, expectedStrikes),
    corpusOverlapStatus: 'UNKNOWN',
  };
  validateBenchmarkScenario(scenario);
  return {
    takeId: take.takeId,
    scenario,
    practiceScoreArtifactSha256: take.score.practiceScoreArtifactSha256,
    derivedExpectedStrikeCount: expectedStrikes.length,
    derivedPhysicalAttackCount: physical.noteOns.length,
    sourceAudioSha256: take.audio.sha256,
    sourceMidiSha256: take.physicalMidi.sha256,
  };
}

export function auditContinuousPairedTakeCorpus(
  manifest: ContinuousPairedTakeManifest,
  options: ImportContinuousPairedTakeOptions = {},
): ContinuousCorpusAudit {
  const blockers: Record<string, string[]> = {};
  const countsBySplit = { DEVELOPMENT: 0, CALIBRATION: 0, EVALUATION: 0 };
  countsBySplit[manifest.split] = manifest.takes.length;
  const countsByFamily: Record<string, number> = {};
  let scoreableTakeCount = 0;
  const bytedanceEligibility: Record<string, CandidateEligibility> = {};
  const onlineAmtEligibility: Record<string, CandidateEligibility> = {};
  const seenTakeIds = new Set<string>();
  for (const take of manifest.takes) {
    for (const tag of take.familyTags ?? []) countsByFamily[tag] = (countsByFamily[tag] ?? 0) + 1;
    try {
      if (seenTakeIds.has(take.takeId)) throw new Error(`Duplicate takeId: ${take.takeId}`);
      seenTakeIds.add(take.takeId);
      const receipt = importContinuousPairedTake(manifest, take.takeId, options);
      scoreableTakeCount += 1;
      bytedanceEligibility[take.takeId] = byteDanceEligible(receipt.scenario);
      onlineAmtEligibility[take.takeId] = onlineAmtEligible(take, receipt.scenario);
    } catch (error) {
      blockers[take.takeId] = [error instanceof Error ? error.message : String(error)];
      bytedanceEligibility[take.takeId] = 'INELIGIBLE_INVALID_CORPUS_TAKE';
      onlineAmtEligibility[take.takeId] = 'INELIGIBLE_INVALID_CORPUS_TAKE';
    }
  }
  const leakage = detectContinuousSplitLeakage([{ split: manifest.split, takes: manifest.takes }]);
  if (manifest.split === 'EVALUATION') {
    try {
      validateEvaluationLock(manifest);
    } catch (error) {
      blockers.__evaluationLock = [error instanceof Error ? error.message : String(error)];
    }
  }
  return {
    schemaVersion: 2,
    takeCount: manifest.takes.length,
    scoreableTakeCount,
    blockedTakeCount: manifest.takes.length - scoreableTakeCount,
    countsBySplit,
    countsByFamily,
    blockers,
    splitLeakage: leakage,
    candidateEligibility: {
      'bytedance-score-aware-chunked-dev-v1': bytedanceEligibility,
      'online-amt-stateful-modern-compat-dev-v1': onlineAmtEligibility,
    },
    realRecordedTakeCount: manifest.takes.filter((take) => !take.publicProxy).length,
    scoreableRealTakeCount: manifest.takes.filter((take) => !take.publicProxy && !blockers[take.takeId]).length,
    status: manifest.takes.length === 0 ? 'CAPTURE_PIPELINE_READY' : (Object.keys(blockers).length === 0 ? 'CAPTURE_PIPELINE_READY' : 'BLOCKED'),
    nextAction: manifest.takes.length === 0 ? 'RECORD_REAL_PAIRED_DEVELOPMENT_TAKES' : 'RUN_FROZEN_DEVELOPMENT_CANDIDATES_ONLY',
    productAccuracyMetric: false,
  };
}

export function validateEvaluationLock(manifest: ContinuousPairedTakeManifest): void {
  if (manifest.split !== 'EVALUATION') return;
  if (!manifest.evaluationLock?.locked) throw new Error('EVALUATION manifests must be locked before scoring.');
  if (manifest.evaluationLock.lockProjectionSha256 !== evaluationLockProjectionSha256(manifest)) {
    throw new Error('EVALUATION manifest lock projection mismatch.');
  }
}

export function evaluationLockProjectionSha256(manifest: ContinuousPairedTakeManifest): string {
  return sha256Hex(canonicalJson({
    manifestId: manifest.manifestId,
    schemaVersion: manifest.schemaVersion,
    split: manifest.split,
    policy: manifest.policy,
    takes: manifest.takes.map((take) => ({
      takeId: take.takeId,
      captureSessionId: take.captureSessionId,
      audioSha256: take.audio.sha256,
      midiSha256: take.physicalMidi.sha256,
      practiceScoreArtifactSha256: take.score.practiceScoreArtifactSha256,
      sync: take.sync,
    })),
  }));
}

export function canonicalManifestSha256(manifest: ContinuousPairedTakeManifest): string {
  return sha256Hex(canonicalJson(manifest));
}

function validateTakeShape(take: ContinuousPairedTake): void {
  if (!take.captureSessionId) throw new Error('Continuous paired take requires captureSessionId.');
  if (!take.score.practiceScoreArtifactPath || !take.score.practiceScoreArtifactSha256) {
    throw new Error('PracticeScoreArtifact file path and SHA256 are required.');
  }
  if (!take.physicalMidi.path || !take.physicalMidi.sha256) throw new Error('Physical MIDI/capture-event source path and SHA256 are required.');
  if (take.physicalMidi.sameTakeAudioSha256 !== take.audio.sha256) throw new Error('Physical MIDI must be bound to the same-take microphone audio identity.');
  if (!take.practice.completion || !Number.isFinite(take.practice.completion.performanceTimeMs)) throw new Error('Continuous paired take requires authoritative completion.');
  if (!Array.isArray(take.segments) || take.segments.length === 0) throw new Error('Continuous paired take requires source/performance segments.');
}

function validateSync(take: ContinuousPairedTake): void {
  if (take.sync.quality === 'SHARED_CAPTURE_CLOCK_VERIFIED') {
    if (!take.sync.sharedCaptureClockId) throw new Error('Shared capture-clock synchronization requires sharedCaptureClockId.');
    return;
  }
  if (take.sync.quality === 'CALIBRATED_OFFSET') {
    if (!Number.isFinite(take.sync.offsetMs) || !Number.isFinite(take.sync.uncertaintyMs) || !take.sync.method || !take.sync.calibrationArtifactPath || !take.sync.calibrationArtifactSha256) {
      throw new Error('CALIBRATED_OFFSET synchronization requires offset, uncertainty, method, and calibration artifact identity.');
    }
    return;
  }
  if (take.sync.quality === 'INSUFFICIENT_SYNCHRONIZATION') throw new Error('Insufficient synchronization blocks scoreability.');
  throw new Error('Unknown synchronization quality.');
}

function loadPracticeScoreArtifact(take: ContinuousPairedTake, repoRoot: string): PracticeScoreArtifact {
  const bytes = readVerifiedFile(take.score.practiceScoreArtifactPath, take.score.practiceScoreArtifactSha256, repoRoot, 'PracticeScoreArtifact');
  const artifact = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
  assertPracticeScoreArtifact(artifact);
  if ((artifact as PracticeScoreArtifact).schemaVersion !== take.score.practiceScoreArtifactSchemaVersion) {
    throw new Error('PracticeScoreArtifact schema version does not match manifest.');
  }
  return artifact as PracticeScoreArtifact;
}

function readAndVerifyWav(audio: ContinuousPairedTake['audio'], repoRoot: string): {
  sampleRateHz: number;
  channelCount: number;
  sampleFrameCount: number;
  durationMs: number;
} {
  const bytes = readVerifiedFile(audio.path, audio.sha256, repoRoot, 'audio');
  const metadata = parseWavMetadata(bytes);
  if (metadata.sampleRateHz !== audio.sampleRateHz) throw new Error('WAV sample rate mismatch.');
  if (metadata.channelCount !== audio.channelCount) throw new Error('WAV channel count mismatch.');
  if (metadata.encoding !== audio.encoding) throw new Error('WAV encoding mismatch.');
  if (metadata.sampleFrameCount !== audio.sampleFrameCount) throw new Error('WAV sample frame count mismatch.');
  if (Math.abs(metadata.durationMs - audio.durationMs) > 1) throw new Error('WAV duration mismatch.');
  return metadata;
}

function derivePhysicalMidiAttacks(take: ContinuousPairedTake, repoRoot: string): {
  noteOns: NonNullable<BenchmarkScenario['physicalGroundTruth']>['attacks'];
} {
  const bytes = readVerifiedFile(take.physicalMidi.path, take.physicalMidi.sha256, repoRoot, 'physical MIDI/capture-event artifact');
  if (take.physicalMidi.sourceKind === 'BROWSER_CAPTURE_EVENT_LOG') {
    const log = JSON.parse(Buffer.from(bytes).toString('utf8')) as {
      events?: readonly { eventId?: string; type?: string; messageType?: string; pitch?: string; midiNote?: number; velocity?: number; performanceTimeMs?: number }[];
    };
    return {
      noteOns: (log.events ?? [])
        .filter((event) => event.type === 'NOTE_ON' || event.messageType === 'NOTE_ON')
        .filter((event) => (event.velocity ?? 1) > 0)
        .map((event, index) => ({
          physicalEventId: event.eventId ?? `capture-note-on-${index}`,
          pitch: event.pitch ?? midiToPitchName(event.midiNote ?? 60),
          performanceTimeMs: requireFinite(event.performanceTimeMs, 'capture MIDI performanceTimeMs'),
          velocity: event.velocity,
        })),
    };
  }
  const midi = new Midi(bytes);
  return {
    noteOns: midi.tracks.flatMap((track, trackIndex) => track.notes.map((note, noteIndex) => ({
      physicalEventId: `smf-track${trackIndex}-note${noteIndex}-${note.midi}-${Math.round(note.time * 1_000_000)}`,
      pitch: midiToPitchName(note.midi),
      performanceTimeMs: note.time * 1000,
      velocity: Math.round(note.velocity * 127),
    }))).sort((left, right) => left.performanceTimeMs - right.performanceTimeMs || left.pitch.localeCompare(right.pitch) || left.physicalEventId.localeCompare(right.physicalEventId)),
  };
}

function validateSegments(take: ContinuousPairedTake, audio: { sampleRateHz: number; sampleFrameCount: number }): void {
  const seen = new Set<string>();
  let previousSourceEnd = -Infinity;
  let previousPerformanceEnd = -Infinity;
  for (const segment of take.segments) {
    if (!segment.segmentId || seen.has(segment.segmentId)) throw new Error('Segments require unique non-empty ids.');
    seen.add(segment.segmentId);
    const { sourcePerformanceStartSampleBoundary: start, sourcePerformanceEndSampleBoundary: end, sourceContextTailEndSampleBoundary: contextEnd } = segment;
    if (![start, end, contextEnd].every((value) => Number.isInteger(value) && value >= 0) || start > end || end > contextEnd) throw new Error('Source sample boundaries must be half-open and ordered.');
    if (contextEnd > audio.sampleFrameCount) throw new Error('Source sample boundary exceeds audio file.');
    if (start < previousSourceEnd) throw new Error('Source sample identity cannot move backward between segments.');
    if (segment.performanceStartMs < previousPerformanceEnd) throw new Error('Pause/resume segments must not overlap in performance time.');
    const sourcePerformanceMs = ((end - start) / audio.sampleRateHz) * 1000;
    const declaredMs = segment.performanceEndMs - segment.performanceStartMs;
    if (Math.abs(sourcePerformanceMs - declaredMs) > 1) throw new Error('Source sample range does not match performance ownership duration.');
    if (segment.performanceEndMs > take.practice.completion.performanceTimeMs + 1e-9) throw new Error('Segment performance ownership cannot extend beyond completion.');
    previousSourceEnd = contextEnd;
    previousPerformanceEnd = segment.performanceEndMs;
  }
}

function buildTaxonomy(take: ContinuousPairedTake, expectedStrikes: BenchmarkScenario['expectedStrikes']): NonNullable<BenchmarkScenario['taxonomy']> {
  const validGroups = new Set(expectedStrikes.map((strike) => strike.groupId));
  const groups: Record<string, string[]> = {};
  for (const [groupId, tags] of Object.entries(take.expectedGroupFamilyTags ?? {})) {
    if (!validGroups.has(groupId)) throw new Error(`Taxonomy references unknown expectedGroupId: ${groupId}`);
    groups[groupId] = [...tags];
  }
  return { groups };
}

function byteDanceEligible(scenario: BenchmarkScenario): CandidateEligibility {
  try {
    validateByteDanceSourceContext(scenario, planByteDanceScoreAwareChunks(scenario));
    return 'ELIGIBLE';
  } catch {
    return 'INELIGIBLE_INSUFFICIENT_CONTEXT';
  }
}

function onlineAmtEligible(take: ContinuousPairedTake, scenario: BenchmarkScenario): CandidateEligibility {
  const completion = scenario.completion?.performanceTimeMs ?? 0;
  for (const segment of take.segments) {
    const ownedMs = segment.performanceEndMs - segment.performanceStartMs;
    const ownedSamples = Math.round((ownedMs / 1000) * ONLINE_AMT_STREAMING_BASELINE_CONFIG.sampleRateHz);
    const required = onlineAmtSegmentTailRequirement(ownedSamples);
    const tailMs = ((segment.sourceContextTailEndSampleBoundary - segment.sourcePerformanceEndSampleBoundary) / take.audio.sampleRateHz) * 1000;
    const requiredTailMs = (required.requiredContextTailSamples / ONLINE_AMT_STREAMING_BASELINE_CONFIG.sampleRateHz) * 1000;
    if (tailMs + 1e-9 < requiredTailMs) return 'INELIGIBLE_INSUFFICIENT_CONTEXT';
    if (segment.performanceEndMs > completion + 1e-9) return 'INELIGIBLE_INVALID_CORPUS_TAKE';
  }
  return 'ELIGIBLE';
}

export function detectContinuousSplitLeakage(manifests: readonly { split: Split; takes: readonly ContinuousPairedTake[] }[]): string[] {
  const byIdentity = new Map<string, Set<Split>>();
  for (const manifest of manifests) {
    for (const take of manifest.takes) {
      for (const identity of [take.audio.sha256, take.physicalMidi.sha256, take.captureSessionId]) {
        const splits = byIdentity.get(identity) ?? new Set<Split>();
        splits.add(manifest.split);
        byIdentity.set(identity, splits);
      }
    }
  }
  return [...byIdentity.entries()].filter(([, splits]) => splits.size > 1).map(([identity, splits]) => `${identity} appears in splits ${[...splits].sort().join(',')}`);
}

function parseWavMetadata(bytes: Uint8Array): { sampleRateHz: number; channelCount: number; sampleFrameCount: number; durationMs: number; encoding: 'PCM16' | 'FLOAT32' } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WAVE') throw new Error('Unsupported audio container; expected RIFF/WAVE.');
  let offset = 12;
  let format: { audioFormat: number; channelCount: number; sampleRateHz: number; bitsPerSample: number } | null = null;
  let dataBytes = 0;
  while (offset + 8 <= bytes.length) {
    const id = ascii(bytes, offset, 4);
    const size = view.getUint32(offset + 4, true);
    const dataOffset = offset + 8;
    if (id === 'fmt ') {
      format = { audioFormat: view.getUint16(dataOffset, true), channelCount: view.getUint16(dataOffset + 2, true), sampleRateHz: view.getUint32(dataOffset + 4, true), bitsPerSample: view.getUint16(dataOffset + 14, true) };
    } else if (id === 'data') dataBytes = size;
    offset = dataOffset + size + (size % 2);
  }
  if (!format || dataBytes <= 0) throw new Error('WAV file requires fmt and data chunks.');
  const encoding = format.audioFormat === 1 && format.bitsPerSample === 16 ? 'PCM16' : format.audioFormat === 3 && format.bitsPerSample === 32 ? 'FLOAT32' : null;
  if (!encoding) throw new Error('Unsupported WAV encoding; expected PCM16 or FLOAT32.');
  const sampleFrameCount = dataBytes / ((format.bitsPerSample / 8) * format.channelCount);
  if (!Number.isInteger(sampleFrameCount)) throw new Error('WAV data chunk is not aligned to sample frames.');
  return { sampleRateHz: format.sampleRateHz, channelCount: format.channelCount, sampleFrameCount, durationMs: (sampleFrameCount / format.sampleRateHz) * 1000, encoding };
}

function validateManifestSplit(split: Split): void {
  if (!['DEVELOPMENT', 'CALIBRATION', 'EVALUATION'].includes(split)) throw new Error('Invalid Continuous corpus split.');
}

function readVerifiedFile(relativePath: string, expectedSha256: string, repoRoot: string, label: string): Uint8Array {
  const absolute = path.resolve(repoRoot, relativePath);
  if (!existsSync(absolute)) throw new Error(`${label} file missing: ${relativePath}`);
  const bytes = readFileSync(absolute);
  if (sha256Bytes(bytes) !== expectedSha256) throw new Error(`${label} SHA256 mismatch for ${relativePath}.`);
  return bytes;
}

function sha256Bytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return Buffer.from(bytes.subarray(offset, offset + length)).toString('ascii');
}

function midiToPitchName(midi: number): string {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  return `${names[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

function requireFinite(value: unknown, label: string): number {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite.`);
  return value as number;
}

function normalizeResearchPath(value: string): string {
  return value.replaceAll('\\', '/');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
}
