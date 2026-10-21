/* Standalone constants are identity-checked against capture-transport-contract.ts. */
const CAPTURE_TRANSPORT_BLOCK_SAMPLES = 2048;
const CAPTURE_TRANSPORT_MAX_UNACKED = 32;

/* Only unpublished startup PCM is provisional. ACTIVE never resets its origin. */
class PracticePcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.originFrame = null;
    this.sequence = 0;
    this.nextAck = 0;
    this.state = 'STABILIZING';
    this.accumulator = new Float32Array(CAPTURE_TRANSPORT_BLOCK_SAMPLES);
    this.filled = 0;
    this.blockStartFrame = null;
    this.expectedFrame = null;
    this.blockChannels = 0;
    this.stabilizationRestarts = 0;
    this.port.onmessage = event => {
      const message = event.data;
      if (this.state === 'FAILED' || this.state === 'STOPPED') return;
      if (message?.type === 'STOP') { this.state = 'STOPPED'; this.accumulator = null; this.filled = 0; return; }
      if (message?.type !== 'ACK' || message.sequence !== this.nextAck || this.nextAck >= this.sequence) {
        this.fail('ACOUSTIC_CAPTURE_ACK_ORDER_VIOLATION'); return;
      }
      this.nextAck++;
    };
    this.port.onmessageerror = () => this.fail('ACOUSTIC_CAPTURE_MESSAGE_ERROR');
  }
  fail(code) {
    if (this.state === 'FAILED' || this.state === 'STOPPED') return;
    this.state = 'FAILED'; this.accumulator = null; this.filled = 0;
    try { this.port.postMessage({ type: 'capture-failure', code }); } catch { /* Broken port cannot be recovered. */ }
  }
  process(inputs, outputs) {
    for (const output of outputs) for (const channel of output) channel.fill(0);
    if (this.state === 'FAILED' || this.state === 'STOPPED') return false;
    if (sampleRate !== 44100 && sampleRate !== 48000) { this.fail('ACOUSTIC_SOURCE_SAMPLE_RATE_NOT_QUALIFIED'); return false; }
    if (!Number.isSafeInteger(currentFrame) || currentFrame < 0) { this.fail('ACOUSTIC_CAPTURE_FRAME_VIOLATION'); return false; }
    const input = inputs[0];
    if (!input?.length || !input[0]?.length) {
      if (this.state === 'ACTIVE') { this.fail('ACOUSTIC_CAPTURE_INPUT_UNAVAILABLE'); return false; }
      return true;
    }
    const length = input[0].length;
    if (length > CAPTURE_TRANSPORT_BLOCK_SAMPLES || input.some(channel => channel.length !== length)) { this.fail('ACOUSTIC_CAPTURE_BLOCK_SIZE_VIOLATION'); return false; }
    if (this.expectedFrame !== null && currentFrame !== this.expectedFrame) {
      if (this.state === 'ACTIVE') { this.fail('ACOUSTIC_CAPTURE_FRAME_DISCONTINUITY'); return false; }
      this.filled = 0; this.blockStartFrame = null; this.stabilizationRestarts++;
    }
    this.expectedFrame = currentFrame + length;
    if (this.filled && this.blockChannels !== input.length) { this.fail('ACOUSTIC_CAPTURE_CHANNEL_GEOMETRY_VIOLATION'); return false; }
    for (let i = 0; i < length; i++) {
      if (this.filled === 0) { this.blockStartFrame = currentFrame + i; this.blockChannels = input.length; }
      let sum = 0;
      for (const channel of input) sum += channel[i];
      const mono = sum / input.length;
      if (!Number.isFinite(mono)) { this.fail('ACOUSTIC_CAPTURE_NONFINITE_PCM'); return false; }
      this.accumulator[this.filled++] = mono;
      if (this.filled === CAPTURE_TRANSPORT_BLOCK_SAMPLES) {
        if (this.sequence - this.nextAck >= CAPTURE_TRANSPORT_MAX_UNACKED) { this.fail('ACOUSTIC_CAPTURE_TRANSPORT_LIMIT_EXCEEDED'); return false; }
        if (this.state === 'STABILIZING') { this.originFrame = this.blockStartFrame; this.state = 'ACTIVE'; }
        const samples = this.accumulator, sourceStartSampleIndex = this.blockStartFrame - this.originFrame;
        try {
          this.port.postMessage({ type: 'pcm-chunk', sequence: this.sequence++, sourceSampleRateHz: sampleRate,
            sourceStartSampleIndex, sourceEndSampleIndex: sourceStartSampleIndex + CAPTURE_TRANSPORT_BLOCK_SAMPLES,
            audioContextStartFrame: this.blockStartFrame, inputChannelCount: this.blockChannels,
            captureTimeSeconds: this.blockStartFrame / sampleRate, samples }, [samples.buffer]);
        } catch { this.fail('ACOUSTIC_CAPTURE_MESSAGE_ERROR'); return false; }
        this.accumulator = new Float32Array(CAPTURE_TRANSPORT_BLOCK_SAMPLES); this.filled = 0;
      }
    }
    return true;
  }
}
registerProcessor('noteverse-practice-pcm', PracticePcmCapture);
