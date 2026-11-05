import type { PracticeInputSource } from '@/lib/practice/planning/intent';

const CONTINUOUS_TIMING_CALIBRATION_POLICY_ID = 'CONTINUOUS_NO_INPUT_TIMING_CALIBRATION_V1';
const MIDI_EVENT_TIME_MAPPING_POLICY_ID = 'MIDI_EVENT_TIMESTAMP_TO_PERFORMANCE_TIME_V1';
const ACOUSTIC_EVENT_TIME_MAPPING_POLICY_ID = 'ACOUSTIC_SOURCE_EVENT_SAMPLE_TO_PERFORMANCE_TIME_V1';

/** No measured latency or offset is claimed. Event mapping precedes source-blind assignment. */
export type ContinuousTimingProvenance = Readonly<{
  eventTimeMappingPolicyId: typeof MIDI_EVENT_TIME_MAPPING_POLICY_ID | typeof ACOUSTIC_EVENT_TIME_MAPPING_POLICY_ID;
  calibrationPolicyId: typeof CONTINUOUS_TIMING_CALIBRATION_POLICY_ID;
  calibrationApplied: false;
}>;

export function continuousTimingProvenance(inputSource: PracticeInputSource): ContinuousTimingProvenance {
  return Object.freeze({ eventTimeMappingPolicyId: inputSource === 'MIDI' ? MIDI_EVENT_TIME_MAPPING_POLICY_ID : ACOUSTIC_EVENT_TIME_MAPPING_POLICY_ID,
    calibrationPolicyId: CONTINUOUS_TIMING_CALIBRATION_POLICY_ID, calibrationApplied: false });
}

export function assertContinuousTimingProvenance(value: ContinuousTimingProvenance, inputSource: PracticeInputSource): void {
  const expected = continuousTimingProvenance(inputSource);
  if (!value || Object.keys(value).sort().join() !== Object.keys(expected).sort().join()
    || value.eventTimeMappingPolicyId !== expected.eventTimeMappingPolicyId
    || value.calibrationPolicyId !== expected.calibrationPolicyId || value.calibrationApplied !== false) {
    throw new Error('Continuous timing provenance is corrupt.');
  }
}
