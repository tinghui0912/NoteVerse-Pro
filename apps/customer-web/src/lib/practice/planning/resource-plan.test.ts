import { expect, it } from 'vitest';
import { planPracticeResources } from './resource-plan';

const matrix = [
  ['STEP_BY_STEP', 'MICROPHONE', 'OFF', ['acousticEngine', 'browserAudio', 'microphone'], ['inputMicrophone'],
    { kind: 'MICROPHONE', root: 'inputMicrophone' }, { kind: 'ACOUSTIC', sourceRoot: 'inputMicrophone' }, { mode: 'OFF' }],
  ['STEP_BY_STEP', 'MIDI', 'OFF', ['midi'], ['midi'],
    { kind: 'MIDI', root: 'midi' }, { kind: 'NONE' }, { mode: 'OFF' }],
  ['CONTINUOUS_PLAY', 'MICROPHONE', 'OFF', ['acousticEngine', 'browserAudio', 'microphone'], ['inputMicrophone'],
    { kind: 'MICROPHONE', root: 'inputMicrophone' }, { kind: 'ACOUSTIC', sourceRoot: 'inputMicrophone' }, { mode: 'OFF' }],
  ['CONTINUOUS_PLAY', 'MICROPHONE', 'AUDIO', ['acousticEngine', 'audioRecording', 'browserAudio', 'microphone'], ['inputMicrophone'],
    { kind: 'MICROPHONE', root: 'inputMicrophone' }, { kind: 'ACOUSTIC', sourceRoot: 'inputMicrophone' }, { mode: 'AUDIO', audioRoot: 'inputMicrophone' }],
  ['CONTINUOUS_PLAY', 'MICROPHONE', 'VIDEO', ['acousticEngine', 'browserAudio', 'camera', 'microphone', 'videoRecording'], ['inputMicrophone', 'camera'],
    { kind: 'MICROPHONE', root: 'inputMicrophone' }, { kind: 'ACOUSTIC', sourceRoot: 'inputMicrophone' }, { mode: 'VIDEO', audioRoot: 'inputMicrophone', videoRoot: 'camera' }],
  ['CONTINUOUS_PLAY', 'MIDI', 'OFF', ['midi'], ['midi'],
    { kind: 'MIDI', root: 'midi' }, { kind: 'NONE' }, { mode: 'OFF' }],
  ['CONTINUOUS_PLAY', 'MIDI', 'AUDIO', ['audioRecording', 'microphone', 'midi'], ['midi', 'recordingMicrophone'],
    { kind: 'MIDI', root: 'midi' }, { kind: 'NONE' }, { mode: 'AUDIO', audioRoot: 'recordingMicrophone' }],
  ['CONTINUOUS_PLAY', 'MIDI', 'VIDEO', ['camera', 'microphone', 'midi', 'videoRecording'], ['midi', 'recordingMicrophone', 'camera'],
    { kind: 'MIDI', root: 'midi' }, { kind: 'NONE' }, { mode: 'VIDEO', audioRoot: 'recordingMicrophone', videoRoot: 'camera' }],
] as const;
it.each(matrix)('%s / %s / %s owns exact qualification, roots and bindings',
  (mode, inputSource, recordingMode, qualification, liveRoots, input, analysis, recording) => {
    const plan = planPracticeResources({ mode, inputSource, recordingMode });
    expect(plan).toEqual({ qualification, liveRoots, input, analysis, recording });
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.values(plan).every(Object.isFrozen)).toBe(true);
  });
it.each(['AUDIO', 'VIDEO'] as const)('rejects STEP recording %s without repair', recordingMode => {
  for (const inputSource of ['MICROPHONE', 'MIDI'] as const) {
    expect(() => planPracticeResources({ mode: 'STEP_BY_STEP', inputSource, recordingMode })).toThrow('Invalid Practice resource intent.');
  }
});
it.each([null, {}, { mode: 'OTHER', inputSource: 'MIDI', recordingMode: 'OFF' },
  { mode: 'CONTINUOUS_PLAY', inputSource: 'OTHER', recordingMode: 'OFF' },
  { mode: 'CONTINUOUS_PLAY', inputSource: 'MIDI', recordingMode: 'OTHER' }])('rejects malformed resource intent %s', intent => {
  expect(() => planPracticeResources(intent as never)).toThrow();
});
it('depends only on execution resource choices, with stable immutable projection identities', () => {
  const intent = { mode: 'CONTINUOUS_PLAY', inputSource: 'MIDI', recordingMode: 'VIDEO' } as const;
  const first = planPracticeResources(intent);
  const withOtherChoices = { ...intent, scope: { kind: 'RANGE', startGroupId: 'a', endGroupId: 'b' },
    tempoSelection: { mode: 'CUSTOM_FIXED_BPM', bpm: 100 }, metronomeEnabled: true,
    binding: { scoreId: 'score-1', revisionId: 'revision-1', bundleId: 'source' }, artifact: {}, liveFeedbackEnabled: true };
  expect(planPracticeResources(withOtherChoices)).toBe(first);
  expect(planPracticeResources({ ...intent })).toBe(first);
  for (const value of [first, first.qualification, first.liveRoots, first.input, first.analysis, first.recording]) {
    expect(Object.isFrozen(value)).toBe(true);
  }
  expect(() => Object.assign(first.recording, { audioRoot: 'inputMicrophone' })).toThrow();
  expect(() => Reflect.apply(Array.prototype.push, first.liveRoots, ['inputMicrophone'])).toThrow();
  expect(() => Reflect.apply(Array.prototype.push, first.qualification, ['browserAudio'])).toThrow();
});
