import {
  BYTEDANCE_INFERENCE_CONTRACT,
  BYTEDANCE_INPUT_DESCRIPTOR,
  type ByteDancePcmInferenceRequest,
} from './bytedance-contract';

export type ByteDancePreparedInput = {
  feeds: Record<typeof BYTEDANCE_INPUT_DESCRIPTOR.name, Float32Array>;
  shape: readonly [1, 29120];
};

export function prepareByteDanceInput(request: ByteDancePcmInferenceRequest): ByteDancePreparedInput {
  if (request.sampleRateHz !== BYTEDANCE_INFERENCE_CONTRACT.sampleRateHz) {
    throw new Error(`ByteDance inference expects 16 kHz PCM, got ${request.sampleRateHz}.`);
  }
  if (request.channelCount !== 1) {
    throw new Error('ByteDance inference expects mono PCM.');
  }
  if (request.pcm.length !== BYTEDANCE_INPUT_DESCRIPTOR.shape[1]) {
    throw new Error(
      `ByteDance fixed-anchor input expects ${BYTEDANCE_INPUT_DESCRIPTOR.shape[1]} samples, got ${request.pcm.length}.`
    );
  }
  return {
    feeds: {
      [BYTEDANCE_INPUT_DESCRIPTOR.name]: request.pcm,
    },
    shape: BYTEDANCE_INPUT_DESCRIPTOR.shape,
  };
}

export type FixedAnchorWindow = {
  pcm: Float32Array;
  clipStartSampleIndex: number;
  realStartSampleIndex: number;
  realEndSampleIndex: number;
  zeroPaddingSamples: number;
};

export function buildByteDanceFixedAnchorWindow(input: {
  sourcePcm: Float32Array;
  sampleRateHz: number;
  anchorSampleIndex: number;
}): FixedAnchorWindow {
  if (input.sampleRateHz !== BYTEDANCE_INFERENCE_CONTRACT.sampleRateHz) {
    throw new Error(`ByteDance fixed-anchor window expects 16 kHz PCM, got ${input.sampleRateHz}.`);
  }
  if (input.anchorSampleIndex < 0 || !Number.isInteger(input.anchorSampleIndex)) {
    throw new Error('ByteDance fixed-anchor window requires a non-negative integer anchor sample.');
  }

  const targetAnchorSamples = millisecondsToSamples(BYTEDANCE_INFERENCE_CONTRACT.targetAnchorMs);
  const lookbackSamples = millisecondsToSamples(BYTEDANCE_INFERENCE_CONTRACT.lookbackMs);
  const futureSamples = millisecondsToSamples(BYTEDANCE_INFERENCE_CONTRACT.futureMs);
  const totalSamples = BYTEDANCE_INPUT_DESCRIPTOR.shape[1];
  const availableRealLookback = Math.min(lookbackSamples, input.anchorSampleIndex);
  const realStartSampleIndex = input.anchorSampleIndex - availableRealLookback;
  const realEndSampleIndex = Math.min(input.sourcePcm.length, input.anchorSampleIndex + futureSamples);
  const zeroPaddingSamples = targetAnchorSamples - availableRealLookback;
  const pcm = new Float32Array(totalSamples);
  const realAudio = input.sourcePcm.subarray(realStartSampleIndex, realEndSampleIndex);
  pcm.set(realAudio, Math.max(0, zeroPaddingSamples));
  return {
    pcm,
    clipStartSampleIndex: input.anchorSampleIndex - targetAnchorSamples,
    realStartSampleIndex,
    realEndSampleIndex,
    zeroPaddingSamples,
  };
}

export function pcmS16leToFloat32(bytes: ArrayBuffer | Uint8Array): Float32Array {
  const view = bytes instanceof Uint8Array
    ? new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : new DataView(bytes);
  if (view.byteLength % 2 !== 0) {
    throw new Error('PCM s16le byte length must be even.');
  }
  const samples = new Float32Array(view.byteLength / 2);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = view.getInt16(index * 2, true) / 32768;
  }
  return samples;
}

function millisecondsToSamples(milliseconds: number): number {
  return Math.round(milliseconds / 1000 * BYTEDANCE_INFERENCE_CONTRACT.sampleRateHz);
}
