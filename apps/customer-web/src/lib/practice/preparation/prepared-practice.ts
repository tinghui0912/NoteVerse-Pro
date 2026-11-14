import type { PracticeResourceBinding } from '@/lib/practice/device/practice-resource-binding';
import type { AdmittedPracticeBundle } from '@/lib/practice/bundle/admitted-practice-bundle';
import type { PracticePreparationKey } from './preparation-key';

export type PreparedPractice = Readonly<{
  key: PracticePreparationKey;
  bundle: AdmittedPracticeBundle;
  binding: PracticeResourceBinding;
}>;
