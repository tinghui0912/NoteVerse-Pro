export const PCM_SAMPLE_RATE = 16000;
export const PCM_CHANNELS = 1;
export const PCM_FRAME_FORMAT = 'pcm_s16le';

export function convertFloat32ToPcm16(samples: Float32Array) {
  const buffer = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buffer);

  for (let index = 0; index < samples.length; index += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[index] ?? 0));
    view.setInt16(index * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }

  return buffer;
}

export function downsampleTo16k(input: Float32Array, inputSampleRate: number) {
  if (inputSampleRate === PCM_SAMPLE_RATE) {
    return input;
  }

  const ratio = inputSampleRate / PCM_SAMPLE_RATE;
  const outputLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(outputLength);

  for (let index = 0; index < outputLength; index += 1) {
    const sourceIndex = Math.min(input.length - 1, Math.round(index * ratio));
    output[index] = input[sourceIndex] ?? 0;
  }

  return output;
}

export function normalizeWorkletSamples(data: unknown): Float32Array | null {
  if (data instanceof Float32Array) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new Float32Array(data);
  }
  if (ArrayBuffer.isView(data) && data.buffer instanceof ArrayBuffer) {
    return new Float32Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  }
  if (Array.isArray(data)) {
    return new Float32Array(data);
  }
  return null;
}

export function isAudioWorkletSupported() {
  if (typeof window === 'undefined') {
    return true;
  }

  const AudioContextConstructor =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

  return Boolean(AudioContextConstructor && 'AudioWorkletNode' in window);
}
