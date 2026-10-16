import { ContinuousCaptureClockSynchronizer } from '../src/lib/practice/continuous/continuous-capture-clock-synchronizer';

declare global { interface Window { probeContinuousClock(rate: 44100 | 48000): Promise<unknown>; clockProbeAssetsReady: boolean } }
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
if (typeof window !== 'undefined') {
window.clockProbeAssetsReady = false;
window.probeContinuousClock = async rate => {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, autoGainControl: false, noiseSuppression: false }, video: false });
  const context = new AudioContext({ sampleRate: rate });
  let node: AudioWorkletNode | null = null, source: MediaStreamAudioSourceNode | null = null, gain: GainNode | null = null;
  try {
    await context.resume(); await context.audioWorklet.addModule('/capture.worklet.js');
    if (context.sampleRate !== rate) throw new Error('SOURCE_RATE_UNAVAILABLE');
    let nextSource = 0, sequence = 0, originFrame: number | null = null, captureFailure: string | null = null;
    const chunks: Record<string, number> = {}, pendingMarkers: { sample: number; consumed: number | null }[] = [];
    node = new AudioWorkletNode(context, 'noteverse-continuous-pcm');
    node.port.onmessage = event => {
      const packet = event.data;
      if (packet.type === 'capture-failure') { captureFailure = packet.code; return; }
      if (packet.sequence !== sequence || packet.sourceStartSampleIndex !== nextSource || packet.sourceSampleRateHz !== rate
        || packet.samples.length !== packet.sourceEndSampleIndex - nextSource) { captureFailure = 'SOURCE_CHRONOLOGY_VIOLATION'; return; }
      const origin = packet.audioContextStartFrame - packet.sourceStartSampleIndex;
      if (originFrame !== null && originFrame !== origin) { captureFailure = 'CONTEXT_FRAME_GAP'; return; }
      originFrame = origin;
      for (const marker of pendingMarkers) if (marker.sample >= nextSource && marker.sample < packet.sourceEndSampleIndex) marker.consumed = marker.sample;
      nextSource = packet.sourceEndSampleIndex; sequence++;
      const key = String(packet.samples.length); chunks[key] = (chunks[key] ?? 0) + 1;
      node!.port.postMessage({ type: 'ACK', sequence: packet.sequence });
    };
    source = context.createMediaStreamSource(stream); gain = context.createGain(); gain.gain.value = 0;
    source.connect(node); node.connect(gain); gain.connect(context.destination);
    window.clockProbeAssetsReady = true;
    const deadline = performance.now() + 10000;
    while (nextSource < rate * 2 || originFrame === null || context.getOutputTimestamp().contextTime === 0) {
      if (captureFailure || performance.now() > deadline) throw new Error(captureFailure ?? 'REAL_PREROLL_TIMEOUT');
      await wait(10);
    }
    const timestampPair = () => {
      const pair = context.getOutputTimestamp();
      if (pair.contextTime === undefined || pair.performanceTime === undefined) throw new Error('AUDIO_OUTPUT_TIMESTAMP_UNAVAILABLE');
      return { contextTime: pair.contextTime, performanceTime: pair.performanceTime };
    };
    const anchor = timestampPair();
    const mapper = new ContinuousCaptureClockSynchronizer(rate, originFrame, anchor);
    const anchorRuntime = performance.now(), witnesses = [];
    const delays = [0, 100, 200, 400, 600, 800, 1000, 1200];
    for (const delay of delays) {
      while (performance.now() < anchorRuntime + delay) await wait(1);
      const commandTime = performance.now(), timestamp = timestampPair();
      const mapping = mapper.mapRuntimeTime(commandTime), error = mapper.observeTimestamp(timestamp);
      const marker = { sample: mapping.sourceSample, consumed: null as number | null }; pendingMarkers.push(marker);
      const alreadyConsumed = mapping.sourceSample < nextSource;
      const witness = { kind: 'PRE_CONTROLLER_CLOCK_GATE_WITNESS_NOT_TRANSPORT_COMMAND', commandTime,
        timestamp, mapping, synchronizationError: error, nextCapturedSourceSampleAtRegistration: nextSource,
        alreadyConsumed, marker };
      witnesses.push(witness);
      // No second method, coefficient fitting, tolerance sweep, model execution or controller acceptance.
      if (!error.withinOneSourceSample) {
        return { status: 'CONTINUOUS_CAPTURE_CLOCK_CONTRACT_BLOCKED', rate, anchor, mapper: mapper.snapshot(),
          realPrerollSourceSamples: Math.floor(anchor.contextTime * rate) - originFrame,
          witnesses, chunks, sequence, captureFailure, currentAudioContextTime: context.currentTime,
          baseLatency: context.baseLatency, outputLatency: context.outputLatency,
          interpretation: 'Frozen single-anchor synchronization exceeded existing one-source-sample consistency. Not application qualification. No tolerance change or fallback attempted.',
          newNeuralInferenceCount: 0, productionMicrophone: false };
      }
    }
    await wait(100); mapper.assertQualified();
    return { status: 'CLOCK_GATE_PASS_ONLY_NOT_APPLICATION_ACCEPTANCE', rate, anchor, mapper: mapper.snapshot(),
      witnesses, chunks, sequence, captureFailure, newNeuralInferenceCount: 0, productionMicrophone: false };
  } finally {
    node?.port.postMessage({ type: 'STOP' }); node?.port.close(); source?.disconnect(); node?.disconnect(); gain?.disconnect();
    for (const track of stream.getTracks()) track.stop(); await context.close();
  }
};
}
