import { CONTINUOUS_ASSIGNMENT_POLICY_ID, CONTINUOUS_ASSIGNMENT_WINDOW_MS } from '@/lib/practice/continuous/domain/evaluation/finalization-policy';

/** Read-only research manifest: no second copy of the product window or policy identity. */
export const productionPolicy = Object.freeze({
  productionPolicyIdentity: CONTINUOUS_ASSIGNMENT_POLICY_ID,
  assignmentWindowMs: CONTINUOUS_ASSIGNMENT_WINDOW_MS,
  cohortOverlapThresholdMs: 2 * CONTINUOUS_ASSIGNMENT_WINDOW_MS,
});
