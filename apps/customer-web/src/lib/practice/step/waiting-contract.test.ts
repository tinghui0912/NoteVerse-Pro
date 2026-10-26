import {expect, expectTypeOf, it} from 'vitest';
import type { LocalStepSessionSnapshot, StepRuntimeStatus } from '@/lib/practice/step/domain/session';
import type { LocalPerformanceSessionSnapshot } from '@/lib/practice/continuous/domain/session';
import type {StepControllerState} from './step-practice-controller';
import { StepPracticeRuntime } from '@/lib/practice/step/domain/runtime';
import { ManualClock } from '@/lib/practice/kernel/timebase';
import fixture from '@/lib/practice/__fixtures__/canonical-practice-score-artifact.json';
import type { PracticeScoreArtifact } from '@/lib/practice/kernel/artifact';

it('controller and domain statuses are distinct; STEP runtime cannot represent application states or PAUSED', () => {
  expectTypeOf<StepControllerState>().toEqualTypeOf<'IDLE'|'PREPARING'|'ACTIVE'|'ENDED'|'DISPOSED'>();
  expectTypeOf<StepRuntimeStatus>().toEqualTypeOf<'ACTIVE'|'ENDED'>();
  expectTypeOf<LocalStepSessionSnapshot['runtimeStatus']>().toEqualTypeOf<StepRuntimeStatus>();
  expectTypeOf<StepPracticeRuntime['state']>().toEqualTypeOf<StepRuntimeStatus>();
  expectTypeOf<Extract<StepRuntimeStatus, 'IDLE'|'PREPARING'|'DISPOSED'|'PAUSED'>>().toEqualTypeOf<never>();
  expectTypeOf<Extract<keyof LocalStepSessionSnapshot, 'lifecycleState'>>().toEqualTypeOf<never>();
  expectTypeOf<LocalPerformanceSessionSnapshot['lifecycleState']>().toEqualTypeOf<'READY'|'ACTIVE'|'PAUSED'|'ENDED'>();
});
it.each(['MATCH','MISMATCH','RETRY'] as const)('%s retires physical input beyond the completed analysis frontier', verdict => {
  const clock=new ManualClock(100),domainId='capture-watermark',time=(ms:number)=>({domainId,ms});
  const runtime=new StepPracticeRuntime({artifact:fixture as PracticeScoreArtifact,scope:{kind:'FULL'},clock,localSessionId:domainId,inputSource:'MICROPHONE'});
  const old=runtime.openAttempt(time(200))!; runtime.analyzeAttempt(old);
  // Analysis covered only through 600, but physical capture continued through 1000.
  clock.set(1000);
  const result=runtime.completeAttempt(old,{ observedAttackPitches: verdict === 'RETRY' ? ['C4','G4'] : [verdict === 'MATCH' ? 'C4' : 'D4'],
    confidence:1,captureEndSessionTime:time(235)});
  expect(result).toMatchObject({ kind: 'FINALIZED', record: { verdict } });
  expect(result.kind).toBe('FINALIZED');
  runtime.rearm(time(1000));
  for(const ms of [235,600,800,1000]) expect(runtime.openAttempt(time(ms))).toBeNull();
  expect(runtime.completeAttempt(old,{observedAttackPitches:['C4'],confidence:1,captureEndSessionTime:time(235)}).kind).toBe('REJECTED');
  expect(runtime.openAttempt(time(1001))).not.toBeNull();
  expect(runtime.snapshot().step.attempts).toHaveLength(1);
});
