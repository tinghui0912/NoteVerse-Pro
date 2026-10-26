import { expect, it } from 'vitest';
import { resolvePracticeRequirements, requirementFingerprint } from './requirements';
import type { PracticeConfiguration } from '@/lib/practice/configuration/preferences';

it.each([
  ['STEP_BY_STEP', 'MICROPHONE', 'OFF', ['acousticEngine', 'browserAudio', 'microphone']],
  ['STEP_BY_STEP', 'MIDI', 'OFF', ['midi']],
  ['CONTINUOUS_PLAY', 'MICROPHONE', 'OFF', ['acousticEngine', 'browserAudio', 'microphone']],
  ['CONTINUOUS_PLAY', 'MICROPHONE', 'AUDIO', ['acousticEngine', 'audioRecording', 'browserAudio', 'microphone']],
  ['CONTINUOUS_PLAY', 'MICROPHONE', 'VIDEO', ['acousticEngine', 'browserAudio', 'camera', 'microphone', 'videoRecording']],
  ['CONTINUOUS_PLAY', 'MIDI', 'OFF', ['midi']],
  ['CONTINUOUS_PLAY', 'MIDI', 'AUDIO', ['audioRecording', 'microphone', 'midi']],
  ['CONTINUOUS_PLAY', 'MIDI', 'VIDEO', ['camera', 'microphone', 'midi', 'videoRecording']],
] as const)('%s %s %s has exactly its infrastructure requirements', (mode, inputSource, recordingMode, expected) => {
  expect(resolvePracticeRequirements({ mode, inputSource, recordingMode, liveFeedbackEnabled: false })).toEqual(expected);
});
it('fingerprints infrastructure rather than unrelated configuration or presentation', () => {
  const config: PracticeConfiguration = { mode: 'STEP_BY_STEP', inputSource: 'MICROPHONE', recordingMode: 'OFF', liveFeedbackEnabled: false };
  const identity = requirementFingerprint(resolvePracticeRequirements(config));
  expect(requirementFingerprint(resolvePracticeRequirements({ ...config, mode: 'CONTINUOUS_PLAY', liveFeedbackEnabled: true }))).toBe(identity);
  expect(requirementFingerprint(resolvePracticeRequirements({ ...config, inputSource: 'MIDI' }))).not.toBe(identity);
});
