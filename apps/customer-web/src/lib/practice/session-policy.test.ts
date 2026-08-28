import { describe, expect, it } from 'vitest';
import { practicePolicyForPreset } from './session-policy';

describe('practicePolicyForPreset', () => {
  it('maps step-by-step practice to the Wait For Note learning preset', () => {
    expect(practicePolicyForPreset('STEP_BY_STEP')).toEqual({
      progression_mode: 'WAIT_FOR_NOTE',
      realtime_guidance: 'GUIDED',
      evaluation_profile: 'LEARNING',
      input_source: 'MICROPHONE',
    });
  });

  it('maps step-by-step MIDI practice to the Wait For Note learning preset', () => {
    expect(practicePolicyForPreset('STEP_BY_STEP', 'MIDI')).toEqual({
      progression_mode: 'WAIT_FOR_NOTE',
      realtime_guidance: 'GUIDED',
      evaluation_profile: 'LEARNING',
      input_source: 'MIDI',
    });
  });

  it('maps continuous performance to continuous status-only performance', () => {
    expect(practicePolicyForPreset('CONTINUOUS_PLAY')).toEqual({
      progression_mode: 'CONTINUOUS',
      realtime_guidance: 'STATUS_ONLY',
      evaluation_profile: 'PERFORMANCE',
      input_source: 'MICROPHONE',
    });
  });
});
