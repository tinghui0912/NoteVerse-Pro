// Model-neutral capture: source chronology follows AudioWorklet's sample clock,
// not message arrival or a count that could conceal an input gap.
class Xc6CaptureProcessor extends AudioWorkletProcessor {
  constructor() { super(); this.originFrame = null; this.sequence = 0; }
  process(inputs, outputs) {
    for (const output of outputs) for (const channel of output) channel.fill(0);
    const input = inputs[0];
    if (!input?.length || !input[0].length) return true;
    if (this.originFrame === null) this.originFrame = currentFrame;
    const frames = input[0].length, mono = new Float32Array(frames);
    for (const channel of input) for (let n=0;n<frames;n++) mono[n] += channel[n] / input.length;
    const start=currentFrame-this.originFrame;
    this.port.postMessage({type:'pcm-chunk',sequence:this.sequence++,sourceSampleRateHz:sampleRate,
      sourceStartSampleIndex:start,sourceEndSampleIndex:start+frames,audioContextStartFrame:currentFrame,
      inputChannelCount:input.length,captureTimeSeconds:currentTime,samples:mono},[mono.buffer]);
    return true;
  }
}
registerProcessor('noteverse-xc6-disabled-capture',Xc6CaptureProcessor);
