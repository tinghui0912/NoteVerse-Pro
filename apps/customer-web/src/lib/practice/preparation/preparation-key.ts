import type { PracticeConfiguration } from '@/lib/practice/configuration/preferences';
import { planPracticeResources } from '@/lib/practice/planning/resource-plan';

declare const preparationKey: unique symbol;

/** Browser preparation identity, independent of candidate musical/presentation choices. */
export type PracticePreparationKey = Readonly<
  Pick<PracticeConfiguration, 'mode' | 'inputSource' | 'recordingMode'> & {
    scoreId: string;
    revisionId: string;
    value: string;
    [preparationKey]: true;
  }
>;

export function createPracticePreparationKey(
  scoreId: string,
  revisionId: string,
  configuration: Pick<PracticeConfiguration, 'mode' | 'inputSource' | 'recordingMode'>,
): PracticePreparationKey {
  if (typeof scoreId !== 'string' || !scoreId || typeof revisionId !== 'string' || !revisionId) throw new Error('Practice score and revision identity required.');
  planPracticeResources(configuration); // Admit the resource-choice combination.
  const { mode, inputSource, recordingMode } = configuration;
  return Object.freeze({ scoreId, revisionId, mode, inputSource, recordingMode,
    value: JSON.stringify([scoreId, revisionId, mode, inputSource, recordingMode]),
  }) as PracticePreparationKey;
}

export function samePracticePreparationKey(
  a: PracticePreparationKey | null | undefined,
  b: PracticePreparationKey | null | undefined,
): boolean {
  return Boolean(a && b && a.value === b.value);
}

export function preparationKeyMatchesConfiguration(
  key: PracticePreparationKey,
  configuration: PracticeConfiguration | null,
): boolean {
  return configuration !== null && samePracticePreparationKey(key,
    createPracticePreparationKey(key.scoreId, key.revisionId, configuration));
}
