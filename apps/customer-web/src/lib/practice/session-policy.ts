import type {
  CreatePracticeSessionRequest,
  PracticeInputSource,
  PracticeSessionPreset,
} from '@/generated/practice-api';

export type PracticeSessionMode = PracticeSessionPreset;

export function practiceSessionIntent(
  preset: PracticeSessionMode = 'STEP_BY_STEP',
  inputSource: PracticeInputSource = 'MICROPHONE'
): Pick<
  CreatePracticeSessionRequest,
  'preset' | 'input_source'
> {
  return {
    preset,
    input_source: inputSource,
  };
}
