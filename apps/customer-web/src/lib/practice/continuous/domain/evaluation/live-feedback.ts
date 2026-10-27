import type { PracticeInputSource } from '@/lib/practice/kernel/session';
import type { ContinuousTargetStateGroup } from './assignment-types';
import type { ContinuousInterpretationPolicyId } from './interpretation-types';
import { CONTINUOUS_ASSIGNMENT_POLICY_ID } from './finalization-policy';
import { interpretContinuousTargetState, interpretationPolicyForInputSource } from './interpretation';
import { immutableContinuousValue } from './immutable-value';

export type ContinuousLiveFeedback = Readonly<{
  inputSource: PracticeInputSource;
  assignmentPolicyId: typeof CONTINUOUS_ASSIGNMENT_POLICY_ID;
  interpretationPolicyId: ContinuousInterpretationPolicyId;
  groups: readonly Readonly<{
    groupId: string;
    strikes: readonly Readonly<{ strikeId: string; renderNoteIds: readonly string[]; state: 'CORRECT' | 'MISSING' | 'SUPPORTED' | 'NOT_DETECTED' }>[];
  }>[];
}>;

/** Consumer projection of the same group interpretation used by completed evaluation. */
export function projectContinuousLiveFeedback(groups: readonly ContinuousTargetStateGroup[], inputSource: PracticeInputSource): ContinuousLiveFeedback {
  return immutableContinuousValue({ inputSource, assignmentPolicyId: CONTINUOUS_ASSIGNMENT_POLICY_ID,
    interpretationPolicyId: interpretationPolicyForInputSource(inputSource),
    groups: groups.map(group => ({ groupId: group.groupId,
      strikes: group.strikes.flatMap(strike => {
        const state = interpretContinuousTargetState(strike.state, inputSource);
        return state === 'PENDING' || state === 'NOT_REACHED' ? [] : [{ strikeId: strike.strikeId, renderNoteIds: strike.renderNoteIds, state }];
      }),
    })).filter(group => group.strikes.length > 0),
  });
}
