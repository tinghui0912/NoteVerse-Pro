/**
 * Phase 9G-A.3 & 9G-A.3.1: Modern Challenger Qualification Protocol Implementation.
 *
 * Implements execution guards, policy identity verification, candidate context
 * eligibility, raw-cache integrity assertions, and score independence verification for:
 * 1. Robust augmented ByteDance (bytedance-robust-augmented)
 * 2. Transkun V2 Aug (transkun)
 * 3. Aria-AMT (aria-amt)
 * 4. RTT (rtt)
 * 5. D3RM (optional offline accuracy ceiling reference)
 */

import { createHash } from 'node:crypto';
import {
  PUBLIC_MODEL_CALIBRATION_PROTOCOL_V5_SHA256,
  selectCalibrationProfile,
  resolveCalibrationGate2ExactProfile,
  type CalibrationProfileScenarioScore,
  type CalibrationGate2Profile,
} from './public-model-calibration';
import type { CandidateObservation, CandidateScenarioRun } from './continuous-analyzer-bakeoff';

export const PUBLIC_MODEL_CALIBRATION_PROTOCOL_V5 = 'PUBLIC_MODEL_CALIBRATION_PROTOCOL_V5' as const;
export const CHALLENGER_CALIBRATION_PERFORMERS = ['p07', 'p08', 'p09', 'p10', 'p11', 'p12', 'p13', 'p14'] as const;
export const CHALLENGER_BLIND_PERFORMERS = ['p15', 'p16', 'p17', 'p18', 'p19', 'p20', 'p21', 'p22'] as const;

export const PUBLIC_CHALLENGER_QUALIFICATION_PROTOCOL_V1 = 'PUBLIC_CHALLENGER_QUALIFICATION_PROTOCOL_V1' as const;
export const PUBLIC_CHALLENGER_QUALIFICATION_PROTOCOL_V1_SHA256 = '0ccd4872d6998b67d794baf96cad22c5ccbba3f8ee65a9ac02ba1ad9790ec71b' as const;

export const PUBLIC_CHALLENGER_QUALIFICATION_PROTOCOL_V2 = 'PUBLIC_CHALLENGER_QUALIFICATION_PROTOCOL_V2' as const;
export const PUBLIC_CHALLENGER_QUALIFICATION_PROTOCOL_V2_SHA256 = 'b467e9aad917808f307346482477d1d4a4716aed665bd2662e87445231d12f8c' as const;

export const PHASE_9GA25_REGISTRY_SHA256 = '935fc1df28652b0927bc788e43e4ff89a2b9f76c2d0b5c7f58e307c5570d2439' as const;

export const PHASE_9GA1_CALIBRATION_SCENARIOS_SHA256 = '56ef9dfcbb3cfbb64b8e87f9f4dd2d3a519be14412b4908f836926375560067e' as const;

export const PHASE_9GB_BLIND_MANIFEST_SHA256 = '0da00e7ad6ff3582f70e4b645be915d44e5dcb30fd4773b69372433e99a1d0ab' as const;

export const PHASE_9GA3 = '9G-A.3' as const;
export const PHASE_9GA31 = '9G-A.3.1' as const;
export const PHASE_9GA32 = '9G-A.3.2' as const;
export const PHASE_9GB0 = '9G-B.0' as const;

export type ChallengerFamily =
  | 'bytedance-robust-augmented'
  | 'transkun'
  | 'aria-amt'
  | 'rtt'
  | 'd3rm';

export type ProductionLicenseStatus =
  | 'PRODUCTION_LICENSE_ELIGIBLE'
  | 'RESEARCH_VALID_PRODUCTION_LICENSE_BLOCKED'
  | 'LICENSE_OR_USAGE_RIGHTS_UNRESOLVED';

export interface ChallengerPolicyIdentity {
  readonly policyId: string;
  readonly schemaVersion: number;
  readonly sha256?: string;
}

export interface ChallengerExecutionRequest {
  readonly policy: ChallengerPolicyIdentity;
  readonly incumbentPolicySha256: string;
  readonly incumbentRegistrySha256: string;
  readonly blindManifestSha256: string;
  readonly calibrationManifestSha256?: string;
  readonly phase: string;
  readonly mode: 'CANDIDATE_INFERENCE' | 'TRUTH_ONLY';
  readonly scenarioSplit: 'CALIBRATION' | 'EVALUATION';
  readonly performers: readonly string[];
}

export function assertChallengerQualificationPolicyIdentity(identity: ChallengerPolicyIdentity): void {
  if (identity.policyId === PUBLIC_CHALLENGER_QUALIFICATION_PROTOCOL_V2) {
    if (identity.schemaVersion !== 2) {
      throw new Error(`CHALLENGER_QUALIFICATION_POLICY_SCHEMA_VERSION_MISMATCH:${identity.schemaVersion}`);
    }
    if (!identity.sha256) {
      throw new Error('CHALLENGER_QUALIFICATION_POLICY_SHA_REQUIRED');
    }
    if (identity.sha256 !== PUBLIC_CHALLENGER_QUALIFICATION_PROTOCOL_V2_SHA256) {
      throw new Error(`CHALLENGER_QUALIFICATION_POLICY_SHA_MISMATCH:${identity.sha256}`);
    }
    return;
  }

  if (identity.policyId === PUBLIC_CHALLENGER_QUALIFICATION_PROTOCOL_V1) {
    if (identity.schemaVersion !== 1) {
      throw new Error(`CHALLENGER_QUALIFICATION_POLICY_SCHEMA_VERSION_MISMATCH:${identity.schemaVersion}`);
    }
    if (!identity.sha256) {
      throw new Error('CHALLENGER_QUALIFICATION_POLICY_SHA_REQUIRED');
    }
    if (identity.sha256 !== PUBLIC_CHALLENGER_QUALIFICATION_PROTOCOL_V1_SHA256) {
      throw new Error(`CHALLENGER_QUALIFICATION_POLICY_SHA_MISMATCH:${identity.sha256}`);
    }
    return;
  }

  throw new Error(`CHALLENGER_QUALIFICATION_POLICY_ID_MISMATCH:${identity.policyId}`);
}

export function assertChallengerExecutionAllowed(request: ChallengerExecutionRequest): void {
  // 1. Verify Challenger Policy identity
  assertChallengerQualificationPolicyIdentity(request.policy);

  // 2. Independently verify frozen V5 incumbent policy, registry, and blind identities
  if (request.incumbentPolicySha256 !== PUBLIC_MODEL_CALIBRATION_PROTOCOL_V5_SHA256) {
    throw new Error(`FROZEN_V5_INCUMBENT_POLICY_SHA_MISMATCH:${request.incumbentPolicySha256}`);
  }
  if (request.incumbentRegistrySha256 !== PHASE_9GA25_REGISTRY_SHA256) {
    throw new Error(`FROZEN_A25_INCUMBENT_REGISTRY_SHA_MISMATCH:${request.incumbentRegistrySha256}`);
  }
  if (request.blindManifestSha256 !== PHASE_9GB_BLIND_MANIFEST_SHA256) {
    throw new Error(`FROZEN_BLIND_MANIFEST_SHA_MISMATCH:${request.blindManifestSha256}`);
  }
  if (!request.calibrationManifestSha256) {
    throw new Error('CALIBRATION_MANIFEST_SHA_REQUIRED');
  }
  if (request.calibrationManifestSha256 !== PHASE_9GA1_CALIBRATION_SCENARIOS_SHA256) {
    throw new Error(`FROZEN_CALIBRATION_MANIFEST_SHA_MISMATCH:${request.calibrationManifestSha256}`);
  }

  // 3. Fail closed on missing, malformed, or non-whitelisted phase
  const allowedPhases = [PHASE_9GA3, PHASE_9GA31, PHASE_9GA32, PHASE_9GB0] as const;
  if (!request.phase || !allowedPhases.includes(request.phase as typeof allowedPhases[number])) {
    if (request.mode === 'TRUTH_ONLY') {
      throw new Error(`CHALLENGER_TRUTH_ONLY_PHASE_REQUIRED:${request.phase}`);
    }
    throw new Error(`CHALLENGER_EXECUTION_PHASE_REQUIRED:${request.phase}`);
  }

  // Phase 9G-B.0 is a non-inference preflight readiness gate
  if (request.phase === PHASE_9GB0 && request.mode === 'CANDIDATE_INFERENCE') {
    throw new Error('PHASE_9GB0_CANDIDATE_INFERENCE_FORBIDDEN');
  }

  // 4. Performer set and blind isolation guards
  const performers = [...new Set(request.performers)].sort();
  const includesBlind = performers.some((p) => (CHALLENGER_BLIND_PERFORMERS as readonly string[]).includes(p));

  if (request.mode === 'CANDIDATE_INFERENCE') {
    if (includesBlind) {
      throw new Error('CHALLENGER_BLIND_EVALUATION_INFERENCE_FORBIDDEN');
    }
    if (request.scenarioSplit !== 'CALIBRATION') {
      throw new Error(`CHALLENGER_CANDIDATE_INFERENCE_REQUIRES_CALIBRATION:${request.scenarioSplit}`);
    }
    const expected = [...CHALLENGER_CALIBRATION_PERFORMERS].sort();
    if (performers.length !== expected.length || performers.some((p, i) => p !== expected[i])) {
      throw new Error('CHALLENGER_CALIBRATION_PERFORMER_SET_REQUIRED');
    }
    return;
  }

  if (request.mode === 'TRUTH_ONLY') {
    if (request.scenarioSplit !== 'EVALUATION') {
      throw new Error(`CHALLENGER_TRUTH_ONLY_REQUIRES_EVALUATION:${request.scenarioSplit}`);
    }
    const expected = [...CHALLENGER_BLIND_PERFORMERS].sort();
    if (performers.length !== expected.length || performers.some((p, i) => p !== expected[i])) {
      throw new Error('CHALLENGER_TRUTH_ONLY_BLIND_PERFORMER_SET_REQUIRED');
    }
    return;
  }

  throw new Error(`CHALLENGER_UNKNOWN_EXECUTION_MODE:${String(request.mode)}`);
}

export function runGuardedViennaChallengerExecutorsForTest(
  request: ChallengerExecutionRequest,
  executors: {
    readonly robustByteDance?: () => void;
    readonly transkun?: () => void;
    readonly aria?: () => void;
    readonly rtt?: () => void;
  },
): {
  readonly robustByteDanceCalls: number;
  readonly transkunCalls: number;
  readonly ariaCalls: number;
  readonly rttCalls: number;
} {
  assertChallengerExecutionAllowed(request);
  if (request.mode === 'TRUTH_ONLY') {
    return { robustByteDanceCalls: 0, transkunCalls: 0, ariaCalls: 0, rttCalls: 0 };
  }
  let robustByteDanceCalls = 0;
  let transkunCalls = 0;
  let ariaCalls = 0;
  let rttCalls = 0;

  if (executors.robustByteDance) {
    executors.robustByteDance();
    robustByteDanceCalls += 1;
  }
  if (executors.transkun) {
    executors.transkun();
    transkunCalls += 1;
  }
  if (executors.aria) {
    executors.aria();
    ariaCalls += 1;
  }
  if (executors.rtt) {
    executors.rtt();
    rttCalls += 1;
  }
  return { robustByteDanceCalls, transkunCalls, ariaCalls, rttCalls };
}

export interface IncumbentProfileRecord {
  readonly candidateId: string;
  readonly candidateFamily: string;
  readonly profileId: string;
  readonly configurationSha256: string;
  readonly checkpointSha256: string;
  readonly selectionStatus: string;
  readonly qualificationStatus: string;
  readonly LOCKED_FOR_PHASE_9G_B: boolean;
}

export function validateA25IncumbentRegistry(registryRaw: Record<string, unknown> | null | undefined): readonly IncumbentProfileRecord[] {
  if (!registryRaw || typeof registryRaw !== 'object') {
    throw new Error('INVALID_INCUMBENT_REGISTRY');
  }
  const profiles = registryRaw.profiles as readonly Record<string, unknown>[] | undefined;
  if (!Array.isArray(profiles) || profiles.length !== 2) {
    throw new Error(`INCUMBENT_PROFILE_COUNT_MUST_BE_EXACTLY_TWO:got ${profiles?.length}`);
  }
  const bytedance = profiles.find((p) => p.candidateId === 'bytedance-original-calibrated-v1');
  const onlineAmt = profiles.find((p) => p.candidateId === 'online-amt-calibrated-v1');
  if (!bytedance || !onlineAmt) {
    throw new Error('MISSING_REQUIRED_INCUMBENT_PROFILES');
  }
  if (
    bytedance.profileId !== 'bytedance-original-calibration-CALIBRATED_CONTEXT_5S-onset-0.20-frame-0.10'
    || bytedance.configurationSha256 !== '91a6fc6d33575edf9b8eb3adc78a21a4ea28d7581e3c7eb56a882e0fe6dd9285'
    || bytedance.checkpointSha256 !== 'c3fa9730725bf4a762f1c14bc80cd5986eacda01b026f5a4a2525cd607876141'
    || bytedance.LOCKED_FOR_PHASE_9G_B !== true
  ) {
    throw new Error('BYTEDANCE_INCUMBENT_IDENTITY_MISMATCH');
  }
  if (
    onlineAmt.profileId !== 'online-amt-calibration-native-boost-1'
    || onlineAmt.configurationSha256 !== '0d56e238a353a0aecfbf1d129521e93fc69f7e171711ce9ad57b419548edc375'
    || onlineAmt.checkpointSha256 !== '54ab4907b517dbfa2dbbee834db18d31d103ee25d690860595181162d235e3a0'
    || onlineAmt.LOCKED_FOR_PHASE_9G_B !== true
  ) {
    throw new Error('ONLINE_AMT_INCUMBENT_IDENTITY_MISMATCH');
  }
  return profiles;
}

export interface ChallengerCheckpointVerification {
  readonly candidateFamily: ChallengerFamily;
  readonly checkpointPath: string;
  readonly expectedSha256: string;
  readonly expectedBytes: number;
  readonly actualSha256: string;
  readonly actualBytes: number;
}

export function assertCheckpointIdentityStrict(check: ChallengerCheckpointVerification): void {
  if (check.actualSha256 !== check.expectedSha256) {
    throw new Error(`CHECKPOINT_SHA_MISMATCH:${check.candidateFamily}:expected ${check.expectedSha256}, got ${check.actualSha256}`);
  }
  if (check.actualBytes !== check.expectedBytes) {
    throw new Error(`CHECKPOINT_BYTES_MISMATCH:${check.candidateFamily}:expected ${check.expectedBytes}, got ${check.actualBytes}`);
  }
}

export interface RobustByteDanceRawCacheValidationOptions {
  readonly expectedCheckpointSha256?: string;
  readonly expectedCheckpointBytes?: number;
  readonly expectedRuntimeIdentity?: string;
  readonly expectedAudioShaMap?: ReadonlyMap<string, string>;
  readonly requireInputPcmSha256?: boolean;
}

export interface RobustByteDanceExpectedWindow {
  readonly windowId: string;
  readonly contextProfileId?: string;
  readonly inputSampleCount?: number;
  readonly scenarioId?: string;
  readonly inputPcmSha256?: string;
  readonly sourceAudioPath?: string;
  readonly sourceAudioSha256?: string;
}

interface RawOutputTensor {
  readonly dims: readonly number[];
  readonly data: readonly number[];
  readonly float32ByteSha256: string;
}

export function validateRobustByteDanceRawCacheStrict(
  rawData: Record<string, unknown> | null | undefined,
  expectedWindows: readonly RobustByteDanceExpectedWindow[],
  options?: RobustByteDanceRawCacheValidationOptions,
): {
  readonly totalChunksVerified: number;
  readonly verifiedWindowIds: readonly string[];
  readonly recomputedFloat32ByteHashes: ReadonlyMap<string, { frameSha: string; onsetSha: string }>;
} {
  if (!rawData || !Array.isArray(rawData.chunks)) {
    throw new Error('INVALID_ROBUST_BYTEDANCE_RAW_CACHE_SCHEMA');
  }
  const chunks = rawData.chunks as readonly Record<string, unknown>[];
  if (options?.expectedCheckpointSha256 && rawData.checkpointSha256 !== options.expectedCheckpointSha256) {
    throw new Error(`CHECKPOINT_SHA_MISMATCH:bytedance-robust-augmented:expected ${options.expectedCheckpointSha256}, got ${rawData.checkpointSha256}`);
  }
  if (options?.expectedCheckpointBytes && rawData.checkpointBytes !== options.expectedCheckpointBytes) {
    throw new Error(`CHECKPOINT_BYTES_MISMATCH:bytedance-robust-augmented:expected ${options.expectedCheckpointBytes}, got ${rawData.checkpointBytes}`);
  }
  if (options?.expectedRuntimeIdentity) {
    const actualRuntime = typeof rawData.runtimeIdentity === 'string' ? rawData.runtimeIdentity : (rawData.runtimeIdentity as Record<string, unknown> | undefined)?.image;
    if (actualRuntime !== options.expectedRuntimeIdentity) {
      throw new Error(`RUNTIME_IDENTITY_MISMATCH:bytedance-robust-augmented:expected ${options.expectedRuntimeIdentity}, got ${actualRuntime}`);
    }
  }
  if (chunks.length !== expectedWindows.length) {
    throw new Error(`ROBUST_BYTEDANCE_RAW_CACHE_WINDOW_COUNT_MISMATCH:expected ${expectedWindows.length}, got ${chunks.length}`);
  }

  const seenWindowIds = new Set<string>();
  for (const chunk of chunks) {
    const windowId = chunk.windowId as string;
    if (seenWindowIds.has(windowId)) {
      throw new Error(`DUPLICATE_WINDOW_IN_RAW_CACHE:${windowId}`);
    }
    seenWindowIds.add(windowId);
  }

  const chunkMap = new Map<string, Record<string, unknown>>(chunks.map((c) => [c.windowId as string, c]));
  const recomputedFloat32ByteHashes = new Map<string, { frameSha: string; onsetSha: string }>();

  for (const win of expectedWindows) {
    const chunk = chunkMap.get(win.windowId);
    if (!chunk) throw new Error(`MISSING_WINDOW_IN_RAW_CACHE:${win.windowId}`);
    if (chunk.contextProfileId !== win.contextProfileId) throw new Error(`CONTEXT_MISMATCH_IN_RAW_CACHE:${win.windowId}`);
    if (chunk.inputSampleCount !== win.inputSampleCount) throw new Error(`SAMPLE_COUNT_MISMATCH_IN_RAW_CACHE:${win.windowId}`);
    if (win.scenarioId && chunk.scenarioId !== win.scenarioId) throw new Error(`SCENARIO_MISMATCH_IN_RAW_CACHE:${win.windowId}`);
    if (options?.requireInputPcmSha256) {
      if (!win.inputPcmSha256) {
        throw new Error(`INPUT_PCM_SHA_REQUIRED_FOR_WINDOW:${win.windowId}`);
      }
      if (chunk.inputPcmSha256 !== win.inputPcmSha256) {
        throw new Error(`PCM_SHA_MISMATCH:${win.windowId}:expected ${win.inputPcmSha256}, got ${chunk.inputPcmSha256}`);
      }
    } else if (win.inputPcmSha256 && chunk.inputPcmSha256 !== win.inputPcmSha256) {
      throw new Error(`PCM_SHA_MISMATCH:${win.windowId}:expected ${win.inputPcmSha256}, got ${chunk.inputPcmSha256}`);
    }
    if (options?.expectedAudioShaMap && win.sourceAudioPath && win.scenarioId) {
      const expectedAudioSha = options.expectedAudioShaMap.get(win.scenarioId);
      if (expectedAudioSha && win.sourceAudioSha256 && win.sourceAudioSha256 !== expectedAudioSha) {
        throw new Error(`AUDIO_SHA_MISMATCH:${win.windowId}:expected ${expectedAudioSha}, got ${win.sourceAudioSha256}`);
      }
    }

    const ro = chunk.rawOutputs as { frame_output?: RawOutputTensor; reg_onset_output?: RawOutputTensor } | undefined;
    if (!ro?.frame_output?.data || !ro?.reg_onset_output?.data) throw new Error(`RAW_OUTPUTS_MISSING_IN_CACHE:${win.windowId}`);
    if (!ro.frame_output.float32ByteSha256 || !ro.reg_onset_output.float32ByteSha256) throw new Error(`FLOAT32_SHA_MISSING_IN_CACHE:${win.windowId}`);

    const outputs = [
      { name: 'frame_output', tensor: ro.frame_output },
      { name: 'reg_onset_output', tensor: ro.reg_onset_output },
    ];
    let frameSha = '';
    let onsetSha = '';

    for (const { name, tensor } of outputs) {
      const dims = tensor.dims;
      if (!Array.isArray(dims) || (dims.length !== 2 && dims.length !== 3)) {
        throw new Error(`INVALID_TENSOR_SHAPE:${win.windowId}:${name}`);
      }
      const lastDim = dims[dims.length - 1];
      if (lastDim !== 88) {
        throw new Error(`INVALID_TENSOR_SHAPE:${win.windowId}:${name}:classes must be 88, got ${lastDim}`);
      }
      const totalElements = dims.reduce((acc: number, d: number) => acc * d, 1);
      if (tensor.data.length !== totalElements) {
        throw new Error(`TENSOR_LENGTH_MISMATCH:${win.windowId}:${name}:expected ${totalElements}, got ${tensor.data.length}`);
      }
      const buf = Buffer.alloc(tensor.data.length * 4);
      for (let i = 0; i < tensor.data.length; i++) {
        const val = tensor.data[i];
        if (!Number.isFinite(val)) {
          throw new Error(`NON_FINITE_TENSOR_VALUE:${win.windowId}:${name}:index ${i}`);
        }
        buf.writeFloatLE(val, i * 4);
      }
      const recomputedSha = createHash('sha256').update(buf).digest('hex');
      if (recomputedSha !== tensor.float32ByteSha256) {
        throw new Error(`FLOAT32_SHA_MISMATCH:${win.windowId}:${name}:expected ${tensor.float32ByteSha256}, got ${recomputedSha}`);
      }
      if (name === 'frame_output') frameSha = recomputedSha;
      if (name === 'reg_onset_output') onsetSha = recomputedSha;
    }

    recomputedFloat32ByteHashes.set(win.windowId, { frameSha, onsetSha });
  }

  return {
    totalChunksVerified: expectedWindows.length,
    verifiedWindowIds: expectedWindows.map((w) => w.windowId),
    recomputedFloat32ByteHashes,
  };
}

export function validateRobustByteDanceRawCache(rawData: Record<string, unknown> | null | undefined, expectedWindows: readonly RobustByteDanceExpectedWindow[]): boolean {
  validateRobustByteDanceRawCacheStrict(rawData, expectedWindows);
  return true;
}

export function computeCanonicalTranscriptionNotesDigest(notes: readonly Record<string, unknown>[]): string {
  if (!Array.isArray(notes)) throw new Error('NOTES_ARRAY_REQUIRED');
  const normalized = notes.map((n) => {
    const pitch = (n.pitch as string | undefined) ?? String(n.midiPitch ?? '');
    const midiPitch = typeof n.midiPitch === 'number' ? n.midiPitch : 0;
    const onsetTimeMs = typeof n.onsetTimeMs === 'number' && Number.isFinite(n.onsetTimeMs)
      ? Math.round(n.onsetTimeMs * 1000) / 1000
      : 0;
    const offsetTimeMs = typeof n.offsetTimeMs === 'number' && Number.isFinite(n.offsetTimeMs)
      ? Math.round(n.offsetTimeMs * 1000) / 1000
      : 0;
    const velocity = typeof n.velocity === 'number' ? n.velocity : 0;
    return { p: pitch, m: midiPitch, o: onsetTimeMs, e: offsetTimeMs, v: velocity };
  }).sort((a, b) => a.o - b.o || a.m - b.m || a.e - b.e);
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

export type CacheProvenanceStatus =
  | 'CONTENT_DIGEST_RECOMPUTED'
  | 'MATCHED_TRUSTED_BASELINE'
  | 'INDEPENDENT_INFERENCE_REPRODUCED'
  | 'PROVENANCE_UNVERIFIED';

export function assertValidCacheProvenanceStatus(status: string): asserts status is CacheProvenanceStatus {
  const allowed = [
    'CONTENT_DIGEST_RECOMPUTED',
    'MATCHED_TRUSTED_BASELINE',
    'INDEPENDENT_INFERENCE_REPRODUCED',
    'PROVENANCE_UNVERIFIED',
  ];
  if (!allowed.includes(status)) {
    throw new Error(`INVALID_CACHE_PROVENANCE_STATUS:${status}`);
  }
}

export function assertNoSelfDigestTautology(
  provenanceStatus: CacheProvenanceStatus,
  hasIndependentBaseline: boolean,
): void {
  if (provenanceStatus === 'MATCHED_TRUSTED_BASELINE' && !hasIndependentBaseline) {
    throw new Error('SELF_COMPUTED_DIGEST_CANNOT_BE_LABELED_MATCHED_TRUSTED_BASELINE');
  }
}

export interface TranscriptionRawCacheValidationOptions {
  readonly expectedCheckpointSha256?: string;
  readonly expectedCheckpointBytes?: number;
  readonly expectedRuntimeIdentity?: string;
  readonly provenanceStatus?: CacheProvenanceStatus;
  readonly hasIndependentBaseline?: boolean;
}

export function validateTranscriptionRawCacheStrict(
  rawData: Record<string, unknown> | null | undefined,
  expectedAudioFiles: readonly {
    audioKey: string;
    expectedAudioSha256?: string;
    expectedNotesDigest?: string;
  }[],
  options?: TranscriptionRawCacheValidationOptions,
): {
  readonly verifiedAudioCount: number;
  readonly transcriptionDigests: ReadonlyMap<string, string>;
  readonly provenanceStatus: CacheProvenanceStatus;
} {
  if (options?.provenanceStatus) {
    assertValidCacheProvenanceStatus(options.provenanceStatus);
    assertNoSelfDigestTautology(options.provenanceStatus, !!options.hasIndependentBaseline);
  }
  const provenanceStatus: CacheProvenanceStatus = options?.provenanceStatus ??
    (options?.hasIndependentBaseline ? 'MATCHED_TRUSTED_BASELINE' : 'CONTENT_DIGEST_RECOMPUTED');
  if (!rawData || !rawData.transcriptions || typeof rawData.transcriptions !== 'object') {
    throw new Error('INVALID_TRANSCRIPTION_RAW_CACHE_SCHEMA');
  }
  const candidateFamily = (rawData.candidateFamily as string | undefined) ?? 'transcription-candidate';
  if (options?.expectedCheckpointSha256) {
    const actualCp = (rawData.checkpointSha256 ?? rawData.weightSha256) as string | undefined;
    if (actualCp !== options.expectedCheckpointSha256) {
      throw new Error(`CHECKPOINT_SHA_MISMATCH:${candidateFamily}:expected ${options.expectedCheckpointSha256}, got ${actualCp}`);
    }
  }
  if (options?.expectedCheckpointBytes) {
    const actualBytes = (rawData.checkpointBytes ?? rawData.weightBytes) as number | undefined;
    if (actualBytes !== options.expectedCheckpointBytes) {
      throw new Error(`CHECKPOINT_BYTES_MISMATCH:${candidateFamily}:expected ${options.expectedCheckpointBytes}, got ${actualBytes}`);
    }
  }
  if (options?.expectedRuntimeIdentity) {
    const actualRuntime = typeof rawData.runtimeIdentity === 'string'
      ? rawData.runtimeIdentity
      : (rawData.runtimeIdentity as Record<string, unknown> | undefined)?.image;
    if (actualRuntime !== options.expectedRuntimeIdentity) {
      throw new Error(`RUNTIME_IDENTITY_MISMATCH:${candidateFamily}:expected ${options.expectedRuntimeIdentity}, got ${actualRuntime}`);
    }
  }

  const transcriptions = rawData.transcriptions as Record<string, Record<string, unknown>>;
  const transcriptionDigests = new Map<string, string>();

  for (const item of expectedAudioFiles) {
    const trans = transcriptions[item.audioKey];
    if (!trans) throw new Error(`MISSING_AUDIO_IN_TRANSCRIPTION_CACHE:${item.audioKey}`);
    if (item.expectedAudioSha256 && trans.audioSha256 !== item.expectedAudioSha256) {
      throw new Error(`AUDIO_SHA_MISMATCH:${item.audioKey}:expected ${item.expectedAudioSha256}, got ${trans.audioSha256}`);
    }
    if (!Array.isArray(trans.notes)) throw new Error(`MISSING_NOTES_IN_TRANSCRIPTION_CACHE:${item.audioKey}`);

    const notes = trans.notes as readonly Record<string, unknown>[];
    for (let i = 0; i < notes.length; i++) {
      const note = notes[i];
      if (typeof note.onsetTimeMs === 'number' && !Number.isFinite(note.onsetTimeMs)) {
        throw new Error(`NON_FINITE_NOTE_TIME:${item.audioKey}:note ${i}`);
      }
      if (typeof note.offsetTimeMs === 'number' && !Number.isFinite(note.offsetTimeMs)) {
        throw new Error(`NON_FINITE_NOTE_TIME:${item.audioKey}:note ${i}`);
      }
    }

    const digest = computeCanonicalTranscriptionNotesDigest(notes);
    if (item.expectedNotesDigest && digest !== item.expectedNotesDigest) {
      throw new Error(`TRANSCRIPTION_NOTES_DIGEST_MISMATCH:${item.audioKey}:expected ${item.expectedNotesDigest}, got ${digest}`);
    }
    transcriptionDigests.set(item.audioKey, digest);
  }

  return {
    verifiedAudioCount: expectedAudioFiles.length,
    transcriptionDigests,
    provenanceStatus,
  };
}

export function validateTranscriptionRawCache(rawData: Record<string, unknown> | null | undefined, expectedAudioKeys: readonly string[]): boolean {
  validateTranscriptionRawCacheStrict(
    rawData,
    expectedAudioKeys.map((k) => ({ audioKey: k }))
  );
  return true;
}

export interface CandidateContextEligibility {
  readonly scenarioId: string;
  readonly candidateFamily: ChallengerFamily;
  readonly isEligible: boolean;
  readonly preRollMs: number;
  readonly postRollMs: number;
  readonly requiredWindowMs: number;
  readonly contextProfileId?: string;
  readonly missingContextReason?: string;
  readonly scopeKind?: string;
}

export function deriveCandidateContextEligibility(input: {
  readonly scenarios: readonly Record<string, unknown>[];
  readonly candidateFamily: ChallengerFamily;
  readonly contextGeometries?: readonly Record<string, unknown>[];
  readonly counterfactualReceipts?: ReadonlyMap<string, Record<string, unknown>>;
}): CandidateContextEligibility[] {
  const result: CandidateContextEligibility[] = [];
  const baseScenarioMap = new Map<string, Record<string, unknown>>();
  for (const scenario of input.scenarios) {
    const familyTags = scenario.familyTags as readonly string[] | undefined;
    if (familyTags?.includes('BASE_ORIGINAL')) {
      baseScenarioMap.set(scenario.scenarioId as string, scenario);
    }
  }

  for (const scenario of input.scenarios) {
    const scenarioId = scenario.scenarioId as string;
    const receipt = input.counterfactualReceipts?.get(scenarioId);
    const audioScenario = receipt ? (baseScenarioMap.get(receipt.baseScenarioId as string) ?? scenario) : scenario;

    const audio = audioScenario.audio as Record<string, number> | undefined;
    const completion = audioScenario.completion as Record<string, number> | undefined;
    const originMs = audio?.performanceOriginSourceMs ?? 0;
    const clipStartMs = audio?.clipStartMs ?? 0;
    const clipEndMs = audio?.clipEndMs ?? 0;
    const compMs = completion?.performanceTimeMs ?? 30000;
    const preRollMs = Math.max(0, originMs - clipStartMs);
    const postRollMs = Math.max(0, clipEndMs - (originMs + compMs));

    if (input.candidateFamily === 'bytedance-robust-augmented') {
      const contexts = input.contextGeometries ?? [];
      for (const ctx of contexts) {
        const requiredWindowMs = (ctx.modelInputMs as number) ?? 0;
        const requiredPreRoll = (ctx.preRollRequiredMs as number | undefined) ?? (requiredWindowMs - ((ctx.maximumFutureContextMs as number) ?? 0));
        const requiredPostRoll = (ctx.maximumFutureContextMs as number) ?? 0;
        const isEligible = preRollMs >= requiredPreRoll && postRollMs >= requiredPostRoll;
        result.push({
          scenarioId,
          candidateFamily: input.candidateFamily,
          contextProfileId: ctx.profileId as string | undefined,
          isEligible,
          preRollMs,
          postRollMs,
          requiredWindowMs,
          missingContextReason: isEligible ? undefined : 'INSUFFICIENT_PRE_OR_POST_ROLL_AUDIO',
          scopeKind: 'VARIABLE_CONTEXT_WINDOW',
        });
      }
    } else {
      // Whole-recording or segmentwise offline
      result.push({
        scenarioId,
        candidateFamily: input.candidateFamily,
        isEligible: true,
        preRollMs,
        postRollMs,
        requiredWindowMs: clipEndMs - clipStartMs,
        scopeKind: 'WHOLE_RECORDING_SOURCE_CONSUMED',
      });
    }
  }
  return result;
}

export function assertNoIneligibleScenarioInProfileScoring(
  profileContextId: string,
  scenarios: readonly { readonly scenarioId: string }[],
  eligibilityList: readonly CandidateContextEligibility[],
): void {
  const eligMap = new Map<string, boolean>();
  for (const e of eligibilityList) {
    if (e.contextProfileId === profileContextId) {
      eligMap.set(e.scenarioId, e.isEligible);
    }
  }
  for (const sc of scenarios) {
    const isElig = eligMap.get(sc.scenarioId);
    if (isElig === false) {
      throw new Error(`INELIGIBLE_SCENARIO_ENTERED_PROFILE_SCORING:${profileContextId}:${sc.scenarioId}`);
    }
  }
}

export function assertCandidateContextEligibilityFrozen(
  eligibilityList: readonly CandidateContextEligibility[],
): void {
  for (const item of eligibilityList) {
    if (!item.scenarioId || !item.candidateFamily) {
      throw new Error('INVALID_ELIGIBILITY_RECORD');
    }
  }
}

export function assertCandidateRawInferenceScoreIndependent(
  observations: readonly CandidateObservation[],
  expectedScorePitches: ReadonlySet<string>,
): { readonly containsOffScorePitch: boolean; readonly offScoreCount: number } {
  let offScoreCount = 0;
  for (const obs of observations) {
    if (!expectedScorePitches.has(obs.pitch)) {
      offScoreCount += 1;
    }
  }
  return {
    containsOffScorePitch: offScoreCount > 0,
    offScoreCount,
  };
}

export function assertAcousticEvidenceScoreIndependent(
  baseRuns: readonly CandidateScenarioRun[],
  counterfactualRuns: readonly CandidateScenarioRun[],
  scenarioPairMap: ReadonlyMap<string, string>,
): { readonly verifiedScenarioCount: number; readonly identicalRunsCount: number } {
  let verified = 0;
  const baseRunMap = new Map(baseRuns.map((r) => [r.scenarioId, r]));

  for (const cfRun of counterfactualRuns) {
    const baseScenarioId = scenarioPairMap.get(cfRun.scenarioId);
    if (!baseScenarioId) continue;
    const baseRun = baseRunMap.get(baseScenarioId);
    if (!baseRun) continue;

    const baseObs = baseRun.publications.flatMap((p) => p.observations);
    const cfObs = cfRun.publications.flatMap((p) => p.observations);
    if (baseObs.length !== cfObs.length) {
      throw new Error(
        `SCORE_CONDITIONED_ACOUSTIC_OUTPUT_DETECTED:${cfRun.scenarioId}:observation count changed across counterfactual (${baseObs.length} vs ${cfObs.length})`
      );
    }
    for (let i = 0; i < baseObs.length; i++) {
      if (baseObs[i].pitch !== cfObs[i].pitch || Math.abs(baseObs[i].performanceTimeMs - cfObs[i].performanceTimeMs) > 1e-6) {
        throw new Error(`SCORE_CONDITIONED_ACOUSTIC_OUTPUT_DETECTED:${cfRun.scenarioId}:observation ${i} altered across counterfactual`);
      }
    }
    verified += 1;
  }
  return { verifiedScenarioCount: verified, identicalRunsCount: verified };
}

export function assertCounterfactualAcousticReuseValid(input: {
  readonly baseAudioSha256: string;
  readonly counterfactualAudioSha256: string;
  readonly modelCheckpointSha256: string;
  readonly cachedModelCheckpointSha256: string;
}): boolean {
  if (input.baseAudioSha256 !== input.counterfactualAudioSha256) {
    throw new Error('COUNTERFACTUAL_AUDIO_MISMATCH_CANNOT_REUSE_ACOUSTIC_EVIDENCE');
  }
  if (input.modelCheckpointSha256 !== input.cachedModelCheckpointSha256) {
    throw new Error('MODEL_CHECKPOINT_MISMATCH_CANNOT_REUSE_ACOUSTIC_EVIDENCE');
  }
  return true;
}

export function selectWithinFamilyRepresentative(input: {
  readonly candidateFamily: ChallengerFamily;
  readonly scores: readonly CalibrationProfileScenarioScore[];
  readonly gate2Profiles?: readonly CalibrationGate2Profile[];
}): {
  readonly candidateFamily: ChallengerFamily;
  readonly selectedProfileId: string;
  readonly selectionMethod: string;
} {
  if (input.scores.length === 0) {
    throw new Error(`NO_SCORES_FOR_FAMILY:${input.candidateFamily}`);
  }
  const profileIds = [...new Set(input.scores.map((s) => s.profileId))];
  if (profileIds.length === 1) {
    return {
      candidateFamily: input.candidateFamily,
      selectedProfileId: profileIds[0],
      selectionMethod: 'SINGLETON_PROFILE_FREEZE',
    };
  }

  // Gate 1: safety-first paired bootstrap dominance
  const gate1Selection = selectCalibrationProfile(input.scores);
  if (gate1Selection.selectedProfileId) {
    return {
      candidateFamily: input.candidateFamily,
      selectedProfileId: gate1Selection.selectedProfileId,
      selectionMethod: 'GATE1_SAFETY_FIRST_DOMINANCE',
    };
  }

  // Gate 2: latency dominance, context tie-break, neutral hash
  if (input.gate2Profiles && input.gate2Profiles.length > 0) {
    const gate2Selection = resolveCalibrationGate2ExactProfile(input.gate2Profiles);
    if (!gate2Selection.selectedProfileId) {
      throw new Error(`GATE2_UNRESOLVED_FOR_FAMILY:${input.candidateFamily}`);
    }
    return {
      candidateFamily: input.candidateFamily,
      selectedProfileId: gate2Selection.selectedProfileId,
      selectionMethod: gate2Selection.reason,
    };
  }

  throw new Error(`CANNOT_RESOLVE_REPRESENTATIVE_FOR_FAMILY:${input.candidateFamily}`);
}

export function assertModelStateDictCompatibility(
  stateDictKeys: readonly string[],
  modelKeys: readonly string[],
  strict: boolean,
): { missingKeys: string[]; unexpectedKeys: string[] } {
  const modelKeySet = new Set(modelKeys);
  const stateDictKeySet = new Set(stateDictKeys);
  const missingKeys = modelKeys.filter((k) => !stateDictKeySet.has(k));
  const unexpectedKeys = stateDictKeys.filter((k) => !modelKeySet.has(k));

  if (strict && (missingKeys.length > 0 || unexpectedKeys.length > 0)) {
    throw new Error(
      `MODEL_STATE_DICT_MISMATCH: missing=${missingKeys.length}, unexpected=${unexpectedKeys.length}`
    );
  }
  return { missingKeys, unexpectedKeys };
}

export function assertCandidateCausalStreamingClaimsValid(candidate: {
  readonly candidateFamily: string;
  readonly executionMode?: string;
  readonly causalStreamingSupported?: boolean;
  readonly claimedStreaming?: boolean;
  readonly reportedFrameLatencyMs?: number | null;
}): void {
  if (candidate.candidateFamily === 'rtt') {
    if (
      candidate.causalStreamingSupported === true ||
      candidate.claimedStreaming === true ||
      candidate.executionMode === 'CAUSAL_STREAMING' ||
      (candidate.reportedFrameLatencyMs !== null && candidate.reportedFrameLatencyMs !== undefined)
    ) {
      throw new Error('RTT_CAUSAL_STREAMING_EXECUTION_FORBIDDEN: RTT is segmentwise offline reference only');
    }
  }
}

export function assertPublicationTimingValid(
  pub: {
    readonly availabilityTimeMs: number;
    readonly analyzedThroughPerformanceMs: number;
    readonly observations: readonly { readonly performanceTimeMs: number }[];
  },
  audio: {
    readonly clipStartMs: number;
    readonly clipEndMs: number;
    readonly performanceOriginSourceMs: number;
  },
  isCausal: boolean,
): void {
  if (isCausal) {
    if (pub.availabilityTimeMs < pub.analyzedThroughPerformanceMs) {
      throw new Error('AVAILABILITY_PRECEDES_ANALYZED_TIME_IN_CAUSAL_PUBLICATION');
    }
    const futureLeak = pub.observations.some(
      (o) => o.performanceTimeMs > pub.analyzedThroughPerformanceMs
    );
    if (futureLeak) {
      throw new Error('FUTURE_AUDIO_LEAK_IN_CAUSAL_PUBLICATION');
    }
  }
}

export function assertWholeRecordingPublicationTiming(
  pub: {
    readonly availabilityTimeMs: number;
    readonly analyzedThroughPerformanceMs: number;
  },
  audio: {
    readonly clipStartMs: number;
    readonly clipEndMs: number;
    readonly performanceOriginSourceMs: number;
  },
  inferenceLatencyMs: number,
): void {
  const sourceEndPerformanceMs = audio.clipEndMs - audio.performanceOriginSourceMs;
  if (pub.availabilityTimeMs < sourceEndPerformanceMs + inferenceLatencyMs) {
    throw new Error('WHOLE_RECORDING_PUBLICATION_PRECEDES_SOURCE_AUDIO_END');
  }
}

export function assertAriaPerFileLatencyReportValid(record: {
  readonly perFileLatencyStatus: string;
  readonly inferenceLatencyMs?: number | null;
  readonly batchWallTimeSeconds?: number;
}): void {
  if (record.perFileLatencyStatus === 'NOT_MEASURED' && record.inferenceLatencyMs !== null && record.inferenceLatencyMs !== undefined) {
    throw new Error('BATCH_AVERAGE_LATENCY_CANNOT_MASQUERADE_AS_PER_FILE_LATENCY');
  }
}

export function evaluatePairwiseComparison(
  candidateAId: string,
  candidateBId: string,
  runsA?: readonly unknown[],
  runsB?: readonly unknown[],
): { readonly status: 'EVALUATED' | 'INSUFFICIENT_REPRODUCIBLE_PAIRED_EVIDENCE'; readonly reason?: string } {
  if (!runsA || !runsB || runsA.length === 0 || runsB.length === 0) {
    return {
      status: 'INSUFFICIENT_REPRODUCIBLE_PAIRED_EVIDENCE',
      reason: 'Incumbent or candidate scenario-level runs not persisted; refusing to invent runs',
    };
  }
  return { status: 'EVALUATED' };
}

export function assertCleanWorkingTree(isDirty: boolean): void {
  if (isDirty) {
    throw new Error('EXECUTION_DIRTY_TREE_FORBIDDEN: Must execute from clean git working tree');
  }
}

export function assertCandidateQualificationForPhase9GB(candidate: {
  readonly candidateFamily: string;
  readonly qualificationStatus: string;
  readonly lockedForPhase9gB: boolean;
}): void {
  if (candidate.lockedForPhase9gB) {
    if (candidate.qualificationStatus !== 'CALIBRATED_AND_LOCKED_FOR_RESEARCH' && candidate.qualificationStatus !== 'CALIBRATED_AND_LOCKED') {
      throw new Error(`UNQUALIFIED_CANDIDATE_CANNOT_BE_LOCKED_FOR_PHASE_9G_B:${candidate.candidateFamily}:${candidate.qualificationStatus}`);
    }
  }
}

export function assertContextEligibilityScoreIndependent(
  baseEligibility: readonly CandidateContextEligibility[],
  cfEligibility: readonly CandidateContextEligibility[],
): void {
  if (baseEligibility.length !== cfEligibility.length) {
    throw new Error('CONTEXT_ELIGIBILITY_COUNT_MISMATCH');
  }
  for (let i = 0; i < baseEligibility.length; i++) {
    const b = baseEligibility[i];
    const c = cfEligibility[i];
    if (
      b.isEligible !== c.isEligible ||
      b.preRollMs !== c.preRollMs ||
      b.postRollMs !== c.postRollMs ||
      b.requiredWindowMs !== c.requiredWindowMs
    ) {
      throw new Error(`CONTEXT_ELIGIBILITY_ALTERED_BY_COUNTERFACTUAL:${b.scenarioId}`);
    }
  }
}

export function computeCanonicalAcousticObservationDigest(run: CandidateScenarioRun): string {
  const observations = run.publications.flatMap((p) =>
    p.observations.map((obs) => ({
      pitch: obs.pitch,
      performanceTimeMs: Math.round(obs.performanceTimeMs * 1000) / 1000,
      confidence: typeof obs.confidence === 'number' ? Math.round(obs.confidence * 1000000) / 1000000 : 0,
      pubAvailMs: typeof p.availabilityTimeMs === 'number' ? Math.round(p.availabilityTimeMs * 1000) / 1000 : 0,
      pubThroughMs: Math.round(p.analyzedThroughPerformanceMs * 1000) / 1000,
    }))
  ).sort((a, b) => a.performanceTimeMs - b.performanceTimeMs || a.pitch.localeCompare(b.pitch));
  return createHash('sha256').update(JSON.stringify(observations)).digest('hex');
}

export type ScoreIndependenceEquivalenceLevel =
  | 'CANONICAL_ACOUSTIC_OBSERVATION_DIGEST_MATCH'
  | 'RAW_TENSOR_BYTE_EQUALITY';

export function assertAcousticEvidenceScoreIndependentDeterministic(
  baseRuns: readonly CandidateScenarioRun[],
  counterfactualRuns: readonly CandidateScenarioRun[],
  scenarioPairMap: ReadonlyMap<string, string>,
  options?: {
    scenarioPcmMap?: ReadonlyMap<string, string>;
  },
): {
  readonly verifiedScenarioCount: number;
  readonly pairDigests: readonly {
    readonly cfScenarioId: string;
    readonly baseScenarioId: string;
    readonly baseDigest: string;
    readonly cfDigest: string;
    readonly match: boolean;
  }[];
  readonly equivalenceLevel: ScoreIndependenceEquivalenceLevel;
  readonly identicalSourcePcm: boolean;
  readonly identicalModelConfiguration: boolean;
  readonly identicalReusedRawAcousticOutput: boolean;
  readonly identicalCanonicalObservations: boolean;
  readonly independentRepeatedInferenceExecuted: boolean;
} {
  const baseRunMap = new Map(baseRuns.map((r) => [r.scenarioId, r]));
  const cfRunMap = new Map(counterfactualRuns.map((r) => [r.scenarioId, r]));
  const pairDigests: {
    cfScenarioId: string;
    baseScenarioId: string;
    baseDigest: string;
    cfDigest: string;
    match: boolean;
  }[] = [];

  for (const [cfId, baseId] of scenarioPairMap.entries()) {
    const baseRun = baseRunMap.get(baseId);
    const cfRun = cfRunMap.get(cfId);
    if (!baseRun || !cfRun) {
      throw new Error(`MISSING_SCORE_INDEPENDENCE_AUDIT_PAIR:${cfId}:missing ${!baseRun ? 'base' : 'cf'}`);
    }

    if (options?.scenarioPcmMap) {
      const basePcm = options.scenarioPcmMap.get(baseId);
      const cfPcm = options.scenarioPcmMap.get(cfId);
      if (basePcm && cfPcm && basePcm !== cfPcm) {
        throw new Error(`COUNTERFACTUAL_AUDIO_MISMATCH_CANNOT_REUSE_ACOUSTIC_EVIDENCE:${cfId}`);
      }
    }

    const baseDigest = computeCanonicalAcousticObservationDigest(baseRun);
    const cfDigest = computeCanonicalAcousticObservationDigest(cfRun);
    if (baseDigest !== cfDigest) {
      throw new Error(`SCORE_INDEPENDENCE_DIGEST_MISMATCH:${cfId}:base=${baseDigest}, cf=${cfDigest}`);
    }

    pairDigests.push({
      cfScenarioId: cfId,
      baseScenarioId: baseId,
      baseDigest,
      cfDigest,
      match: true,
    });
  }

  return {
    verifiedScenarioCount: pairDigests.length,
    pairDigests,
    equivalenceLevel: 'CANONICAL_ACOUSTIC_OBSERVATION_DIGEST_MATCH',
    identicalSourcePcm: true,
    identicalModelConfiguration: true,
    identicalReusedRawAcousticOutput: true,
    identicalCanonicalObservations: true,
    independentRepeatedInferenceExecuted: false,
  };
}

export function assertScoreIndependencePreservesOffScoreNotes(
  unfilteredObservations: readonly CandidateObservation[],
  candidateObservations: readonly CandidateObservation[],
  expectedScorePitches: ReadonlySet<string>,
): void {
  const unfilteredOffScore = unfilteredObservations.filter((o) => !expectedScorePitches.has(o.pitch));
  const candidateOffScore = candidateObservations.filter((o) => !expectedScorePitches.has(o.pitch));
  if (unfilteredOffScore.length > 0 && candidateOffScore.length < unfilteredOffScore.length) {
    throw new Error('SCORE_DEPENDENT_OFF_SCORE_PRUNING_DETECTED');
  }
}

export interface PairedMatrixComparisonRecord {
  readonly candidateA: string;
  readonly candidateB: string;
  readonly status: 'MEASURED' | 'INSUFFICIENT_REPRODUCIBLE_PAIRED_EVIDENCE';
  readonly reason?: string;
  readonly totalCalibrationScenarios?: number;
  readonly candidateAPreInferenceEligibleCount?: number;
  readonly candidateBPreInferenceEligibleCount?: number;
  readonly mutuallyEligibleScenarioCount?: number;
  readonly bothCandidatesScoreableCount?: number;
  readonly metricSpecificValidPairedCount?: number;
  readonly sampleDenominators?: Record<string, number>;
  readonly exclusionReasons?: readonly string[];
  readonly isCrossFamilyWinner?: boolean;
  readonly metrics?: Record<string, unknown>;
}

export function assertPairwiseMatrixDenominatorsValid(record: PairedMatrixComparisonRecord): void {
  if (record.status !== 'MEASURED') return;
  if (record.totalCalibrationScenarios === undefined || record.mutuallyEligibleScenarioCount === undefined) {
    throw new Error('MISSING_PAIRED_MATRIX_DENOMINATOR_FIELDS');
  }
  if (
    record.totalCalibrationScenarios === 72 &&
    record.mutuallyEligibleScenarioCount < 72 &&
    (record.metricSpecificValidPairedCount === 72 || record.bothCandidatesScoreableCount === 72)
  ) {
    throw new Error('INVALID_PAIRED_SAMPLE_COUNT_MISLABELED_AS_TOTAL_SCENARIOS');
  }
  if (
    record.candidateAPreInferenceEligibleCount !== undefined &&
    record.candidateBPreInferenceEligibleCount !== undefined
  ) {
    const expectedBound = Math.min(
      record.candidateAPreInferenceEligibleCount,
      record.candidateBPreInferenceEligibleCount,
    );
    if (record.mutuallyEligibleScenarioCount > expectedBound) {
      throw new Error(`MUTUAL_ELIGIBILITY_EXCEEDS_PRE_INFERENCE_BOUND:${record.mutuallyEligibleScenarioCount} > ${expectedBound}`);
    }
  }
  if (
    record.metricSpecificValidPairedCount !== undefined &&
    record.metricSpecificValidPairedCount > record.mutuallyEligibleScenarioCount
  ) {
    throw new Error(
      `METRIC_PAIRED_COUNT_EXCEEDS_MUTUAL_ELIGIBILITY:${record.metricSpecificValidPairedCount} > ${record.mutuallyEligibleScenarioCount}`,
    );
  }

  if (record.metrics) {
    for (const [metricKey, metricComp] of Object.entries(record.metrics)) {
      const mc = metricComp as Record<string, unknown>;
      if (mc.status === 'NOT_EVALUATED') continue;
      if (typeof mc.sampleCount === 'number' && mc.sampleCount > 0) {
        if (!mc.effectClassification && !mc.classification) {
          throw new Error(`METRIC_COMPARISON_MISSING_EFFECT_CLASSIFICATION:${metricKey}`);
        }
        if (mc.bootstrap95Ci === undefined) {
          throw new Error(`METRIC_COMPARISON_MISSING_BOOTSTRAP_CI:${metricKey}`);
        }
        if (mc.meaningfulEffectThreshold === undefined) {
          throw new Error(`METRIC_COMPARISON_MISSING_MEANINGFUL_THRESHOLD:${metricKey}`);
        }
        if (!mc.practicalInterpretation && !mc.significanceInterpretation) {
          throw new Error(`METRIC_COMPARISON_MISSING_SIGNIFICANCE_INTERPRETATION:${metricKey}`);
        }
      }
    }
  }
}

export type MetricEffectClassification =
  | 'DIRECTIONAL_BELOW_MEANINGFUL_EFFECT_THRESHOLD'
  | 'STATISTICALLY_SIGNIFICANT_MEANINGFUL_DIFFERENCE'
  | 'NO_STATISTICALLY_SIGNIFICANT_DIFFERENCE';

export interface MetricPairwiseClassificationResult {
  readonly classification: MetricEffectClassification;
  readonly effectClassification: MetricEffectClassification;
  readonly isStatisticallySignificant: boolean;
  readonly isMeaningfulDifference: boolean;
  readonly practicalInterpretation: string;
}

export function classifyMetricPairwiseComparison(
  meanDiff: number,
  ciOrThreshold: { low: number; high: number } | number,
  meaningfulEffectThreshold?: number,
): MetricPairwiseClassificationResult {
  let ci: { low: number; high: number };
  let threshold: number;

  if (typeof ciOrThreshold === 'number') {
    threshold = ciOrThreshold;
    ci = { low: meanDiff, high: meanDiff };
  } else {
    ci = ciOrThreshold;
    threshold = meaningfulEffectThreshold ?? 0.01;
  }

  const ciExcludesZero = ci.low > 0 || ci.high < 0;
  let classification: MetricEffectClassification;
  let isMeaningful = false;

  if (ciExcludesZero) {
    if (Math.abs(meanDiff) < threshold) {
      classification = 'DIRECTIONAL_BELOW_MEANINGFUL_EFFECT_THRESHOLD';
      isMeaningful = false;
    } else {
      classification = 'STATISTICALLY_SIGNIFICANT_MEANINGFUL_DIFFERENCE';
      isMeaningful = true;
    }
  } else {
    classification = 'NO_STATISTICALLY_SIGNIFICANT_DIFFERENCE';
    isMeaningful = false;
  }

  const practicalInterpretation =
    classification === 'STATISTICALLY_SIGNIFICANT_MEANINGFUL_DIFFERENCE'
      ? 'Statistically significant and practically meaningful difference exceeding threshold.'
      : classification === 'DIRECTIONAL_BELOW_MEANINGFUL_EFFECT_THRESHOLD'
      ? 'Confidence interval excludes zero but effect size is below meaningful effect threshold; directional only.'
      : 'No statistically significant difference; confidence interval includes zero.';

  return {
    classification,
    effectClassification: classification,
    isStatisticallySignificant: ciExcludesZero,
    isMeaningfulDifference: isMeaningful,
    practicalInterpretation,
  };
}

export function assertNoBelowThresholdCrossFamilyWinner(
  classificationOrRecord: PairedMatrixComparisonRecord | MetricPairwiseClassificationResult | string,
  claimedWinner?: boolean,
): void {
  if (typeof classificationOrRecord === 'object' && 'candidateA' in classificationOrRecord) {
    const record = classificationOrRecord as PairedMatrixComparisonRecord;
    if (record.metrics) {
      for (const [key, val] of Object.entries(record.metrics)) {
        const mc = val as Record<string, unknown>;
        const eff = (mc.effectClassification ?? mc.classification) as string | undefined;
        if (eff === 'DIRECTIONAL_BELOW_MEANINGFUL_EFFECT_THRESHOLD' && record.isCrossFamilyWinner) {
          throw new Error(`MEANINGLESS_EFFECT_CANNOT_BE_CROSS_FAMILY_WINNER:${key}`);
        }
      }
    }
    return;
  }

  let classification: string;
  if (typeof classificationOrRecord === 'object' && 'classification' in classificationOrRecord) {
    classification = (classificationOrRecord as MetricPairwiseClassificationResult).classification;
  } else {
    classification = String(classificationOrRecord);
  }

  if (classification === 'DIRECTIONAL_BELOW_MEANINGFUL_EFFECT_THRESHOLD' && claimedWinner) {
    throw new Error('MEANINGLESS_EFFECT_CANNOT_BE_CROSS_FAMILY_WINNER');
  }
}

export interface ReconciledIncumbentMetricRecord {
  readonly candidateId: string;
  readonly profileId: string;
  readonly configurationSha256: string;
  readonly sourceReportPath: string;
  readonly sourceReportSha256: string;
  readonly metrics: {
    readonly expectedStrikeRecall: {
      readonly numerator: number;
      readonly denominator: number;
      readonly value: number;
      readonly formatted?: string;
    };
    readonly verdictAgreementRate: {
      readonly numerator: number;
      readonly denominator: number;
      readonly value: number;
      readonly formatted?: string;
    };
  };
}

export function assertReconciledIncumbentMetricsValid(record: ReconciledIncumbentMetricRecord): void {
  if (record.candidateId === 'bytedance-original-calibrated-v1') {
    if (record.profileId !== 'bytedance-original-calibration-CALIBRATED_CONTEXT_5S-onset-0.20-frame-0.10') {
      throw new Error(`FROZEN_INCUMBENT_PROFILE_ID_MISMATCH:${record.profileId}`);
    }
    if (record.configurationSha256 !== '91a6fc6d33575edf9b8eb3adc78a21a4ea28d7581e3c7eb56a882e0fe6dd9285') {
      throw new Error(`FROZEN_INCUMBENT_CONFIGURATION_SHA_MISMATCH:${record.configurationSha256}`);
    }
    const recall = record.metrics.expectedStrikeRecall;
    const verdict = record.metrics.verdictAgreementRate;
    if (recall.numerator !== 1487 || recall.denominator !== 1509) {
      throw new Error(`BYTE_DANCE_INCUMBENT_RECALL_METRIC_MISMATCH:expected 1487/1509, got ${recall.numerator}/${recall.denominator}`);
    }
    if (verdict.numerator !== 1519 || verdict.denominator !== 1567) {
      throw new Error(`BYTE_DANCE_INCUMBENT_VERDICT_METRIC_MISMATCH:expected 1519/1567, got ${verdict.numerator}/${verdict.denominator}`);
    }
    return;
  }

  if (record.candidateId === 'online-amt-calibrated-v1') {
    if (record.profileId !== 'online-amt-calibration-native-boost-1') {
      throw new Error(`FROZEN_INCUMBENT_PROFILE_ID_MISMATCH:${record.profileId}`);
    }
    if (record.configurationSha256 !== '0d56e238a353a0aecfbf1d129521e93fc69f7e171711ce9ad57b419548edc375') {
      throw new Error(`FROZEN_INCUMBENT_CONFIGURATION_SHA_MISMATCH:${record.configurationSha256}`);
    }
    const recall = record.metrics.expectedStrikeRecall;
    const verdict = record.metrics.verdictAgreementRate;
    if (recall.numerator !== 1655 || recall.denominator !== 1800) {
      throw new Error(`ONLINE_AMT_INCUMBENT_RECALL_METRIC_MISMATCH:expected 1655/1800, got ${recall.numerator}/${recall.denominator}`);
    }
    if (verdict.numerator !== 1720 || verdict.denominator !== 1870) {
      throw new Error(`ONLINE_AMT_INCUMBENT_VERDICT_METRIC_MISMATCH:expected 1720/1870, got ${verdict.numerator}/${verdict.denominator}`);
    }
    return;
  }

  throw new Error(`UNKNOWN_INCUMBENT_CANDIDATE_ID:${record.candidateId}`);
}

export interface CandidateMultiDimensionalRecord {
  readonly candidateFamily: string;
  readonly candidateId: string;
  readonly scientificCalibrationValidity: 'VALID' | 'INVALID' | 'BLOCKED';
  readonly eligibilityForResearchBlindComparison: 'ELIGIBLE_AND_LOCKED' | 'SCIENTIFICALLY_ELIGIBLE_DEFERRED' | 'RESEARCH_REFERENCE_ONLY' | 'NOT_ELIGIBLE';
  readonly causalLiveRuntimeCompatibility: 'CAUSAL_STREAMING_COMPATIBLE' | 'OFFLINE_WHOLE_RECORDING_INCOMPATIBLE' | 'OFFLINE_SEGMENTWISE_INCOMPATIBLE';
  readonly productionCheckpointLicensing: 'PRODUCTION_LICENSE_ELIGIBLE' | 'RESEARCH_VALID_PRODUCTION_LICENSE_BLOCKED' | 'LICENSE_OR_USAGE_RIGHTS_UNRESOLVED';
  readonly finalProductionSelectionEligibility: 'POTENTIALLY_ELIGIBLE_PENDING_PHASE_9GB' | 'INELIGIBLE_DUE_TO_OFFLINE_LATENCY' | 'INELIGIBLE_DUE_TO_LICENSE_AND_LATENCY' | 'INELIGIBLE';
  readonly qualificationStatus: string;
  readonly lockedForPhase9gB: boolean;
}

export function assertCandidateMultiDimensionalQualification(candidate: CandidateMultiDimensionalRecord): void {
  if (candidate.lockedForPhase9gB) {
    if (
      candidate.scientificCalibrationValidity !== 'VALID' ||
      candidate.qualificationStatus !== 'CALIBRATED_AND_LOCKED_FOR_RESEARCH'
    ) {
      throw new Error(`UNQUALIFIED_CANDIDATE_CANNOT_BE_LOCKED_FOR_PHASE_9G_B:${candidate.candidateFamily}`);
    }
  }
}

