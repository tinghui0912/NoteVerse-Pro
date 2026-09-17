class NoteVerseByteDanceCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sourceSampleIndex = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0 || input[0].length === 0) {
      return true;
    }
    const frameCount = input[0].length;
    const mono = new Float32Array(frameCount);
    for (let channelIndex = 0; channelIndex < input.length; channelIndex += 1) {
      const channel = input[channelIndex];
      for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
        mono[frameIndex] += channel[frameIndex] / input.length;
      }
    }
    const start = this.sourceSampleIndex;
    this.sourceSampleIndex += frameCount;
    this.port.postMessage({
      type: 'pcm-chunk',
      sourceSampleRateHz: sampleRate,
      sourceStartSampleIndex: start,
      sourceEndSampleIndex: this.sourceSampleIndex,
      samples: mono,
    }, [mono.buffer]);
    return true;
  }
}

registerProcessor('noteverse-bytedance-capture', NoteVerseByteDanceCaptureProcessor);
