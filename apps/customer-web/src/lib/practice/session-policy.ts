import type { CreatePracticeSessionRequest, PracticeInputSource } from '@/generated/practice-api';

export type PracticeSessionPreset = 'STEP_BY_STEP' | 'CONTINUOUS_PLAY';

export function practicePolicyForPreset(
  preset: PracticeSessionPreset,
  inputSource: PracticeInputSource = 'MICROPHONE'
): Pick<
  CreatePracticeSessionRequest,
  'progression_mode' | 'realtime_guidance' | 'evaluation_profile' | 'input_source'
> {
  if (preset === 'STEP_BY_STEP') {
    return {
      progression_mode: 'WAIT_FOR_NOTE',
      realtime_guidance: 'GUIDED',
      evaluation_profile: 'LEARNING',
      input_source: inputSource,
    };
  }

  return {
    progression_mode: 'CONTINUOUS',
    realtime_guidance: 'STATUS_ONLY',
    evaluation_profile: 'PERFORMANCE',
    input_source: 'MICROPHONE',
  };
}
