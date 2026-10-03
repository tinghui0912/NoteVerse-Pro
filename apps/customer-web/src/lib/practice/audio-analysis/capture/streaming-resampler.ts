export type NormalizedPcmChunk = {
  samples: Float32Array;
  startSampleIndex: number;
  endSampleIndex: number;
};

export class StreamingLinearResampler {
  private sourceBuffer = new Float32Array(0);
  private sourceBufferStart = 0;
  private nextSourceSamplePosition: number | null = null;
  private nextOutputSampleIndex = 0;
  private expectedSourceSampleIndex: number | null = null;

  constructor(
    readonly sourceSampleRateHz: number,
    readonly targetSampleRateHz: number,
    initialOutputSampleIndex = 0
  ) {
    if (sourceSampleRateHz <= 0 || targetSampleRateHz <= 0) {
      throw new Error('Streaming resampler requires positive source and target sample rates.');
    }
    if (!Number.isInteger(initialOutputSampleIndex) || initialOutputSampleIndex < 0) {
      throw new Error('Streaming resampler initial output sample index must be a non-negative integer.');
    }
    this.nextOutputSampleIndex = initialOutputSampleIndex;
  }

  append(input: { samples: Float32Array; sourceStartSampleIndex: number }): NormalizedPcmChunk {
    if (!Number.isInteger(input.sourceStartSampleIndex) || input.sourceStartSampleIndex < 0) {
      throw new Error('Source sample start must be a non-negative integer.');
    }
    if (
      this.expectedSourceSampleIndex !== null
      && input.sourceStartSampleIndex !== this.expectedSourceSampleIndex
    ) {
      throw new Error('Streaming resampler requires contiguous source samples.');
    }
    if (this.nextSourceSamplePosition === null) {
      this.nextSourceSamplePosition = input.sourceStartSampleIndex;
      this.sourceBufferStart = input.sourceStartSampleIndex;
    }
    this.expectedSourceSampleIndex = input.sourceStartSampleIndex + input.samples.length;
    this.appendSource(input.samples);
    const output: number[] = [];
    const step = this.sourceSampleRateHz / this.targetSampleRateHz;
    const availableEnd = this.sourceBufferStart + this.sourceBuffer.length;
    while (this.nextSourceSamplePosition + 1 < availableEnd) {
      output.push(this.interpolate(this.nextSourceSamplePosition));
      this.nextSourceSamplePosition += step;
    }
    this.trimSource();
    const startSampleIndex = this.nextOutputSampleIndex;
    this.nextOutputSampleIndex += output.length;
    return {
      samples: Float32Array.from(output),
      startSampleIndex,
      endSampleIndex: this.nextOutputSampleIndex,
    };
  }

  private appendSource(samples: Float32Array): void {
    if (samples.length === 0) {
      return;
    }
    const combined = new Float32Array(this.sourceBuffer.length + samples.length);
    combined.set(this.sourceBuffer);
    combined.set(samples, this.sourceBuffer.length);
    this.sourceBuffer = combined;
  }

  private interpolate(sourcePosition: number): number {
    const leftIndex = Math.floor(sourcePosition);
    const rightIndex = leftIndex + 1;
    const fraction = sourcePosition - leftIndex;
    const left = this.sourceBuffer[leftIndex - this.sourceBufferStart] ?? 0;
    const right = this.sourceBuffer[rightIndex - this.sourceBufferStart] ?? left;
    return left + (right - left) * fraction;
  }

  private trimSource(): void {
    if (this.nextSourceSamplePosition === null) {
      return;
    }
    const keepFrom = Math.max(this.sourceBufferStart, Math.floor(this.nextSourceSamplePosition) - 1);
    const trim = keepFrom - this.sourceBufferStart;
    if (trim <= 0) {
      return;
    }
    this.sourceBuffer = this.sourceBuffer.subarray(trim).slice();
    this.sourceBufferStart = keepFrom;
  }
}

export function monoFromChannels(channels: readonly Float32Array[]): Float32Array {
  if (channels.length === 0) {
    return new Float32Array(0);
  }
  if (channels.length === 1) {
    return channels[0].slice();
  }
  const length = channels[0].length;
  const mono = new Float32Array(length);
  for (let channelIndex = 0; channelIndex < channels.length; channelIndex += 1) {
    const channel = channels[channelIndex];
    if (channel.length !== length) {
      throw new Error('All channels must have equal length for deterministic mono conversion.');
    }
    for (let index = 0; index < length; index += 1) {
      mono[index] += channel[index] / channels.length;
    }
  }
  return mono;
}
