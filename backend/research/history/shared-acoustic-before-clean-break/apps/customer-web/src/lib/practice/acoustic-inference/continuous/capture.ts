import { ContinuousCaptureBridge, type CaptureChunk } from './capture-bridge';
import { fail, onlyFields, sourceRate } from './model-contract';

export type CaptureOwnership = 'OWNED_ANALYSIS' | 'BORROWED_SESSION_STREAM';

/** Borrows the session root, owning only an analysis clone and its nodes. */
export class ContinuousAcousticCapture {
  private stopped = false;
  private detachCleanup: (() => void) | undefined;
  private constructor(private readonly bridge: ContinuousCaptureBridge, private readonly stream: MediaStream,
    private readonly context: AudioContext, private readonly source: MediaStreamAudioSourceNode,
    private readonly node: AudioWorkletNode, private readonly gain: GainNode) {}

  static async connect(options: {
    bridge: ContinuousCaptureBridge; stream: MediaStream; ownership: CaptureOwnership;
    context: AudioContext; workletUrl: string;
  }): Promise<ContinuousAcousticCapture> {
    onlyFields(options, ['bridge', 'stream', 'ownership', 'context', 'workletUrl']);
    if (!['BORROWED_SESSION_STREAM', 'OWNED_ANALYSIS'].includes(options.ownership)) fail('INVALID_CAPTURE_OWNERSHIP');
    const stream = options.ownership === 'BORROWED_SESSION_STREAM' ? options.stream.clone() : options.stream;
    let capture: ContinuousAcousticCapture | null = null;
    let node: AudioWorkletNode | null = null, source: MediaStreamAudioSourceNode | null = null, gain: GainNode | null = null;
    try {
      sourceRate(options.context.sampleRate);
      await options.context.audioWorklet.addModule(options.workletUrl);
      node = new AudioWorkletNode(options.context, 'noteverse-continuous-pcm');
      source = options.context.createMediaStreamSource(stream); gain = options.context.createGain();
      gain.gain.value = 0;
      capture = new ContinuousAcousticCapture(options.bridge, stream, options.context, source, node, gain);
      const owner = capture;
      owner.detachCleanup = options.bridge.runtime.attachCaptureCleanup(() => owner.stop());
      node.port.onmessage = (event: MessageEvent<CaptureChunk | { type: 'capture-failure'; code: string }>) => {
        if (owner.stopped) return;
        try {
          if (event.data.type === 'capture-failure') throw new Error(event.data.code);
          options.bridge.receive(event.data);
          owner.node.port.postMessage({ type: 'ACK', sequence: event.data.sequence });
        } catch (error) { owner.fail(error); }
      };
      node.port.onmessageerror = () => owner.fail(new Error('ACOUSTIC_CAPTURE_MESSAGE_ERROR'));
      node.onprocessorerror = () => owner.fail(new Error('ACOUSTIC_WORKLET_CRASH'));
      options.context.addEventListener('statechange', owner.onStateChange);
      source.connect(node); node.connect(gain); gain.connect(options.context.destination);
      return capture;
    } catch (error) {
      if (capture) capture.stop();
      else {
        source?.disconnect(); node?.disconnect(); node?.port.close(); gain?.disconnect();
        for (const track of stream.getTracks()) track.stop();
      }
      options.bridge.abort(error); throw error;
    }
  }
  private readonly onStateChange = () => {
    if (!this.stopped && this.context.state !== 'running') this.fail(new Error('ACOUSTIC_CONTEXT_SUSPENDED'));
  };
  private fail(error: unknown): void { this.bridge.abort(error); this.stop(); }
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.detachCleanup?.(); this.detachCleanup = undefined;
    this.context.removeEventListener('statechange', this.onStateChange);
    this.node.port.postMessage({ type: 'STOP' }); this.node.port.onmessage = null; this.node.port.onmessageerror = null;
    this.node.port.close(); this.node.onprocessorerror = null;
    this.source.disconnect(); this.node.disconnect(); this.gain.disconnect();
    for (const track of this.stream.getTracks()) track.stop();
  }
}
