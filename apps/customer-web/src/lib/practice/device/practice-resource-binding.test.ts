import { DeviceFailure } from '@/lib/practice/failure/causal-failure';
import { describe, expect, it, vi } from 'vitest';
import { PracticeResourceBinding } from './practice-resource-binding';
import { planPracticeResources } from '@/lib/practice/planning/resource-plan';
import type { PracticeExecutionIntent } from '@/lib/practice/planning/execution-intent';
import { midiDeviceFixture } from '../__fixtures__/device-roots';

function media(video = false) {
  const track = Object.assign(new EventTarget(), { kind: video ? 'video' : 'audio', readyState: 'live', muted: false,
    stop: vi.fn(() => { track.readyState = 'ended'; }) });
  const stream = { getTracks: () => [track], getAudioTracks: () => video ? [] : [track], getVideoTracks: () => video ? [track] : [] } as unknown as MediaStream;
  return { track, stream };
}
function rig(configuration: Pick<PracticeExecutionIntent, 'mode' | 'inputSource' | 'recordingMode'>) {
  const acquired: ReturnType<typeof media>[] = [], midi = midiDeviceFixture();
  const platform = { acquireStream: vi.fn(async (resource: string) => { const root = media(resource === 'camera'); acquired.push(root); return root.stream; }),
    acquireMidi: vi.fn(async () => midi.access) };
  return { owner: new PracticeResourceBinding(planPracticeResources(configuration), platform), platform, acquired, midi };
}
const matrix = [
  ['STEP_BY_STEP', 'MICROPHONE', 'OFF', ['inputMicrophone']],
  ['STEP_BY_STEP', 'MIDI', 'OFF', ['midi']],
  ['CONTINUOUS_PLAY', 'MICROPHONE', 'OFF', ['inputMicrophone']],
  ['CONTINUOUS_PLAY', 'MICROPHONE', 'AUDIO', ['inputMicrophone']],
  ['CONTINUOUS_PLAY', 'MICROPHONE', 'VIDEO', ['inputMicrophone', 'camera']],
  ['CONTINUOUS_PLAY', 'MIDI', 'OFF', ['midi']],
  ['CONTINUOUS_PLAY', 'MIDI', 'AUDIO', ['midi', 'recordingMicrophone']],
  ['CONTINUOUS_PLAY', 'MIDI', 'VIDEO', ['midi', 'recordingMicrophone', 'camera']],
] as const;
describe('retained Practice Resource Binding', () => {
  it.each(matrix)('%s / %s / %s owns exactly its required roots', async (mode, inputSource, recordingMode, expected) => {
    const configuration = { mode, inputSource, recordingMode }, f = rig(configuration);
    expect(planPracticeResources(configuration).liveRoots).toEqual(expected); await f.owner.open();
    expect(f.owner.snapshot().state).toBe('READY');
    const original = f.owner.snapshot().roots;
    await f.owner.open();
    expect(f.owner.snapshot().roots).toEqual(original);
    expect(f.platform.acquireStream.mock.calls.map(([root]) => root)).toEqual(expected.filter(r => r !== 'midi'));
    expect(f.platform.acquireMidi).toHaveBeenCalledTimes(inputSource === 'MIDI' ? 1 : 0);
    f.owner.close(); f.owner.close();
    for (const root of f.acquired) expect(root.track.stop).toHaveBeenCalledOnce();
  });
  it('observes same-root recovery but never rebinds a hard-lost root', async () => {
    const f = rig({ mode: 'CONTINUOUS_PLAY', inputSource: 'MICROPHONE', recordingMode: 'VIDEO' });
    await f.owner.open(); const [input, camera] = f.acquired, changes = vi.fn(); f.owner.subscribe(changes);
    input.track.muted = true; input.track.dispatchEvent(new Event('mute'));
    expect(f.owner.snapshot().issue).toEqual({ resource: 'inputMicrophone', phase: 'RUNTIME', condition: 'INTERRUPTED' });
    expect(f.owner.snapshot().health.inputMicrophone).toBe('INTERRUPTED'); expect(f.platform.acquireStream).toHaveBeenCalledTimes(2);
    input.track.muted = false; input.track.dispatchEvent(new Event('unmute')); expect(f.owner.snapshot().state).toBe('READY');
    expect(f.owner.snapshot().issue).toBeNull();
    camera.track.readyState = 'ended'; camera.track.dispatchEvent(new Event('ended'));
    expect(f.owner.snapshot().issue).toEqual({ resource: 'camera', phase: 'RUNTIME', condition: 'LOST' });
    expect(f.owner.snapshot().health.camera).toBe('LOST'); expect(f.platform.acquireStream).toHaveBeenCalledTimes(2);
    await expect(f.owner.open()).rejects.toThrow('PRACTICE_DEVICE_UNAVAILABLE');
    expect(f.platform.acquireStream).toHaveBeenCalledTimes(2);
    expect(f.owner.snapshot().roots.inputMicrophone).toBe(input.stream); expect(input.track.stop).not.toHaveBeenCalled();
    f.owner.close(); const calls = changes.mock.calls.length; input.track.dispatchEvent(new Event('mute')); expect(changes).toHaveBeenCalledTimes(calls);
  });
  it('detach does not overwrite another MIDI listener, and page re-entry acquires a fresh lease', async () => {
    const configuration = { mode: 'CONTINUOUS_PLAY', inputSource: 'MIDI', recordingMode: 'OFF' } as const;
    const f = rig(configuration), other = vi.fn(); f.midi.access.addEventListener('statechange', other);
    await f.owner.open(); f.midi.connect(false); expect(f.owner.snapshot().health.midi).toBe('LOST');
    expect(f.owner.snapshot().issue).toEqual({ resource: 'midi', phase: 'RUNTIME', condition: 'LOST' });
    f.midi.connect(true); expect(f.owner.snapshot().state).toBe('READY');
    expect(f.platform.acquireMidi).toHaveBeenCalledOnce(); f.owner.close();
    f.midi.connect(false); expect(other).toHaveBeenCalledTimes(3); expect(f.owner.snapshot().roots.midi).toBeNull();
    f.midi.connect(true); const next = new PracticeResourceBinding(planPracticeResources(configuration), f.platform); await next.open();
    expect(f.platform.acquireMidi).toHaveBeenCalledTimes(2); next.close();
  });
  it.each(['PERMISSION_DENIED', 'NOT_FOUND', 'BUSY'] as const)('root %s fails page binding closed without leaking browser details', async name => {
    const f = rig({ mode: 'CONTINUOUS_PLAY', inputSource: 'MIDI', recordingMode: 'AUDIO' });
    f.platform.acquireStream.mockRejectedValueOnce(new DeviceFailure(name, 'MICROPHONE', { cause: new Error('private browser detail') }));
    await expect(f.owner.open()).rejects.toMatchObject({kind:'DEVICE',code:name});
    expect(f.owner.snapshot()).toMatchObject({ state: 'FAULTED', issue: { resource: 'recordingMicrophone', phase: 'OPEN', condition: name }, roots: { recordingMicrophone: null } });
    f.owner.close();
  });
  it('page departure stops a late stream and never revives a closed owner', async () => {
    const f = rig({ mode: 'STEP_BY_STEP', inputSource: 'MICROPHONE', recordingMode: 'OFF' }), late = media();
    let release!: (stream: MediaStream) => void;
    f.platform.acquireStream.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const opening = f.owner.open(); f.owner.close(); release(late.stream); await opening;
    expect(late.track.stop).toHaveBeenCalledOnce(); expect(f.owner.snapshot().state).toBe('CLOSED');
  });
  it('rolls back the entire opening transaction when camera permission fails after microphone acquisition', async () => {
    const f = rig({ mode: 'CONTINUOUS_PLAY', inputSource: 'MICROPHONE', recordingMode: 'VIDEO' });
    f.platform.acquireStream.mockImplementationOnce(async () => {
      const root = media(); f.acquired.push(root); return root.stream;
    }).mockRejectedValueOnce(new DeviceFailure('PERMISSION_DENIED', 'CAMERA'));
    await expect(f.owner.open()).rejects.toMatchObject({kind:'DEVICE',code:'PERMISSION_DENIED'});
    expect(f.acquired[0].track.stop).toHaveBeenCalledOnce();
    expect(f.owner.snapshot()).toMatchObject({ state: 'FAULTED', roots: { inputMicrophone: null, camera: null },
      issue: { resource: 'camera', phase: 'OPEN', condition: 'PERMISSION_DENIED' } });
    const changes = vi.fn(); f.owner.subscribe(changes);
    f.acquired[0].track.dispatchEvent(new Event('unmute')); expect(changes).not.toHaveBeenCalled();
    await expect(f.owner.open()).rejects.toThrow('PRACTICE_DEVICE_UNAVAILABLE');
    expect(f.platform.acquireStream).toHaveBeenCalledTimes(2); f.owner.close();
  });
  it('detaches and clears acquired MIDI when a later recording microphone open fails', async () => {
    const f = rig({ mode: 'CONTINUOUS_PLAY', inputSource: 'MIDI', recordingMode: 'AUDIO' });
    f.platform.acquireStream.mockRejectedValueOnce(new DeviceFailure('NOT_FOUND', 'MICROPHONE'));
    await expect(f.owner.open()).rejects.toMatchObject({kind:'DEVICE',code:'NOT_FOUND'});
    expect(f.owner.snapshot()).toMatchObject({ state: 'FAULTED', roots: { midi: null, recordingMicrophone: null },
      issue: { resource: 'recordingMicrophone', phase: 'OPEN', condition: 'NOT_FOUND' } });
    const changed = vi.fn(); f.owner.subscribe(changed); f.midi.connect(false); f.midi.connect(true);
    expect(changed).not.toHaveBeenCalled(); f.owner.close();
  });
});

it.each(['inputMicrophone', 'recordingMicrophone', 'camera'] as const)('%s physical facts come from one retained lease observer', async resource => {
  const plan = planPracticeResources({ mode: 'CONTINUOUS_PLAY', inputSource: resource === 'inputMicrophone' ? 'MICROPHONE' : 'MIDI', recordingMode: resource === 'camera' ? 'VIDEO' : resource === 'recordingMicrophone' ? 'AUDIO' : 'OFF' });
  const root = media(resource === 'camera'), midi = midiDeviceFixture();
  const acquire = vi.fn(async (name: string) => name === resource ? root.stream : media(name === 'camera').stream);
  const lease = new PracticeResourceBinding(plan, { acquireStream: acquire, acquireMidi: async () => midi.access });
  await lease.open(); const port = lease.rootHealth, changes = vi.fn();
  expect(Object.keys(port).sort()).toEqual(['snapshot', 'subscribe']);
  const unsubscribe = port.subscribe(changes);
  expect(changes).toHaveBeenCalledOnce();
  const original = lease.snapshot().roots[resource];
  for (const [event, expected] of [['mute', 'INTERRUPTED'], ['unmute', 'HEALTHY'], ['ended', 'LOST']] as const) {
    if (event === 'ended') root.track.readyState = 'ended'; else root.track.muted = event === 'mute';
    root.track.dispatchEvent(new Event(event));
    expect(port.snapshot().health[resource]).toBe(expected);
    expect(lease.snapshot().roots[resource]).toBe(original);
    expect(Object.isFrozen(port.snapshot())).toBe(true); expect(Object.isFrozen(port.snapshot().health)).toBe(true);
  }
  expect(changes).toHaveBeenCalledTimes(4); expect(acquire).toHaveBeenCalledTimes(plan.liveRoots.filter(key => key !== 'midi').length);
  unsubscribe(); root.track.dispatchEvent(new Event('mute')); expect(changes).toHaveBeenCalledTimes(4);
  lease.close(); root.track.dispatchEvent(new Event('unmute')); expect(changes).toHaveBeenCalledTimes(4);
});
it('MIDI same-root recovery is synchronous and subscription delivers current facts after a prior read', async () => {
  const f = rig({ mode: 'STEP_BY_STEP', inputSource: 'MIDI', recordingMode: 'OFF' }); await f.owner.open();
  const port = f.owner.rootHealth, initial = port.snapshot(); f.midi.connect(false);
  const received = vi.fn(), unsubscribe = port.subscribe(received);
  expect(initial.health.midi).toBe('HEALTHY'); expect(received.mock.calls[0][0].health.midi).toBe('LOST');
  f.midi.connect(true); expect(received.mock.calls[1][0].health.midi).toBe('HEALTHY');
  expect(f.owner.snapshot().roots.midi).toBe(f.midi.access); expect(f.platform.acquireMidi).toHaveBeenCalledOnce();
  f.owner.close(); const calls = received.mock.calls.length; f.midi.connect(false);
  expect(received).toHaveBeenCalledTimes(calls); unsubscribe();
});

it('publishes MIDI access membership events even when aggregate physical health stays healthy', async () => {
  const f = rig({ mode: 'STEP_BY_STEP', inputSource: 'MIDI', recordingMode: 'OFF' }); await f.owner.open();
  const observed = vi.fn(), unsubscribe = f.owner.rootHealth.subscribe(observed);
  f.midi.access.dispatchEvent(new Event('statechange'));
  expect(observed.mock.calls.map(([snapshot]) => snapshot.health.midi)).toEqual(['HEALTHY', 'HEALTHY']);
  expect(f.platform.acquireMidi).toHaveBeenCalledOnce(); unsubscribe(); f.owner.close();
});
