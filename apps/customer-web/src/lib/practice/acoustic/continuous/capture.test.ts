import { afterEach, expect, it, vi } from 'vitest';
import { BrowserAcousticCapture } from '../source/capture';
import type { ContinuousCaptureBridge } from './capture-bridge';
import { CAPTURE_TRANSPORT_BLOCK_SAMPLES } from '../source/capture-transport-contract';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
function fixture() {
  let cleanup: (() => void) | undefined;
  const runtime = { attachCaptureCleanup: (fn: () => void) => { cleanup = fn; return () => { cleanup = undefined; }; } };
  const bridge = { runtime, attachCaptureCleanup: runtime.attachCaptureCleanup, receive: vi.fn(), abort: vi.fn(() => cleanup?.()) };
  const recordingTrack = { stop: vi.fn() }, analysisTrack = { stop: vi.fn() };
  const clone = { getTracks: () => [analysisTrack] }, stream = { getTracks: () => [recordingTrack], clone: () => clone };
  const node = { port: { onmessage: null as unknown, onmessageerror: null as unknown, postMessage: vi.fn(), close: vi.fn() },
    onprocessorerror: null as unknown, connect: vi.fn(), disconnect: vi.fn() };
  vi.stubGlobal('AudioWorkletNode', class { constructor() { return node; } });
  const source = { connect: vi.fn(), disconnect: vi.fn() }, gain = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() };
  const context = Object.assign(new EventTarget(), { sampleRate: 48000, state: 'running', audioWorklet: { addModule: vi.fn(async () => {}) },
    createMediaStreamSource: () => source, createGain: () => gain, destination: {} });
  return { runtime, bridge, recordingTrack, analysisTrack, node, source, gain, stream, context };
}
async function connected(f: ReturnType<typeof fixture>, ownership: 'BORROWED_SESSION_STREAM' | 'OWNED_ANALYSIS', contextInterruption?: 'FAIL' | 'RETAIN_GRAPH') {
  const pending = BrowserAcousticCapture.connect({ bridge: f.bridge as unknown as ContinuousCaptureBridge,
    stream: f.stream as unknown as MediaStream, ownership, contextInterruption, context: f.context as unknown as AudioContext, workletUrl: '/worklet' });
  await vi.waitFor(() => expect(f.node.port.onmessage).toBeTypeOf('function'));
  (f.node.port.onmessage as (event: unknown) => void)({ data: { type: 'pcm-chunk', sequence: 0, samples: new Float32Array(2048) } });
  return pending;
}
it.each([CAPTURE_TRANSPORT_BLOCK_SAMPLES - 1, CAPTURE_TRANSPORT_BLOCK_SAMPLES + 1])('browser transport rejects non-exact block size %i before consumer/ACK', async size => {
  const f = fixture();
  const pending = BrowserAcousticCapture.connect({ bridge: f.bridge as unknown as ContinuousCaptureBridge,
    stream: f.stream as unknown as MediaStream, ownership: 'BORROWED_SESSION_STREAM', context: f.context as unknown as AudioContext, workletUrl: '/worklet' });
  const rejection = expect(pending).rejects.toMatchObject({ kind: 'CAPTURE', code: 'PIPELINE_INVALID' });
  await vi.waitFor(() => expect(f.node.port.onmessage).toBeTypeOf('function'));
  (f.node.port.onmessage as (event: unknown) => void)({ data: { type: 'pcm-chunk', sequence: 0, samples: new Float32Array(size) } });
  await rejection;
  expect(f.bridge.receive).not.toHaveBeenCalled(); expect(f.node.port.postMessage).not.toHaveBeenCalledWith({ type: 'ACK', sequence: 0 });
  expect(f.bridge.abort).toHaveBeenCalledOnce(); expect(f.analysisTrack.stop).toHaveBeenCalledOnce(); expect(f.recordingTrack.stop).not.toHaveBeenCalled();
});

it('borrowed recording stream is cloned; analysis failure stops only the owned clone and disconnects all nodes', async () => {
  const f = fixture();
  const capture = await connected(f, 'BORROWED_SESSION_STREAM');
  f.bridge.abort();
  expect(f.recordingTrack.stop).not.toHaveBeenCalled(); expect(f.analysisTrack.stop).toHaveBeenCalledTimes(1);
  expect(f.source.disconnect).toHaveBeenCalledTimes(1); expect(f.node.port.close).toHaveBeenCalledTimes(1);
  capture.stop(); expect(f.analysisTrack.stop).toHaveBeenCalledTimes(1);
});
it('AudioContext suspension invalidates analysis instead of resuming silently', async () => {
  const f = fixture();
  await connected(f, 'OWNED_ANALYSIS');
  f.context.state = 'suspended'; f.context.dispatchEvent(new Event('statechange'));
  expect(f.bridge.abort).toHaveBeenCalled(); expect(f.recordingTrack.stop).toHaveBeenCalledTimes(1);
  expect(f.node.port.postMessage).toHaveBeenCalledWith({ type: 'STOP' });
});
it('connection stays pending until the first synchronous acceptance and ACK, not graph connection', async () => {
  const f = fixture(); let ready = false;
  const pending = connected(f, 'OWNED_ANALYSIS').then(capture => { ready = true; return capture; });
  expect(ready).toBe(false);
  const capture = await pending;
  expect(f.bridge.receive).toHaveBeenCalledTimes(1);
  expect(f.node.port.postMessage).toHaveBeenCalledWith({ type: 'ACK', sequence: 0 });
  expect(ready).toBe(true); capture.stop();
});
it('cleanup during stabilization rejects readiness, releases once and does not report a false failure', async () => {
  const f = fixture();
  const pending = BrowserAcousticCapture.connect({ bridge: f.bridge as unknown as ContinuousCaptureBridge,
    stream: f.stream as unknown as MediaStream, ownership: 'OWNED_ANALYSIS', context: f.context as unknown as AudioContext, workletUrl: '/worklet' });
  await vi.waitFor(() => expect(f.node.port.onmessage).toBeTypeOf('function'));
  f.bridge.abort(); // Simulates the owner cancelling its attached capture cleanup.
  await expect(pending).rejects.toMatchObject({ kind: 'CAPTURE', code: 'CONNECTION_FAILED' });
  expect(f.bridge.abort).toHaveBeenCalledTimes(1); expect(f.recordingTrack.stop).toHaveBeenCalledTimes(1);
});
it('partial initialization failure releases already-constructed worklet and analysis track', async () => {
  const f = fixture(); f.context.createMediaStreamSource = () => { throw new Error('source initialization failed'); };
  await expect(BrowserAcousticCapture.connect({ bridge: f.bridge as unknown as ContinuousCaptureBridge,
    stream: f.stream as unknown as MediaStream, ownership: 'BORROWED_SESSION_STREAM', context: f.context as unknown as AudioContext, workletUrl: '/worklet' })).rejects.toMatchObject({ kind: 'CAPTURE', code: 'CONNECTION_FAILED' });
  expect(f.node.port.close).toHaveBeenCalledTimes(1); expect(f.analysisTrack.stop).toHaveBeenCalledTimes(1);
  expect(f.recordingTrack.stop).not.toHaveBeenCalled();
});
it.each(['consumer', 'async-consumer', 'ACK'])('readiness rejects and cleans up once on %s failure', async kind => {
  const f = fixture();
  if (kind === 'consumer') f.bridge.receive.mockImplementation(() => { throw new Error('CONSUMER_FAILURE'); });
  if (kind === 'async-consumer') f.bridge.receive.mockReturnValue(Promise.resolve());
  if (kind === 'ACK') f.node.port.postMessage.mockImplementation(message => { if (message.type === 'ACK') throw new Error('PORT_FAILURE'); });
  await expect(connected(f, 'OWNED_ANALYSIS')).rejects.toMatchObject(kind === 'consumer' ? { message: 'CONSUMER_FAILURE' } : { kind: 'CAPTURE', code: kind === 'ACK' ? 'MESSAGE_ERROR' : 'PIPELINE_INVALID' });
  expect(f.bridge.abort).toHaveBeenCalledTimes(1); expect(f.recordingTrack.stop).toHaveBeenCalledTimes(1);
});
it('pre-domain readiness timeout is bounded and does not close the borrowed session context', async () => {
  vi.useFakeTimers(); const f = fixture();
  const pending = BrowserAcousticCapture.connect({ bridge: f.bridge as unknown as ContinuousCaptureBridge,
    stream: f.stream as unknown as MediaStream, ownership: 'OWNED_ANALYSIS', context: f.context as unknown as AudioContext, workletUrl: '/worklet' });
  const rejected = expect(pending).rejects.toMatchObject({ kind: 'CAPTURE', code: 'READINESS_TIMEOUT' });
  await vi.advanceTimersByTimeAsync(10000); await rejected;
  expect(f.recordingTrack.stop).toHaveBeenCalledTimes(1); expect(f.context.state).toBe('running');
});

it('retained capture keeps the original graph across temporary context suspension, but closure still invalidates it', async () => {
  const f = fixture(), capture = await connected(f, 'BORROWED_SESSION_STREAM', 'RETAIN_GRAPH');
  const source = f.source, node = f.node;
  f.context.state = 'suspended'; f.context.dispatchEvent(new Event('statechange'));
  expect(f.bridge.abort).not.toHaveBeenCalled(); expect(f.analysisTrack.stop).not.toHaveBeenCalled(); expect(node.port.close).not.toHaveBeenCalled();
  f.context.state = 'running'; f.context.dispatchEvent(new Event('statechange'));
  (node.port.onmessage as (event: unknown) => void)({ data: { type: 'pcm-chunk', sequence: 1, samples: new Float32Array(2048) } });
  expect(node.port.postMessage).toHaveBeenCalledWith({ type: 'ACK', sequence: 1 }); expect(f.context.audioWorklet.addModule).toHaveBeenCalledOnce();
  expect(f.source).toBe(source); expect(f.bridge.receive).toHaveBeenCalledTimes(2);
  f.context.state = 'closed'; f.context.dispatchEvent(new Event('statechange'));
  expect(f.bridge.abort).toHaveBeenCalledOnce(); expect(f.analysisTrack.stop).toHaveBeenCalledOnce(); expect(f.recordingTrack.stop).not.toHaveBeenCalled();
  capture.stop(); expect(f.analysisTrack.stop).toHaveBeenCalledOnce();
});
it('borrowed capture retains fail-on-interruption semantics unless its owner explicitly retains the graph', async () => {
  const f = fixture(); await connected(f, 'BORROWED_SESSION_STREAM');
  f.context.state = 'suspended'; f.context.dispatchEvent(new Event('statechange'));
  expect(f.bridge.abort).toHaveBeenCalledOnce(); expect(f.analysisTrack.stop).toHaveBeenCalledOnce();
});


it('R04 capture ACK follows synchronous acceptance even while the accepted inference remains pending', async () => {
  const f = fixture(), order: string[] = [];
  let release!: () => void, inferred = false;
  const inference = new Promise<void>(resolve => { release = resolve; }).then(() => { inferred = true; });
  f.bridge.receive.mockImplementation(() => { order.push('accept'); void inference; });
  f.node.port.postMessage.mockImplementation(message => { if (message.type === 'ACK') order.push('ack'); });
  const capture = await connected(f, 'BORROWED_SESSION_STREAM');
  expect(order).toEqual(['accept', 'ack']); expect(inferred).toBe(false);
  expect(f.bridge.abort).not.toHaveBeenCalled();
  release(); await inference; expect(inferred).toBe(true);
  capture.stop(); expect(f.analysisTrack.stop).toHaveBeenCalledOnce(); expect(f.recordingTrack.stop).not.toHaveBeenCalled();
});
