import {
  executeGreenfieldAcousticCandidate,
  type GreenfieldAcousticExecutor,
  type GreenfieldAcousticInferenceRequest,
} from './acoustic-candidate-contract';

export type AcousticObservation = {
  pitch: number;
  performanceTimeMs: number;
  confidence: number;
  candidateObservationId: string;
};

export type AcousticCandidateResult = {
  deploymentId: string;
  observations: AcousticObservation[];
  timing?: Record<string, number>;
};

export const XC1_ROBUST_BROWSER_V1_IDENTITY = {
  deploymentId: 'robust-browser-v1',
  candidateId: 'bytedance-robust-augmented-calibrated-v1',
  deploymentIdentitySha256: '196a9a2ceb03569f6e266c4f5973125bb8596146882079105ee94ef7e621deed',
  sourceCandidateId: 'bytedance-robust-augmented-calibrated-v1',
  sourceProfileId: 'CALIBRATED_CONTEXT_1820-onset-0.30-frame-0.05',
  onnxSha256: '4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3',
  inputSampleRateHz: 16000,
  inputSamples: 29120,
  modelInputMs: 1820,
  pastContextMs: 1000,
  ownedRegionMs: 600,
  futureContextMs: 220,
  onsetThreshold: 0.3,
  frameThreshold: 0.05,
  preprocessingIdentity: 'deterministic_wav_pcm16_mono_linear_resample_16k_v1',
  decoderIdentity: 'noteverse-bytedance-contiguous-region-peak-decoder-v1',
  fakeZeroPadding: false,
} as const;

export const XC1_ONLINE_AMT_K8_BROWSER_V1_IDENTITY = {
  deploymentId: 'online-amt-k8-browser-v1',
  candidateId: 'online-amt-calibrated-v1',
  sourceCandidateId: 'online-amt-calibrated-v1',
  configurationSha256: '0d56e238a353a0aecfbf1d129521e93fc69f7e171711ce9ad57b419548edc375',
  checkpointSha256: '54ab4907b517dbfa2dbbee834db18d31d103ee25d690860595181162d235e3a0',
  k8OnnxSha256: '818c095a3e96f507f45fe5f394169660cb3848fb7e496699a99c1957b51e9f18',
  k1FallbackOnnxSha256: '1924789c64595a5b8c1ff2f745089613b2ba6108676952c4bb6f60f28d9cd301',
  hopSamples: 512,
  hopMs: 32,
  groupHops: 8,
  groupMs: 256,
  timingCorrectionMs: -162.93750000004252,
  publishedOnsetBoost: 1,
  pseudoIntensity: 'NATIVE',
  ortWebVersion: '1.30.0',
} as const;

export const XC1_BASIC_PITCH_BROWSER_V1_IDENTITY = {
  deploymentId: 'basic-pitch-browser-v1',
  candidateId: 'basic-pitch-browser-v1',
  packageName: '@spotify/basic-pitch',
  packageVersion: '1.0.1',
  browserBackend: 'tensorflowjs-webgl',
  inputSampleRateHz: 16000,
  modelSampleRateHz: 22050,
  inputResamplerIdentity: 'noteverse-basic-pitch-deterministic-linear-16k-to-22050-v1',
  onsetThreshold: 0.5,
  frameThreshold: 0.3,
  minNoteLenFrames: 5,
  inferOnsets: true,
  melodiaTrick: true,
  energyTolerance: 11,
  pitchRange: [21, 108],
  eventTimeMapping: 'basic-pitch-model-frames-to-time-v1',
  ownershipFilteringIdentity: 'noteverse-common-half-open-acoustic-ownership-v1',
  decoderIdentity: 'noteverse-basic-pitch-all-pitch-continuous-decoder-v1',
  historicalStepVerifierIsContinuousEvidence: false,
} as const;

export const XC1_DEPLOYMENT_IDENTITIES = [
  XC1_ROBUST_BROWSER_V1_IDENTITY,
  XC1_ONLINE_AMT_K8_BROWSER_V1_IDENTITY,
  XC1_BASIC_PITCH_BROWSER_V1_IDENTITY,
] as const;

type Xc1RegistryEntry = {
  deploymentId: string;
  candidateId: string;
  executorId: string;
  browserBackend: 'webgpu' | 'tensorflowjs-webgl';
  frozenAssetChecks: Readonly<Record<string, string | number | boolean>>;
};

export const XC1_CANDIDATE_EXECUTOR_REGISTRY = {
  'robust-browser-v1': {
    deploymentId: XC1_ROBUST_BROWSER_V1_IDENTITY.deploymentId,
    candidateId: XC1_ROBUST_BROWSER_V1_IDENTITY.candidateId,
    executorId: 'xc1-robust-browser-webgpu-executor',
    browserBackend: 'webgpu',
    frozenAssetChecks: {
      deploymentIdentitySha256: XC1_ROBUST_BROWSER_V1_IDENTITY.deploymentIdentitySha256,
      onnxSha256: XC1_ROBUST_BROWSER_V1_IDENTITY.onnxSha256,
      onsetThreshold: XC1_ROBUST_BROWSER_V1_IDENTITY.onsetThreshold,
      frameThreshold: XC1_ROBUST_BROWSER_V1_IDENTITY.frameThreshold,
      sampleRateHz: XC1_ROBUST_BROWSER_V1_IDENTITY.inputSampleRateHz,
      inputSamples: XC1_ROBUST_BROWSER_V1_IDENTITY.inputSamples,
    },
  },
  'online-amt-k8-browser-v1': {
    deploymentId: XC1_ONLINE_AMT_K8_BROWSER_V1_IDENTITY.deploymentId,
    candidateId: XC1_ONLINE_AMT_K8_BROWSER_V1_IDENTITY.candidateId,
    executorId: 'xc1-online-amt-k8-webgpu-worker-executor',
    browserBackend: 'webgpu',
    frozenAssetChecks: {
      k8OnnxSha256: XC1_ONLINE_AMT_K8_BROWSER_V1_IDENTITY.k8OnnxSha256,
      k1FallbackOnnxSha256: XC1_ONLINE_AMT_K8_BROWSER_V1_IDENTITY.k1FallbackOnnxSha256,
      configurationSha256: XC1_ONLINE_AMT_K8_BROWSER_V1_IDENTITY.configurationSha256,
      checkpointSha256: XC1_ONLINE_AMT_K8_BROWSER_V1_IDENTITY.checkpointSha256,
      hopSamples: XC1_ONLINE_AMT_K8_BROWSER_V1_IDENTITY.hopSamples,
      groupHops: XC1_ONLINE_AMT_K8_BROWSER_V1_IDENTITY.groupHops,
    },
  },
  'basic-pitch-browser-v1': {
    deploymentId: XC1_BASIC_PITCH_BROWSER_V1_IDENTITY.deploymentId,
    candidateId: XC1_BASIC_PITCH_BROWSER_V1_IDENTITY.candidateId,
    executorId: 'xc1-basic-pitch-browser-webgl-executor',
    browserBackend: 'tensorflowjs-webgl',
    frozenAssetChecks: {
      packageVersion: XC1_BASIC_PITCH_BROWSER_V1_IDENTITY.packageVersion,
      onsetThreshold: XC1_BASIC_PITCH_BROWSER_V1_IDENTITY.onsetThreshold,
      frameThreshold: XC1_BASIC_PITCH_BROWSER_V1_IDENTITY.frameThreshold,
      minNoteLenFrames: XC1_BASIC_PITCH_BROWSER_V1_IDENTITY.minNoteLenFrames,
      inferOnsets: XC1_BASIC_PITCH_BROWSER_V1_IDENTITY.inferOnsets,
      melodiaTrick: XC1_BASIC_PITCH_BROWSER_V1_IDENTITY.melodiaTrick,
      energyTolerance: XC1_BASIC_PITCH_BROWSER_V1_IDENTITY.energyTolerance,
    },
  },
} satisfies Record<string, Xc1RegistryEntry>;

export function resolveXc1CandidateExecutor(deploymentId: string): Xc1RegistryEntry {
  const entry = XC1_CANDIDATE_EXECUTOR_REGISTRY[deploymentId as keyof typeof XC1_CANDIDATE_EXECUTOR_REGISTRY];
  if (!entry) {
    throw new Error(`XC1_UNKNOWN_DEPLOYMENT:${deploymentId}`);
  }
  return entry;
}

export function executeRobustBrowserV1Candidate<T>(
  rawRequest: unknown,
  executor: GreenfieldAcousticExecutor<T>,
): T | Promise<T> {
  return executeGreenfieldAcousticCandidate(
    withDeployment(
      rawRequest,
      XC1_ROBUST_BROWSER_V1_IDENTITY.deploymentId,
      XC1_ROBUST_BROWSER_V1_IDENTITY.candidateId,
    ),
    executor,
  );
}

export function executeOnlineAmtK8BrowserV1Candidate<T>(
  rawRequest: unknown,
  executor: GreenfieldAcousticExecutor<T>,
): T | Promise<T> {
  return executeGreenfieldAcousticCandidate(
    withDeployment(
      rawRequest,
      XC1_ONLINE_AMT_K8_BROWSER_V1_IDENTITY.deploymentId,
      XC1_ONLINE_AMT_K8_BROWSER_V1_IDENTITY.candidateId,
    ),
    executor,
  );
}

export function executeBasicPitchBrowserV1Candidate<T>(
  rawRequest: unknown,
  executor: GreenfieldAcousticExecutor<T>,
): T | Promise<T> {
  return executeGreenfieldAcousticCandidate(
    withDeployment(
      rawRequest,
      XC1_BASIC_PITCH_BROWSER_V1_IDENTITY.deploymentId,
      XC1_BASIC_PITCH_BROWSER_V1_IDENTITY.candidateId,
    ),
    executor,
  );
}

export type BasicPitchOfficialNoteEventTime = {
  startTimeSeconds: number;
  amplitude?: number;
  pitchMidi?: number;
  pitch?: number;
};

export function decodeBasicPitchAllPitchContinuousObservations(
  officialNoteEvents: readonly BasicPitchOfficialNoteEventTime[],
  options: {
    candidateDeploymentId?: string;
    takeId?: string;
    chunkId?: string;
    ownershipStartMs: number;
    ownershipEndMs: number;
  },
): AcousticObservation[] {
  const observations: AcousticObservation[] = [];

  for (let ordinal = 0; ordinal < officialNoteEvents.length; ordinal += 1) {
    const note = officialNoteEvents[ordinal];
    const maybePitch = note.pitchMidi ?? note.pitch;
    if (!Number.isInteger(maybePitch) || maybePitch === undefined || maybePitch < 21 || maybePitch > 108) {
      continue;
    }
    const pitch = maybePitch;
    const performanceTimeMs = note.startTimeSeconds * 1000;
    if (performanceTimeMs < options.ownershipStartMs || performanceTimeMs >= options.ownershipEndMs) {
      continue;
    }
    const sourceSample = Math.round(performanceTimeMs * XC1_BASIC_PITCH_BROWSER_V1_IDENTITY.inputSampleRateHz / 1000);
    observations.push({
      pitch,
      performanceTimeMs,
      confidence: note.amplitude ?? 1,
      candidateObservationId: [
        options.candidateDeploymentId ?? XC1_BASIC_PITCH_BROWSER_V1_IDENTITY.deploymentId,
        options.takeId ?? 'unknown-take',
        options.chunkId ?? `${options.ownershipStartMs}-${options.ownershipEndMs}`,
        pitch,
        sourceSample,
        ordinal,
      ].join(':'),
    });
  }

  return observations.sort((left, right) =>
    left.performanceTimeMs - right.performanceTimeMs
    || left.pitch - right.pitch
    || left.candidateObservationId.localeCompare(right.candidateObservationId));
}

function withDeployment(rawRequest: unknown, deploymentId: string, candidateId: string): unknown {
  if (!rawRequest || typeof rawRequest !== 'object' || Array.isArray(rawRequest)) {
    return rawRequest;
  }
  const request = rawRequest as GreenfieldAcousticInferenceRequest;
  if (request.deploymentId !== undefined && request.deploymentId !== deploymentId) {
    throw new Error(`XC1_DEPLOYMENT_ID_MISMATCH:${request.deploymentId}:${deploymentId}`);
  }
  if (request.candidateId !== undefined && request.candidateId !== candidateId) {
    throw new Error(`XC1_CANDIDATE_ID_MISMATCH:${request.candidateId}:${candidateId}`);
  }
  return {
    ...request,
    candidateId,
    deploymentId,
  };
}
