import type { PracticeResourceBinding } from '@/lib/practice/device/practice-resource-binding';
import type { PracticeConfiguration } from '@/lib/practice/configuration/preferences';

export type PracticePreparationAdmission = Readonly<{
  source: Readonly<{ sourceId: string; scoreId: string; revisionId: string; artifactId: string }>;
  configuration: Readonly<Pick<PracticeConfiguration, 'mode' | 'inputSource' | 'recordingMode'>>;
}>;

export type PreparedPractice = Readonly<{
  admission: PracticePreparationAdmission;
  binding: PracticeResourceBinding;
}>;

export function matchesPreparationConfiguration(admission: PracticePreparationAdmission, configuration: PracticeConfiguration | null): boolean {
  return configuration !== null && admission.configuration.mode === configuration.mode
    && admission.configuration.inputSource === configuration.inputSource
    && admission.configuration.recordingMode === configuration.recordingMode;
}
