import { expect, it } from 'vitest';
import { continuousTimingProvenance, assertContinuousTimingProvenance } from './timing-provenance';

it.each(['MIDI', 'MICROPHONE'] as const)('%s declares source mapping without claiming measured calibration', input => {
  const value = continuousTimingProvenance(input);
  expect(value).toEqual({ eventTimeMappingPolicyId: input === 'MIDI' ? 'MIDI_EVENT_TIMESTAMP_TO_PERFORMANCE_TIME_V1'
    : 'ACOUSTIC_SOURCE_EVENT_SAMPLE_TO_PERFORMANCE_TIME_V1', calibrationPolicyId: 'CONTINUOUS_NO_INPUT_TIMING_CALIBRATION_V1', calibrationApplied: false });
  expect(Object.isFrozen(value)).toBe(true);
  expect(() => assertContinuousTimingProvenance(JSON.parse(JSON.stringify(value)), input)).not.toThrow();
  for (const patch of [{ calibrationApplied: true }, { calibrationPolicyId: 'MEASURED_ZERO' },
    { eventTimeMappingPolicyId: 'OTHER_MAPPING' }, { offsetMs: 0 }]) {
    expect(() => assertContinuousTimingProvenance({ ...value, ...patch } as typeof value, input)).toThrow();
  }
});
