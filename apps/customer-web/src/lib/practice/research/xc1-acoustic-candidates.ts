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
  packageName: '@spotify/basic-pitch',
  packageVersion: '1.0.1',
  browserBackend: 'tensorflowjs-webgl',
  inputSampleRateHz: 16000,
  modelSampleRateHz: 22050,
  inputResamplerIdentity: 'noteverse-basic-pitch-deterministic-linear-16k-to-22050-v1',
  onsetThreshold: 0.5,
  frameThreshold: 0.3,
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

export function executeRobustBrowserV1Candidate<T>(
  rawRequest: unknown,
  executor: GreenfieldAcousticExecutor<T>,
): T | Promise<T> {
  return executeGreenfieldAcousticCandidate(withDeployment(rawRequest, XC1_ROBUST_BROWSER_V1_IDENTITY.deploymentId), executor);
}

export function executeOnlineAmtK8BrowserV1Candidate<T>(
  rawRequest: unknown,
  executor: GreenfieldAcousticExecutor<T>,
): T | Promise<T> {
  return executeGreenfieldAcousticCandidate(
    withDeployment(rawRequest, XC1_ONLINE_AMT_K8_BROWSER_V1_IDENTITY.deploymentId),
    executor,
  );
}

export function executeBasicPitchBrowserV1Candidate<T>(
  rawRequest: unknown,
  executor: GreenfieldAcousticExecutor<T>,
): T | Promise<T> {
  return executeGreenfieldAcousticCandidate(
    withDeployment(rawRequest, XC1_BASIC_PITCH_BROWSER_V1_IDENTITY.deploymentId),
    executor,
  );
}

export type BasicPitchActivationFrame = {
  timeMs: number;
  onsetByMidiPitch: Readonly<Record<number, number>>;
  frameByMidiPitch: Readonly<Record<number, number>>;
};

export function decodeBasicPitchAllPitchContinuousObservations(
  frames: readonly BasicPitchActivationFrame[],
  options: {
    onsetThreshold?: number;
    frameThreshold?: number;
    ownershipStartMs: number;
    ownershipEndMs: number;
  },
): AcousticObservation[] {
  const onsetThreshold = options.onsetThreshold ?? XC1_BASIC_PITCH_BROWSER_V1_IDENTITY.onsetThreshold;
  const frameThreshold = options.frameThreshold ?? XC1_BASIC_PITCH_BROWSER_V1_IDENTITY.frameThreshold;
  const observations: AcousticObservation[] = [];

  for (const frame of frames) {
    if (frame.timeMs < options.ownershipStartMs || frame.timeMs >= options.ownershipEndMs) {
      continue;
    }
    for (let pitch = 21; pitch <= 108; pitch += 1) {
      const onset = frame.onsetByMidiPitch[pitch] ?? 0;
      const support = frame.frameByMidiPitch[pitch] ?? 0;
      if (onset >= onsetThreshold && support >= frameThreshold) {
        observations.push({
          pitch,
          performanceTimeMs: frame.timeMs,
          confidence: onset,
          candidateObservationId: `basic-pitch:${pitch}:${frame.timeMs.toFixed(3)}`,
        });
      }
    }
  }

  return observations.sort((left, right) =>
    left.performanceTimeMs - right.performanceTimeMs
    || left.pitch - right.pitch
    || left.candidateObservationId.localeCompare(right.candidateObservationId));
}

function withDeployment(rawRequest: unknown, deploymentId: string): unknown {
  if (!rawRequest || typeof rawRequest !== 'object' || Array.isArray(rawRequest)) {
    return rawRequest;
  }
  const request = rawRequest as GreenfieldAcousticInferenceRequest;
  return {
    ...request,
    deploymentId: request.deploymentId ?? deploymentId,
  };
}
