import { afterEach, expect, it, vi } from 'vitest';
import { BrowserAcousticCapture } from '../source/capture';
import type { ContinuousCaptureBridge } from './capture-bridge';

afterEach(() => vi.unstubAllGlobals());
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
it('borrowed recording stream is cloned; analysis failure stops only the owned clone and disconnects all nodes', async () => {
  const f = fixture();
  const capture = await BrowserAcousticCapture.connect({ bridge: f.bridge as unknown as ContinuousCaptureBridge,
    stream: f.stream as unknown as MediaStream, ownership: 'BORROWED_SESSION_STREAM', context: f.context as unknown as AudioContext, workletUrl: '/worklet' });
  f.bridge.abort();
  expect(f.recordingTrack.stop).not.toHaveBeenCalled(); expect(f.analysisTrack.stop).toHaveBeenCalledTimes(1);
  expect(f.source.disconnect).toHaveBeenCalledTimes(1); expect(f.node.port.close).toHaveBeenCalledTimes(1);
  capture.stop(); expect(f.analysisTrack.stop).toHaveBeenCalledTimes(1);
});
it('AudioContext suspension invalidates analysis instead of resuming silently', async () => {
  const f = fixture();
  await BrowserAcousticCapture.connect({ bridge: f.bridge as unknown as ContinuousCaptureBridge,
    stream: f.stream as unknown as MediaStream, ownership: 'OWNED_ANALYSIS', context: f.context as unknown as AudioContext, workletUrl: '/worklet' });
  f.context.state = 'suspended'; f.context.dispatchEvent(new Event('statechange'));
  expect(f.bridge.abort).toHaveBeenCalled(); expect(f.recordingTrack.stop).toHaveBeenCalledTimes(1);
  expect(f.node.port.postMessage).toHaveBeenCalledWith({ type: 'STOP' });
});
it('partial initialization failure releases already-constructed worklet and analysis track', async () => {
  const f = fixture(); f.context.createMediaStreamSource = () => { throw new Error('source initialization failed'); };
  await expect(BrowserAcousticCapture.connect({ bridge: f.bridge as unknown as ContinuousCaptureBridge,
    stream: f.stream as unknown as MediaStream, ownership: 'BORROWED_SESSION_STREAM', context: f.context as unknown as AudioContext, workletUrl: '/worklet' })).rejects.toThrow('source initialization failed');
  expect(f.node.port.close).toHaveBeenCalledTimes(1); expect(f.analysisTrack.stop).toHaveBeenCalledTimes(1);
  expect(f.recordingTrack.stop).not.toHaveBeenCalled();
});
