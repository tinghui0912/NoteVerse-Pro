class PracticePcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frameSize = 2048;
    this.buffer = new Float32Array(this.frameSize);
    this.bufferedSamples = 0;
  }

  process(inputs) {
    const input = inputs[0];
    const channel = input?.[0];

    if (channel && channel.length > 0) {
      let sourceOffset = 0;
      while (sourceOffset < channel.length) {
        const writable = this.frameSize - this.bufferedSamples;
        const remaining = channel.length - sourceOffset;
        const chunkLength = Math.min(writable, remaining);

        this.buffer.set(
          channel.subarray(sourceOffset, sourceOffset + chunkLength),
          this.bufferedSamples
        );
        this.bufferedSamples += chunkLength;
        sourceOffset += chunkLength;

        if (this.bufferedSamples === this.frameSize) {
          const copy = this.buffer.slice(0, this.frameSize);
          this.port.postMessage(copy, [copy.buffer]);
          this.bufferedSamples = 0;
        }
      }
    }

    return true;
  }
}

registerProcessor('practice-pcm-processor', PracticePcmProcessor);
