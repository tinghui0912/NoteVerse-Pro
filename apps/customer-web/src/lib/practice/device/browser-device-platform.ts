import type { PracticeLiveRoot } from '@/lib/practice/planning/resource-plan';

export interface PracticeDevicePlatform {
  acquireStream(resource: Exclude<PracticeLiveRoot, 'midi'>): Promise<MediaStream>;
  acquireMidi(): Promise<MIDIAccess>;
}
export const browserDevicePlatform: PracticeDevicePlatform = {
  acquireStream: resource => navigator.mediaDevices.getUserMedia(resource === 'camera'
    ? { video: { facingMode: 'user' }, audio: false }
    : { video: false, audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }),
  acquireMidi: () => navigator.requestMIDIAccess({ sysex: false }),
};
