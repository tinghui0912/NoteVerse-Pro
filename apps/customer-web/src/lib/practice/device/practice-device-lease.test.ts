import { describe, expect, it, vi } from 'vitest';
import { PracticeDeviceLease } from './practice-device-lease';
import { practiceDeviceRequirements, type PracticeDeviceConfiguration } from './device-contract';
import { midiDeviceFixture } from '../__fixtures__/device-roots';

function media(video = false) {
  const track = Object.assign(new EventTarget(), { kind: video ? 'video' : 'audio', readyState: 'live', muted: false,
    stop: vi.fn(() => { track.readyState = 'ended'; }) });
  const stream = { getTracks: () => [track], getAudioTracks: () => video ? [] : [track], getVideoTracks: () => video ? [track] : [] } as unknown as MediaStream;
  return { track, stream };
}
function rig(configuration: PracticeDeviceConfiguration) {
  const acquired: ReturnType<typeof media>[] = [], midi = midiDeviceFixture();
  const platform = { acquireStream: vi.fn(async (resource: string) => { const root = media(resource === 'camera'); acquired.push(root); return root.stream; }),
    acquireMidi: vi.fn(async () => midi.access) };
  return { owner: new PracticeDeviceLease(configuration, platform), platform, acquired, midi };
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
describe('page-scoped Practice Device Lease', () => {
  it.each(matrix)('%s / %s / %s owns exactly its required roots', async (mode, inputSource, recordingMode, expected) => {
    const configuration = { mode, inputSource, recordingMode }, f = rig(configuration);
    expect(practiceDeviceRequirements(configuration)).toEqual(expected); await f.owner.open();
    expect(f.owner.snapshot().state).toBe('READY');
    const original = f.owner.snapshot().roots;
    await f.owner.open(); await f.owner.renewFailed();
    expect(f.owner.snapshot().roots).toEqual(original);
    expect(f.platform.acquireStream).toHaveBeenCalledTimes(expected.filter(r => r !== 'midi').length);
    expect(f.platform.acquireMidi).toHaveBeenCalledTimes(inputSource === 'MIDI' ? 1 : 0);
    f.owner.close(); f.owner.close();
    for (const root of f.acquired) expect(root.track.stop).toHaveBeenCalledOnce();
  });
  it('observes mute/unmute passively and renews only a lost root on explicit Restart', async () => {
    const f = rig({ mode: 'CONTINUOUS_PLAY', inputSource: 'MICROPHONE', recordingMode: 'VIDEO' });
    await f.owner.open(); const [input, camera] = f.acquired, changes = vi.fn(); f.owner.subscribe(changes);
    input.track.muted = true; input.track.dispatchEvent(new Event('mute'));
    expect(f.owner.snapshot().health.inputMicrophone).toBe('INTERRUPTED'); expect(f.platform.acquireStream).toHaveBeenCalledTimes(2);
    input.track.muted = false; input.track.dispatchEvent(new Event('unmute')); expect(f.owner.snapshot().state).toBe('READY');
    camera.track.readyState = 'ended'; camera.track.dispatchEvent(new Event('ended'));
    expect(f.owner.snapshot().health.camera).toBe('LOST'); expect(f.platform.acquireStream).toHaveBeenCalledTimes(2);
    await f.owner.renewFailed(); expect(f.platform.acquireStream).toHaveBeenCalledTimes(3);
    expect(f.owner.snapshot().roots.inputMicrophone).toBe(input.stream); expect(input.track.stop).not.toHaveBeenCalled();
    f.owner.close(); const calls = changes.mock.calls.length; input.track.dispatchEvent(new Event('mute')); expect(changes).toHaveBeenCalledTimes(calls);
  });
  it('detach does not overwrite another MIDI listener, and page re-entry acquires a fresh lease', async () => {
    const configuration = { mode: 'CONTINUOUS_PLAY', inputSource: 'MIDI', recordingMode: 'OFF' } as const;
    const f = rig(configuration), other = vi.fn(); f.midi.access.addEventListener('statechange', other);
    await f.owner.open(); f.midi.connect(false); expect(f.owner.snapshot().health.midi).toBe('LOST');
    f.midi.connect(true); expect(f.owner.snapshot().state).toBe('READY'); f.owner.close();
    f.midi.connect(false); expect(other).toHaveBeenCalledTimes(3); expect(f.owner.snapshot().roots.midi).toBeNull();
    f.midi.connect(true); const next = new PracticeDeviceLease(configuration, f.platform); await next.open();
    expect(f.platform.acquireMidi).toHaveBeenCalledTimes(2); next.close();
  });
  it.each(['NotAllowedError', 'NotFoundError', 'NotReadableError'])('root %s fails page binding closed without leaking browser details', async name => {
    const f = rig({ mode: 'CONTINUOUS_PLAY', inputSource: 'MIDI', recordingMode: 'AUDIO' });
    f.platform.acquireStream.mockRejectedValueOnce(new DOMException('private browser details', name));
    await expect(f.owner.open()).rejects.toThrow('PRACTICE_DEVICE_UNAVAILABLE');
    expect(f.owner.snapshot()).toMatchObject({ state: 'FAULTED', error: 'PRACTICE_DEVICE_UNAVAILABLE', roots: { recordingMicrophone: null } });
    f.owner.close();
  });
  it('page departure stops a late stream and never revives a closed owner', async () => {
    const f = rig({ mode: 'STEP_BY_STEP', inputSource: 'MICROPHONE', recordingMode: 'OFF' }), late = media();
    let release!: (stream: MediaStream) => void;
    f.platform.acquireStream.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const opening = f.owner.open(); f.owner.close(); release(late.stream); await opening;
    expect(late.track.stop).toHaveBeenCalledOnce(); expect(f.owner.snapshot().state).toBe('CLOSED');
  });
});
