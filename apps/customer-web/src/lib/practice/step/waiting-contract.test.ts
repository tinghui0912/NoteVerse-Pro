import { stepPracticePlan } from '@/lib/practice/__fixtures__/practice-plan';
import {expect, expectTypeOf, it} from 'vitest';
import type { StepPracticeSessionSnapshot, StepRuntimeStatus } from '@/lib/practice/step/domain/session';
import type { ContinuousPracticeSessionSnapshot } from '@/lib/practice/continuous/domain/session';
import type {StepControllerState} from './step-practice-controller';
import { StepPracticeSession } from '@/lib/practice/step/domain/practice-session';
import { ManualClock } from '@/lib/practice/session/timebase';
import fixture from '@/lib/practice/__fixtures__/canonical-practice-score-artifact.json';
import type { PracticeScoreArtifact } from '@/lib/practice/score/artifact';

it('controller and domain statuses are distinct; STEP runtime cannot represent application states or PAUSED', () => {
  expectTypeOf<StepControllerState>().toEqualTypeOf<'IDLE'|'PREPARING'|'ACTIVE'|'ENDED'|'DISPOSED'>();
  expectTypeOf<StepRuntimeStatus>().toEqualTypeOf<'ACTIVE'|'ENDED'>();
  expectTypeOf<StepPracticeSessionSnapshot['runtimeStatus']>().toEqualTypeOf<StepRuntimeStatus>();
  expectTypeOf<StepPracticeSession['state']>().toEqualTypeOf<StepRuntimeStatus>();
  expectTypeOf<Extract<StepRuntimeStatus, 'IDLE'|'PREPARING'|'DISPOSED'|'PAUSED'>>().toEqualTypeOf<never>();
  expectTypeOf<Extract<keyof StepPracticeSessionSnapshot, 'lifecycleState'>>().toEqualTypeOf<never>();
  expectTypeOf<ContinuousPracticeSessionSnapshot['lifecycleState']>().toEqualTypeOf<'READY'|'ACTIVE'|'PAUSED'|'ENDED'>();
});
it.each(['MATCH','MISMATCH'] as const)('%s retires physical input beyond the completed analysis frontier', verdict => {
  const clock=new ManualClock(100),domainId='capture-watermark',time=(ms:number)=>({domainId,ms});
  const runtime=new StepPracticeSession({ plan: stepPracticePlan(fixture as PracticeScoreArtifact, { scope: {kind:'FULL'}, inputSource: 'MICROPHONE' }), clock, localSessionId:domainId });
  const old=runtime.openAttempt(time(200))!; runtime.analyzeAttempt(old);
  // Analysis covered only through 600, but physical capture continued through 1000.
  clock.set(1000);
  const result=runtime.completeAttempt(old,{ observedAttackKeys: [verdict === 'MATCH' ? 60 : 62],
    confidence:1,captureEndSessionTime:time(235)});
  expect(result).toMatchObject({ kind: 'FINALIZED', record: { verdict } });
  expect(result.kind).toBe('FINALIZED');
  runtime.rearm(time(1000));
  for(const ms of [235,600,800,1000]) expect(runtime.openAttempt(time(ms))).toBeNull();
  expect(runtime.completeAttempt(old,{observedAttackKeys:[60],confidence:1,captureEndSessionTime:time(235)}).kind).toBe('REJECTED');
  expect(runtime.openAttempt(time(1001))).not.toBeNull();
  expect(runtime.snapshot().step.pendingPostVerdict).toBeNull();
});
