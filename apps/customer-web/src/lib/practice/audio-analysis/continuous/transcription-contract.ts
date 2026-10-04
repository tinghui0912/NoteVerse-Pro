export const CONTINUOUS_ANALYSIS_UNAVAILABLE_REASON = 'CONTINUOUS_ANALYSIS_UNAVAILABLE' as const;

export type ContinuousTranscriptionContract = {
  contractId: string;
  sampleRateHz: 16_000;
  inputSamplesPerWindow: number;
  trustedOutputStartSamples: number;
  trustedOutputEndSamples: number;
  futureContextSamples: number;
  batchSize: number;
};

export function assertContinuousTranscriptionContract(
  contract: ContinuousTranscriptionContract
): void {
  if (contract.sampleRateHz !== 16_000) {
    throw new Error('Continuous transcription currently requires 16 kHz PCM.');
  }
  if (
    contract.inputSamplesPerWindow <= 0
    || contract.futureContextSamples < 0
    || contract.batchSize <= 0
  ) {
    throw new Error('Continuous transcription contract values must be positive.');
  }
  if (contract.trustedOutputStartSamples < 0
    || contract.trustedOutputEndSamples <= contract.trustedOutputStartSamples
    || contract.trustedOutputEndSamples > contract.inputSamplesPerWindow) {
    throw new Error('Continuous transcription trusted output range is invalid.');
  }
}
