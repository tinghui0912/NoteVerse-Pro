import type { PracticeConfiguration } from '@/lib/practice/configuration/preferences';

export type PracticeRequirement = 'browserAudio' | 'microphone' | 'acousticEngine' | 'midi' | 'camera' | 'audioRecording' | 'videoRecording';
export function resolvePracticeRequirements(configuration: PracticeConfiguration): readonly PracticeRequirement[] {
  const requirements = new Set<PracticeRequirement>();
  if (configuration.inputSource === 'MICROPHONE') {
    requirements.add('browserAudio'); requirements.add('microphone'); requirements.add('acousticEngine');
  } else requirements.add('midi');
  if (configuration.mode === 'CONTINUOUS_PLAY' && configuration.recordingMode !== 'OFF') {
    requirements.add('microphone');
    requirements.add(configuration.recordingMode === 'VIDEO' ? 'videoRecording' : 'audioRecording');
    if (configuration.recordingMode === 'VIDEO') requirements.add('camera');
  }
  return Object.freeze([...requirements].sort());
}
export function requirementFingerprint(requirements: readonly PracticeRequirement[]): string {
  return [...new Set(requirements)].sort().join('|');
}
