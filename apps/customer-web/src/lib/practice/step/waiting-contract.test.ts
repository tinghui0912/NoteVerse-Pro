import {expect, expectTypeOf, it} from 'vitest';
import type {LocalStepSessionSnapshot, LocalPerformanceSessionSnapshot} from '../local-core/session';
import {StepPracticeRuntime} from '../local-core/step-runtime';
import {ManualClock} from '../local-core/timebase';
import fixture from '../local-core/__fixtures__/canonical-practice-score-artifact.json';
import type {PracticeScoreArtifact} from '../local-core/artifact';

it('snapshot typing cannot represent paused STEP; Continuous retains it', () => {
  expectTypeOf<LocalStepSessionSnapshot['lifecycleState']>().toEqualTypeOf<'IDLE'|'PREPARING'|'ACTIVE'|'ENDED'|'DISPOSED'>();
  expectTypeOf<LocalPerformanceSessionSnapshot['lifecycleState']>().toEqualTypeOf<'READY'|'ACTIVE'|'PAUSED'|'ENDED'>();
});
it.each(['MATCH','MISMATCH','RETRY'] as const)('%s retires physical input beyond the completed analysis frontier', verdict => {
  const clock=new ManualClock(100),domainId='capture-watermark',time=(ms:number)=>({domainId,ms});
  const runtime=new StepPracticeRuntime({artifact:fixture as PracticeScoreArtifact,scope:{kind:'FULL'},clock,localSessionId:domainId,inputSource:'MICROPHONE'});
  const old=runtime.openAttempt(time(200))!; runtime.analyzeAttempt(old);
  // Analysis covered only through 600, but physical capture continued through 1000.
  clock.set(1000);
  const result=runtime.completeAttempt(old,verdict==='RETRY'
    ? {kind:'RETRY',reason:'UNCERTAIN',captureEndSessionTime:time(235)}
    : {kind:'EVIDENCE',observedAttackPitches:[verdict==='MATCH'?'C4':'D4'],confidence:1,captureEndSessionTime:time(235)});
  expect(result.kind).toBe('FINALIZED');
  runtime.rearm(time(1000));
  for(const ms of [235,600,800,1000]) expect(runtime.openAttempt(time(ms))).toBeNull();
  expect(runtime.completeAttempt(old,{kind:'RETRY',reason:'UNCERTAIN',captureEndSessionTime:time(235)}).kind).toBe('REJECTED');
  expect(runtime.openAttempt(time(1001))).not.toBeNull();
  expect(runtime.snapshot().step.attempts).toHaveLength(1);
});
