import { expect, it } from 'vitest';
import { runEvaluationScale } from './workload';
import { assertCompletedAssignment } from '@/lib/practice/continuous/domain/evaluation/assignment-projection';

it.each([100, 500, 1000, 5000])('production finalizes %i physical strikes and retains every accepted fact exactly once', size => {
  const result = runEvaluationScale(size), assignment = result.assignment;
  expect(result.assignment).toEqual(runEvaluationScale(size).assignment);
  expect(assignment.observationAssignments.every(relation => ['STRIKE_MATCH','UNATTRIBUTED'].includes(relation.kind))).toBe(true);
  expect(result.completedStatus).toBe('COMPLETE'); expect(result.publicationCount).toBeGreaterThan(1);
  expect(assignment.observations).toHaveLength(size); expect(assignment.observationAssignments).toHaveLength(size);
  expect(new Set(assignment.observationAssignments.map(r => r.observationId)).size).toBe(size);
  expect(assignment.groups.every(g => g.state === 'FINALIZED' && g.strikes.every(s => s.state !== ('PENDING' as string)))).toBe(true);
  expect(result.assignmentCounts).toEqual({ strikes: size, matched: size * .6, unattributed: size * .4 });
  expect(Object.isFrozen(assignment.observations)).toBe(true); expect(assignment.observations.every(Object.isFrozen)).toBe(true);
  assertCompletedAssignment(JSON.parse(JSON.stringify(assignment)));
});
