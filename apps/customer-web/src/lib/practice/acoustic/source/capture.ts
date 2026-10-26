import type { CaptureConsumer, CaptureChunk } from './capture-types';
import { fail, onlyFields, sourceRate } from '../model/model-contract';
import { CAPTURE_TRANSPORT_BLOCK_SAMPLES, CAPTURE_TRANSPORT_READY_TIMEOUT_MS } from './capture-transport-contract';

export type CaptureOwnership = 'OWNED_ANALYSIS' | 'BORROWED_SESSION_STREAM';

/** Borrows the session root, owning only an analysis clone and its nodes. */
export class BrowserAcousticCapture {
  private stopped = false;
  private detachCleanup: (() => void) | undefined;
  private readonly readiness: Promise<void>;
  private resolveReady: (() => void) | null = null;
  private rejectReady: ((error: Error) => void) | null = null;
  private readyTimer: ReturnType<typeof setTimeout> | undefined;
  private constructor(private readonly bridge: CaptureConsumer, private readonly stream: MediaStream,
    private readonly context: AudioContext, private readonly source: MediaStreamAudioSourceNode,
    private readonly node: AudioWorkletNode, private readonly gain: GainNode,
    private readonly contextInterruption: 'FAIL' | 'RETAIN_GRAPH') {
    this.readiness = new Promise((resolve, reject) => { this.resolveReady = resolve; this.rejectReady = reject; });
    void this.readiness.catch(() => {});
  }

  static async connect(options: {
    bridge: CaptureConsumer; stream: MediaStream; ownership: CaptureOwnership;
    context: AudioContext; workletUrl: string; contextInterruption?: 'FAIL' | 'RETAIN_GRAPH';
  }): Promise<BrowserAcousticCapture> {
    onlyFields(options, ['bridge', 'stream', 'ownership', 'context', 'workletUrl', 'contextInterruption']);
    if (options.contextInterruption !== undefined && !['FAIL', 'RETAIN_GRAPH'].includes(options.contextInterruption)) fail('INVALID_CAPTURE_CONTEXT_POLICY');
    if (!['BORROWED_SESSION_STREAM', 'OWNED_ANALYSIS'].includes(options.ownership)) fail('INVALID_CAPTURE_OWNERSHIP');
    const stream = options.ownership === 'BORROWED_SESSION_STREAM' ? options.stream.clone() : options.stream;
    let capture: BrowserAcousticCapture | null = null;
    let node: AudioWorkletNode | null = null, source: MediaStreamAudioSourceNode | null = null, gain: GainNode | null = null;
    try {
      sourceRate(options.context.sampleRate);
      await options.context.audioWorklet.addModule(options.workletUrl);
      node = new AudioWorkletNode(options.context, 'noteverse-practice-pcm');
      source = options.context.createMediaStreamSource(stream); gain = options.context.createGain();
      gain.gain.value = 0;
      capture = new BrowserAcousticCapture(options.bridge, stream, options.context, source, node, gain, options.contextInterruption ?? 'FAIL');
      const owner = capture;
      owner.detachCleanup = options.bridge.attachCaptureCleanup(() => owner.stop());
      node.port.onmessage = (event: MessageEvent<CaptureChunk | { type: 'capture-failure'; code: string }>) => {
        if (owner.stopped) return;
        try {
          if (event.data.type === 'capture-failure') throw new Error(event.data.code);
          if (event.data.samples?.length !== CAPTURE_TRANSPORT_BLOCK_SAMPLES) throw new Error('ACOUSTIC_CAPTURE_TRANSPORT_BLOCK_VIOLATION');
          const accepted: unknown = options.bridge.receive(event.data);
          if (accepted !== undefined) throw new Error('ACOUSTIC_CAPTURE_ASYNC_CONSUMER');
          if (owner.stopped) throw new Error('ACOUSTIC_CAPTURE_STOPPED_DURING_ACCEPT');
          owner.node.port.postMessage({ type: 'ACK', sequence: event.data.sequence });
          owner.resolveReady?.(); owner.settleReady();
        } catch (error) { owner.fail(error); }
      };
      node.port.onmessageerror = () => owner.fail(new Error('ACOUSTIC_CAPTURE_MESSAGE_ERROR'));
      node.onprocessorerror = () => owner.fail(new Error('ACOUSTIC_WORKLET_CRASH'));
      options.context.addEventListener('statechange', owner.onStateChange);
      owner.readyTimer = setTimeout(() => owner.fail(new Error('ACOUSTIC_CAPTURE_READINESS_TIMEOUT')), CAPTURE_TRANSPORT_READY_TIMEOUT_MS);
      source.connect(node); node.connect(gain); gain.connect(options.context.destination);
      // Graph connection is not readiness; the first real block must be accepted.
      await owner.readiness;
      return capture;
    } catch (error) {
      if (capture) capture.fail(error);
      else {
        source?.disconnect(); node?.disconnect(); node?.port.close(); gain?.disconnect();
        for (const track of stream.getTracks()) track.stop();
        options.bridge.abort(error);
      }
      throw error;
    }
  }
  private readonly onStateChange = () => {
    if (!this.stopped && this.context.state !== 'running' && (this.contextInterruption === 'FAIL' || this.context.state === 'closed')) this.fail(new Error('ACOUSTIC_CONTEXT_SUSPENDED'));
  };
  private settleReady(): void { clearTimeout(this.readyTimer); this.resolveReady = null; this.rejectReady = null; }
  private fail(error: unknown): void {
    if (this.stopped) return;
    this.rejectReady?.(error instanceof Error ? error : new Error(String(error))); this.settleReady();
    try { this.bridge.abort(error); } finally { this.stop(); }
  }
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.rejectReady?.(new Error('ACOUSTIC_CAPTURE_STOPPED_BEFORE_READY')); this.settleReady();
    this.detachCleanup?.(); this.detachCleanup = undefined;
    this.context.removeEventListener('statechange', this.onStateChange);
    this.node.port.onmessage = null; this.node.port.onmessageerror = null;
    try { this.node.port.postMessage({ type: 'STOP' }); } catch { /* Intentional teardown cannot become source failure. */ }
    this.node.port.close(); this.node.onprocessorerror = null;
    this.source.disconnect(); this.node.disconnect(); this.gain.disconnect();
    for (const track of this.stream.getTracks()) track.stop();
  }
}
