import { expect, it } from 'vitest';
import { stepApplicationError } from './step-errors';
import { StepDomainError } from './domain/attempt';

it.each(['MIDI', 'MICROPHONE'] as const)('%s target incompatibility belongs to the score, in either application phase', source => {
  for (const phase of ['PREPARING', 'ACTIVE'] as const) {
    expect(stepApplicationError(new StepDomainError('STEP_TARGET_INVALID'), source, phase)).toBe('STEP_SCORE_UNAVAILABLE');
  }
});

it.each(['MICROPHONE_SOURCE_LOST', 'STEP_MICROPHONE_CONTEXT_INTERRUPTED', 'CAPTURE_PIPELINE_FAILED',
  'CAPTURE_CHRONOLOGY_VIOLATION', 'CAPTURE_CONTEXT_FRAME_GAP', 'STEP_MICROPHONE_SOURCE_MAPPING_INVALID',
  'NONCHRONOLOGICAL_ACOUSTIC_SOURCE', 'INVALID_ACOUSTIC_CAPTURE_BLOCK'])('%s belongs to microphone infrastructure', code => {
  expect(stepApplicationError(new Error(code), 'MICROPHONE', 'ACTIVE')).toBe('STEP_MICROPHONE_INFRASTRUCTURE_FAILED');
});
it('keeps analysis, temporary mute and preparation failures distinct', () => {
  expect(stepApplicationError(new Error('WORKER_CRASH'), 'MICROPHONE', 'ACTIVE')).toBe('STEP_ACOUSTIC_RUNTIME_FAILED');
  expect(stepApplicationError(new Error('STEP_MICROPHONE_INTERRUPTED'), 'MICROPHONE', 'ACTIVE')).toBe('STEP_MICROPHONE_INTERRUPTED');
  expect(stepApplicationError(new Error('MODEL_UNAVAILABLE'), 'MICROPHONE', 'PREPARING')).toBe('STEP_ACOUSTIC_PREPARATION_FAILED');
});
