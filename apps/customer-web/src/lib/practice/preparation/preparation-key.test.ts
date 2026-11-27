import { expect, it } from 'vitest';
import { createPracticePreparationKey, samePracticePreparationKey } from './preparation-key';
import { samePracticeResourcePlan, planPracticeResources } from '../planning/resource-plan';

const choices = { mode: 'CONTINUOUS_PLAY', inputSource: 'MIDI', recordingMode: 'OFF' } as const;

it('uses canonical immutable values for equal fresh resource-choice objects', () => {
  const a = createPracticePreparationKey('score', 'revision', choices);
  const b = createPracticePreparationKey('score', 'revision', { ...choices });
  expect(a).not.toBe(b);
  expect(samePracticePreparationKey(a, b)).toBe(true);
  expect(a.value).toBe(JSON.stringify(['score', 'revision', 'CONTINUOUS_PLAY', 'MIDI', 'OFF']));
  expect(Object.isFrozen(a)).toBe(true);
});

it.each(['scoreId', 'revisionId', 'mode', 'inputSource', 'recordingMode'] as const)(
  '%s is part of preparation identity', field => {
    const a = createPracticePreparationKey('score', 'revision', choices);
    const b = createPracticePreparationKey(field === 'scoreId' ? 'other' : 'score',
      field === 'revisionId' ? 'other' : 'revision', {
        mode: field === 'mode' ? 'STEP_BY_STEP' : choices.mode,
        inputSource: field === 'inputSource' ? 'MICROPHONE' : choices.inputSource,
        recordingMode: field === 'recordingMode' ? 'AUDIO' : choices.recordingMode,
      });
    expect(samePracticePreparationKey(a, b)).toBe(false);
  },
);

it('candidate musical/presentation preferences and Bundle identity are not preparation inputs', () => {
  const key = createPracticePreparationKey('score', 'revision', choices);
  const candidate = { ...choices, scope: { kind: 'FULL' }, tempoSelection: { mode: 'SCORE' },
    metronomeEnabled: true, liveFeedbackEnabled: true, bundleId: 'another-representation' };
  expect(createPracticePreparationKey('score', 'revision', candidate).value).toBe(key.value);
  expect(samePracticePreparationKey(key, null)).toBe(false);
});

it('compares fresh plans by their requirements, including independent object/property order', () => {
  const a = planPracticeResources(choices);
  const b = { ...structuredClone(a), input: { root: 'midi' as const, kind: 'MIDI' as const } };
  expect(b).not.toBe(a);
  expect(samePracticeResourcePlan(a, b)).toBe(true);
  expect(samePracticeResourcePlan(a, planPracticeResources({ ...choices, recordingMode: 'AUDIO' }))).toBe(false);
});

it('canonical tuple identity keeps delimiters and escaping unambiguous and admits only real targets', () => {
  expect(createPracticePreparationKey('a:b', 'c', choices).value).not.toBe(createPracticePreparationKey('a', 'b:c', choices).value);
  expect(() => createPracticePreparationKey('', 'revision', choices)).toThrow();
  expect(() => createPracticePreparationKey('score', 'revision', { ...choices, mode: 'STEP_BY_STEP', recordingMode: 'AUDIO' })).toThrow();
});
