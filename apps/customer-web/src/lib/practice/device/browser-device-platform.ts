import type { PracticeDeviceResource } from './device-contract';

export interface PracticeDevicePlatform {
  acquireStream(resource: Exclude<PracticeDeviceResource, 'midi'>): Promise<MediaStream>;
  acquireMidi(): Promise<MIDIAccess>;
}
export const browserDevicePlatform: PracticeDevicePlatform = {
  acquireStream: resource => navigator.mediaDevices.getUserMedia(resource === 'camera'
    ? { video: { facingMode: 'user' }, audio: false }
    : { video: false, audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }),
  acquireMidi: () => navigator.requestMIDIAccess({ sysex: false }),
};
