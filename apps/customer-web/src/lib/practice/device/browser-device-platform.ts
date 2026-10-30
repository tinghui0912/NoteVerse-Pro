import { DeviceFailure, MidiFailure } from '@/lib/practice/failure/causal-failure';
import { mediaDeviceFailure, midiAccessFailure } from '@/lib/practice/failure/browser-failures';
import type { PracticeLiveRoot } from '@/lib/practice/planning/resource-plan';

export interface PracticeDevicePlatform {
  acquireStream(resource: Exclude<PracticeLiveRoot, 'midi'>): Promise<MediaStream>;
  acquireMidi(): Promise<MIDIAccess>;
}
export const browserDevicePlatform: PracticeDevicePlatform = {
  acquireStream: async resource => {
    try {
      if (typeof navigator.mediaDevices?.getUserMedia !== 'function') throw new DeviceFailure('UNAVAILABLE', resource === 'camera' ? 'CAMERA' : 'MICROPHONE');
      return await navigator.mediaDevices.getUserMedia(resource === 'camera'
        ? { video: { facingMode: 'user' }, audio: false }
        : { video: false, audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch (cause) { throw cause instanceof DeviceFailure ? cause : mediaDeviceFailure(cause, resource === 'camera' ? 'CAMERA' : 'MICROPHONE'); }
  },
  acquireMidi: async () => {
    if (typeof navigator.requestMIDIAccess !== 'function') throw new MidiFailure('UNSUPPORTED');
    try { return await navigator.requestMIDIAccess({ sysex: false }); } catch (cause) { throw midiAccessFailure(cause); }
  },
};
