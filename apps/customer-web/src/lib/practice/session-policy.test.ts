import { describe, expect, it } from 'vitest';
import { practiceSessionIntent } from './session-policy';

describe('practiceSessionIntent', () => {
  it('expresses step-by-step practice as product intent', () => {
    expect(practiceSessionIntent()).toEqual({
      preset: 'STEP_BY_STEP',
      input_source: 'MICROPHONE',
    });
  });

  it('keeps input source as the only client-selected runtime axis', () => {
    expect(practiceSessionIntent('STEP_BY_STEP', 'MIDI')).toEqual({
      preset: 'STEP_BY_STEP',
      input_source: 'MIDI',
    });
  });

  it('expresses continuous play without exposing internal runtime axes', () => {
    expect(practiceSessionIntent('CONTINUOUS_PLAY', 'MICROPHONE')).toEqual({
      preset: 'CONTINUOUS_PLAY',
      input_source: 'MICROPHONE',
    });
  });
});
