import type { PracticeInputSource } from '@/lib/practice/kernel/session';
import type { ContinuousGroupAssignment } from './assignment-types';
import type { ContinuousInterpretationPolicyId } from './interpretation-types';
import { CONTINUOUS_ASSIGNMENT_POLICY_ID } from './finalization-policy';
import { interpretContinuousGroup, interpretationPolicyForInputSource } from './interpretation';
import { immutableContinuousValue } from './immutable-value';

export type ContinuousLiveFeedback = Readonly<{
  inputSource: PracticeInputSource;
  assignmentPolicyId: typeof CONTINUOUS_ASSIGNMENT_POLICY_ID;
  interpretationPolicyId: ContinuousInterpretationPolicyId;
  groups: readonly Readonly<{
    groupId: string;
    strikes: readonly Readonly<{ strikeId: string; renderNoteIds: readonly string[]; state: 'CORRECT' | 'MISSING' | 'SUPPORTED' }>[];
  }>[];
}>;

/** Consumer projection of the same group interpretation used by completed evaluation. */
export function projectContinuousLiveFeedback(groups: readonly ContinuousGroupAssignment[], inputSource: PracticeInputSource): ContinuousLiveFeedback {
  return immutableContinuousValue({ inputSource, assignmentPolicyId: CONTINUOUS_ASSIGNMENT_POLICY_ID,
    interpretationPolicyId: interpretationPolicyForInputSource(inputSource),
    groups: groups.filter(group => group.state === 'FINALIZED').map(group => ({ groupId: group.groupId,
      strikes: interpretContinuousGroup(group, inputSource).strikes.flatMap(strike =>
        strike.state === 'CORRECT' || strike.state === 'MISSING' || strike.state === 'SUPPORTED'
          ? [{ strikeId: strike.strikeId, renderNoteIds: strike.renderNoteIds, state: strike.state }] : []),
    })),
  });
}
