import { describe, expect, it } from 'vitest';
import { accumulationWitness, lifecycleWitnesses, raceWitness } from '../../../../tests/helpers/exclusive-boundary-fixture';

describe('exclusive STEP activation boundary', () => {
  it.each(['MATCH','MISMATCH','RETRY'] as const)('%s is callback-order independent and accepts only strictly later input', verdict => {
    const before = raceWitness(verdict,'BEFORE'), after = raceWitness(verdict,'AFTER');
    expect(before.afterBoundary).toEqual(after.afterBoundary);
    expect(before.laterAttempt).toEqual(after.laterAttempt);
    expect(before.laterAttempt.attemptStartSessionTime.ms).toBe(236);
  });
  it('reconnect/skip boundaries reject equality; old identity and timer cannot act', () => {
    expect(lifecycleWitnesses().every(w=>w.status==='PASS')).toBe(true);
  });
  it('partial attempts cannot accumulate across attempt/target ownership', () => {
    expect(accumulationWitness().attempts.map(r=>r.verdict)).toEqual(['MISMATCH','MISMATCH']);
  });
});
