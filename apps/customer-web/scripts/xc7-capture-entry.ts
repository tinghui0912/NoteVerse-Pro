import { Xc6DisabledCaptureBridge, type Xc6CaptureMessage } from '../src/lib/practice/acoustic-inference/xc6-capture-bridge';
import { Xc4BrowserWorkerClient } from '../src/lib/practice/acoustic-inference/xc4-robust-worker-client';
import { XC4 } from '../src/lib/practice/acoustic-inference/xc4-robust-runtime-contract';
import { evaluatePracticeInputCapabilities } from '../src/lib/practice/input-capability';

export async function runXc7CaptureIntegration() {
  if (evaluatePracticeInputCapabilities().acousticAnalysis.continuous.status !== 'MODEL_NOT_VALIDATED') throw new Error('XC7_CAPABILITY_ENABLED');
  const coefficients = new Uint8Array(await (await fetch('/fir48.f32')).arrayBuffer());
  const worker = new Xc4BrowserWorkerClient(new Worker('/worker.js', { type: 'module' }));
  let stream: MediaStream | undefined, context: AudioContext | undefined, bridge: Xc6DisabledCaptureBridge | undefined;
  let input: MediaStreamAudioSourceNode | undefined, capture: AudioWorkletNode | undefined, stopped = false;
  let published = 0, observations = 0, lastWindow = -1, immutable = true, callbackFailure: unknown;
  let rejectCapture: ((error: unknown) => void) | undefined;
  const cleanupCapture = () => {
    if (stopped) return;
    stopped = true; input?.disconnect(); capture?.disconnect(); stream?.getTracks().forEach(t => t.stop());
  };
  const failCapture = (error: unknown) => {
    callbackFailure ??= error; cleanupCapture();
    if (bridge && !bridge.snapshot().error) bridge.failSession(error instanceof Error ? error : new Error(String(error)));
    rejectCapture?.(error);
  };
  const loadStart = performance.now();
  try {
    const modelLoad = await worker.load('/model.onnx'), modelLoadMs = performance.now() - loadStart;
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false });
    context = new AudioContext();
    if (context.sampleRate !== 48000) throw new Error('XC7_FROZEN_FAKE_SOURCE_RATE_CHANGED');
    let originWall = 0, startRaw: number | undefined, clockAnchor: unknown;
    bridge = await Xc6DisabledCaptureBridge.create({ engineeringOnly: true, sessionId: 'xc7-fake-media', sourceSampleRateHz: 48000,
      coefficientBytes: coefficients, worker, performanceClock: { nowMs: () => performance.now() - originWall },
      onFailure: failCapture, onAcousticPublication: publication => {
        if (publication.window.windowIndex !== lastWindow + 1) throw new Error('XC7_PUBLICATION_ORDER');
        immutable &&= Object.isFrozen(publication) && Object.isFrozen(publication.window) && Object.isFrozen(publication.observations)
          && publication.observations.every(Object.isFrozen);
        lastWindow = publication.window.windowIndex; published++; observations += publication.observations.length;
        if (publication.acousticCoreIdentitySha256 !== XC4.engineeringIdentitySha256) throw new Error('XC7_CORE_DRIFT');
      } });
    const activeBridge = bridge;
    context.onstatechange = () => {
      if (!stopped) { try { activeBridge.contextStateChanged(context!.state); } catch (e) { failCapture(e); } }
    };
    await context.audioWorklet.addModule('/capture.worklet.js');
    capture = new AudioWorkletNode(context, 'noteverse-xc7-disabled-capture');
    input = context.createMediaStreamSource(stream); const silent = context.createGain(); silent.gain.value = 0;
    let resolveCapture!: () => void;
    const done = new Promise<void>((resolve, reject) => { resolveCapture = resolve; rejectCapture = reject; });
    const timeout = setTimeout(() => failCapture(new Error('XC7_BOUNDED_CAPTURE_TIMEOUT')), 20000);
    capture.port.onmessage = ({ data }: MessageEvent<Xc6CaptureMessage | { type: 'capture-failure'; error: string }>) => {
      if (stopped) return;
      try {
        if (data.type === 'capture-failure') throw new Error(data.error);
        activeBridge.ingest(data); capture!.port.postMessage({ type: 'ack', sequence: data.sequence });
        if (startRaw === undefined && activeBridge.preRollReady && data.sourceEndSampleIndex >= 57600) {
          const firstFrame = data.audioContextStartFrame - data.sourceStartSampleIndex;
          const live = Math.ceil(context!.currentTime * 48000) - firstFrame;
          startRaw = Math.ceil((Math.max(data.sourceEndSampleIndex, live) + 384) / 384) * 384;
          const stamp = context!.getOutputTimestamp();
          if (stamp.contextTime === undefined || stamp.performanceTime === undefined) throw new Error('XC7_CLOCK_ANCHOR_UNAVAILABLE');
          originWall = stamp.performanceTime + ((firstFrame + startRaw) / 48000 - stamp.contextTime) * 1000;
          clockAnchor = { firstFrame, startRaw, timestamp: stamp, originWall, method: 'external AudioContext source-clock affine map' };
          activeBridge.schedulePerformanceStart({ sourceSampleIndex: startRaw });
          activeBridge.schedulePerformanceStop({ sourceSampleIndex: startRaw + 57600 });
        }
        if (activeBridge.realTailReady) {
          activeBridge.closeIngressAfterRealTail(); cleanupCapture(); resolveCapture();
        }
      } catch (error) { failCapture(error); }
    };
    input.connect(capture); capture.connect(silent); silent.connect(context.destination); await context.resume();
    try { await done; } finally { clearTimeout(timeout); }
    if (callbackFailure) throw callbackFailure;
    await bridge.seal(); const snapshot = bridge.snapshot();
    const calls = snapshot.timings.at(-1)?.workerActualSessionRunCount;
    if (published !== 2 || calls !== 2 || !immutable || snapshot.state !== 'SEALED' || snapshot.outstandingDepth !== 0
      || snapshot.resources.timelinePcmBytes !== 0 || snapshot.publications.length > 32 || snapshot.timings.length > 32
      || snapshot.maxOutstandingDepth > 4 || snapshot.captureMetadata.gapCount !== 0) throw new Error('XC7_CAPTURE_ACCEPTANCE_FAILED');
    return { status: 'XC7_BOUNDED_FAKE_MEDIA_SMOKE_PASS', snapshot, modelLoad, modelLoadMs, clockAnchor,
      streamingPublicationCount: published, streamingObservationCount: observations, immutableCallbacks: immutable,
      actualSessionRunCount: calls, captureStopped: stopped, actualCaptureRateHz: context.sampleRate,
      productCapability: 'MODEL_NOT_VALIDATED', productionMicrophone: false, realDeviceProbe: 'REAL_DEVICE_NOT_PERFORMED',
      noDirectPcmInjectionAfterWorklet: true, scoreOrMidiInput: false, rawMicrophonePcmPersisted: false };
  } finally { cleanupCapture(); await bridge?.dispose(); worker.terminate(); await context?.close(); }
}
if (typeof window !== 'undefined') Object.assign(window, { runXc7CaptureIntegration });
