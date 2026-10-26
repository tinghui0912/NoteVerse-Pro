import { describe, expect, it } from 'vitest';
import { emptyPracticePreferences as empty, resolvePracticeConfiguration } from './preferences';
import { parsePracticePreferences, readPracticePreferences, writePracticePreferences, PRACTICE_PREFERENCES_KEY } from './preference-storage';

describe('Practice intent', () => {
  it('requires explicit first-use mode and input, with feedback safely off', () => {
    expect(resolvePracticeConfiguration(empty)).toEqual({ status: 'INCOMPLETE', missing: ['MODE', 'INPUT_SOURCE'] });
    expect(empty.continuous).toEqual({ recordingMode: null, liveFeedbackEnabled: false });
  });
  it.each(['MICROPHONE', 'MIDI'] as const)('STEP %s needs no recording selection', inputSource => {
    expect(resolvePracticeConfiguration({ ...empty, mode: 'STEP_BY_STEP', inputSource })).toEqual({ status: 'COMPLETE',
      configuration: { mode: 'STEP_BY_STEP', inputSource, recordingMode: 'OFF', liveFeedbackEnabled: false } });
  });
  it('Continuous requires recording intent including an explicit OFF', () => {
    expect(resolvePracticeConfiguration({ ...empty, mode: 'CONTINUOUS_PLAY', inputSource: 'MIDI' })).toEqual({
      status: 'INCOMPLETE', missing: ['CONTINUOUS_RECORDING_MODE'],
    });
  });
  it.each(['OFF', 'AUDIO', 'VIDEO'] as const)('accepts explicit Continuous %s', recordingMode => {
    expect(resolvePracticeConfiguration({ ...empty, mode: 'CONTINUOUS_PLAY', inputSource: 'MIDI',
      continuous: { recordingMode, liveFeedbackEnabled: true } })).toMatchObject({ status: 'COMPLETE', configuration: { recordingMode } });
  });
});
describe('Exact preference storage', () => {
  it('round-trips complete and partial intent without runtime/result fields', () => {
    const storage = { value: '', getItem: () => storage.value, setItem: (key: string, value: string) => {
      expect(key).toBe(PRACTICE_PREFERENCES_KEY); storage.value = value;
    } };
    for (const profile of [empty, { ...empty, mode: 'STEP_BY_STEP' as const }]) {
      writePracticePreferences(storage, profile);
      expect(readPracticePreferences(storage)).toEqual(profile);
      expect(Object.keys(JSON.parse(storage.value)).sort()).toEqual(['continuous', 'inputSource', 'mode', 'schemaVersion']);
    }
  });
  it.each(['{', 'null', JSON.stringify({ ...empty, schemaVersion: 2 }), JSON.stringify({ ...empty, inputSource: 'OTHER' }),
    JSON.stringify({ ...empty, result: {} }), JSON.stringify({ ...empty, continuous: { recordingMode: 'OTHER', liveFeedbackEnabled: false } }),
    JSON.stringify({ ...empty, continuous: { recordingMode: 'OFF', liveFeedbackEnabled: 'false' } })])('rejects corrupt/unknown/non-exact data %s', raw => {
    expect(parsePracticePreferences(raw)).toEqual(empty);
  });
});
