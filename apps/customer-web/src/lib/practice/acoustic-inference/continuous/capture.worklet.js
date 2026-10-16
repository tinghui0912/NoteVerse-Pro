/* Credits bound MessagePort PCM lifetime; currentFrame is the chronology authority. */
class ContinuousPcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.originFrame = null;
    this.sequence = 0;
    this.nextAck = 0;
    this.failed = false;
    this.port.onmessage = event => {
      const message = event.data;
      if (message?.type === 'STOP') { this.failed = true; return; }
      if (message?.type !== 'ACK' || message.sequence !== this.nextAck || this.nextAck >= this.sequence) {
        this.fail('ACOUSTIC_CAPTURE_ACK_ORDER_VIOLATION'); return;
      }
      this.nextAck++;
    };
  }
  fail(code) {
    if (this.failed) return;
    this.failed = true;
    this.port.postMessage({ type: 'capture-failure', code });
  }
  process(inputs, outputs) {
    for (const output of outputs) for (const channel of output) channel.fill(0);
    if (this.failed) return false;
    const input = inputs[0];
    if (!input?.length || !input[0]?.length) return true;
    const length = input[0].length;
    if (length > 2048 || input.some(channel => channel.length !== length)) { this.fail('ACOUSTIC_CAPTURE_BLOCK_SIZE_VIOLATION'); return false; }
    if (this.sequence - this.nextAck >= 32) { this.fail('ACOUSTIC_CAPTURE_TRANSPORT_LIMIT_EXCEEDED'); return false; }
    if (this.originFrame === null) this.originFrame = currentFrame;
    const mono = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      let sum = 0;
      for (const channel of input) sum += channel[i];
      mono[i] = sum / input.length;
    }
    const sourceStartSampleIndex = currentFrame - this.originFrame;
    this.port.postMessage({ type: 'pcm-chunk', sequence: this.sequence++, sourceSampleRateHz: sampleRate,
      sourceStartSampleIndex, sourceEndSampleIndex: sourceStartSampleIndex + length,
      audioContextStartFrame: currentFrame, inputChannelCount: input.length,
      captureTimeSeconds: currentTime, samples: mono }, [mono.buffer]);
    return true;
  }
}
registerProcessor('noteverse-continuous-pcm', ContinuousPcmCapture);
