// Bounded transport only: mixing and source-clock coordinates match XC6.
class Xc7CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super(); this.originFrame = null; this.sequence = 0; this.nextAck = 0; this.failed = false;
    this.port.onmessage = ({ data }) => {
      if (this.failed) return;
      if (data?.type !== 'ack' || data.sequence !== this.nextAck || data.sequence >= this.sequence) {
        this.fail('ACOUSTIC_CAPTURE_ACK_IDENTITY'); return;
      }
      this.nextAck++;
    };
  }
  fail(error) {
    if (!this.failed) { this.failed = true; this.port.postMessage({ type: 'capture-failure', error }); }
  }
  process(inputs, outputs) {
    for (const output of outputs) for (const channel of output) channel.fill(0);
    if (this.failed) return false;
    const input = inputs[0];
    if (!input?.length || !input[0].length) return true;
    if (this.sequence - this.nextAck >= 32) { this.fail('ACOUSTIC_CAPTURE_TRANSPORT_LIMIT_EXCEEDED'); return false; }
    if (input[0].length > 2048) { this.fail('ACOUSTIC_CAPTURE_BLOCK_SIZE_LIMIT_EXCEEDED'); return false; }
    if (this.originFrame === null) this.originFrame = currentFrame;
    const frames = input[0].length, mono = new Float32Array(frames);
    for (const channel of input) for (let n = 0; n < frames; n++) mono[n] += channel[n] / input.length;
    const start = currentFrame - this.originFrame;
    this.port.postMessage({ type: 'pcm-chunk', sequence: this.sequence++, sourceSampleRateHz: sampleRate,
      sourceStartSampleIndex: start, sourceEndSampleIndex: start + frames, audioContextStartFrame: currentFrame,
      inputChannelCount: input.length, captureTimeSeconds: currentTime, samples: mono }, [mono.buffer]);
    return true;
  }
}
registerProcessor('noteverse-xc7-disabled-capture', Xc7CaptureProcessor);
