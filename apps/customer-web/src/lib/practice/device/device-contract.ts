import type { PracticeMode, PracticeInputSource } from '@/lib/practice/kernel/session';
import type { PracticeRecordingMode } from '@/lib/practice/recording/recording-mode';

export type PracticeDeviceConfiguration = Readonly<{
  mode: PracticeMode; inputSource: PracticeInputSource; recordingMode: PracticeRecordingMode;
}>;
export type PracticeDeviceResource = 'inputMicrophone' | 'recordingMicrophone' | 'camera' | 'midi';
export type PracticeDeviceRoots = Readonly<{
  inputMicrophone: MediaStream | null;
  recordingMicrophone: MediaStream | null;
  camera: MediaStream | null;
  midi: MIDIAccess | null;
}>;
export type PracticeDeviceHealth = 'HEALTHY' | 'INTERRUPTED' | 'LOST';
export type PracticeDeviceIssue = Readonly<{
  resource: PracticeDeviceResource;
  phase: 'OPEN' | 'RUNTIME';
  condition: 'INTERRUPTED' | 'LOST' | 'PERMISSION_DENIED' | 'NOT_FOUND' | 'BUSY' | 'UNAVAILABLE';
}>;
export function practiceDeviceRequirements(configuration: PracticeDeviceConfiguration): readonly PracticeDeviceResource[] {
  const resources: PracticeDeviceResource[] = [configuration.inputSource === 'MICROPHONE' ? 'inputMicrophone' : 'midi'];
  if (configuration.mode === 'CONTINUOUS_PLAY' && configuration.recordingMode !== 'OFF') {
    if (configuration.inputSource === 'MIDI') resources.push('recordingMicrophone');
    if (configuration.recordingMode === 'VIDEO') resources.push('camera');
  }
  return Object.freeze(resources);
}
