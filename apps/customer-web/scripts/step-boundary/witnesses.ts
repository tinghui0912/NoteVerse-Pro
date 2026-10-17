import assert from 'node:assert/strict';
import fixture from '../../src/lib/practice/local-core/__fixtures__/canonical-practice-score-artifact.json';
import type { PracticeScoreArtifact } from '../../src/lib/practice/local-core/artifact';
import { StepPracticeRuntime } from '../../src/lib/practice/local-core/step-runtime';
import { ManualClock } from '../../src/lib/practice/local-core/timebase';
import { StepMidiAttemptInput } from '../../src/lib/practice/step/step-midi-attempt-input';

type Verdict = 'MATCH' | 'MISMATCH' | 'RETRY';
const artifact = fixture as PracticeScoreArtifact;
function harness(verdict: Verdict = 'MATCH', chord = false) {
  const clock = new ManualClock(100), session = 'exclusive-boundary', callbacks: (() => void)[] = [];
  const runtime = new StepPracticeRuntime({ artifact, clock, localSessionId: session, inputSource: 'MIDI',
    scope: chord ? { kind:'RANGE',startGroupId:artifact.expectedPracticeGroups[3].groupId,endGroupId:artifact.expectedPracticeGroups[4].groupId } : {kind:'FULL'} });
  let closed = 0;
  const input = new StepMidiAttemptInput({ open: time => runtime.openAttempt(time),
    complete: (identity,evidence) => {
      assert.equal(runtime.analyzeAttempt(identity),true);
      const result = runtime.completeAttempt(identity, verdict === 'RETRY' && closed++ === 0
        ? {kind:'RETRY',reason:'UNCERTAIN',captureEndSessionTime:evidence.captureEndSessionTime} : evidence);
      assert.equal(result.kind,'FINALIZED'); runtime.rearm(evidence.captureEndSessionTime);
    }, failure: error => { throw error; },
  }, {schedule: (callback,delay) => { assert.equal(delay,35); callbacks.push(callback); return callback; },cancel: () => {}});
  const time = (ms: number) => ({domainId:session,ms});
  const note = (ms: number,pitch = 'C4') => input.note({type:'NOTE_ON',noteNumber:60,pitch,velocity:80,sessionTime:time(ms)});
  const close = (at: number) => {clock.set(at); callbacks.at(-1)!();};
  const state = () => runtime.snapshot().step;
  return {runtime,input,clock,time,note,close,state,callbacks};
}
export function raceWitness(verdict: Verdict, order: 'BEFORE' | 'AFTER') {
  const h = harness(verdict);
  assert.equal(h.runtime.openAttempt(h.time(100)),null);
  h.note(200,verdict === 'MISMATCH' ? 'D4' : 'C4');
  const first = h.state().activeAttempt!; assert.ok(first);
  if(order === 'BEFORE') h.note(235);
  h.close(235);
  if(order === 'AFTER') h.note(235);
  assert.equal(h.state().activeAttempt,null); assert.equal(h.callbacks.length,1);
  assert.equal(h.state().attempts.length,1); assert.equal(h.state().attempts[0].verdict,verdict);
  const beforeLater = h.state();
  h.note(236); const later = h.state().activeAttempt!;
  assert.ok(later); assert.notEqual(later.attemptId,first.attemptId);
  assert.equal(later.attemptStartSessionTime.ms,236);
  assert.equal(later.activationGeneration,first.activationGeneration+(verdict === 'MATCH' ? 1 : 0));
  return {name:order === 'BEFORE' ? 'exact-boundary-before-close ignored' : 'exact-boundary-after-close ignored',
    verdict,order,status:'PASS',firstAttempt:first,captureEnd:235,afterBoundary:beforeLater,
    laterWitness:`strictly-later-after-${verdict} accepted`,laterAttempt:later};
}
export function lifecycleWitnesses() {
  const h = harness(); h.note(200); const old = h.state().activeAttempt!;
  h.input.cancel(); h.runtime.pause(); h.clock.set(300); h.runtime.resume();
  const target = h.runtime.currentTarget()!;
  h.note(300); assert.equal(h.state().activeAttempt,null);
  h.note(301); const resumed = h.state().activeAttempt!;
  assert.ok(resumed); assert.ok(resumed.activationGeneration>old.activationGeneration);
  h.input.cancel(); h.clock.set(350); h.runtime.skip();
  const skipped = h.state(); h.note(350); assert.equal(h.state().activeAttempt,null);
  for(const callback of h.callbacks) callback(); assert.equal(h.state().attempts.length,0);
  const late = h.runtime.completeAttempt(old,{kind:'EVIDENCE',observedAttackPitches:['C4'],confidence:1,captureEndSessionTime:h.time(235)});
  assert.equal(late.kind,'REJECTED');
  h.note(351); const afterSkip = h.state().activeAttempt!; assert.ok(afterSkip);
  assert.equal(afterSkip.activationGeneration,skipped.activationGeneration);
  return [{name:'resume-boundary equality rejected',status:'PASS',previousAttempt:old,resumeBoundary:target.activationBoundary,resumedAttempt:resumed},
    {name:'skip invalidates active attempt',status:'PASS',invalidatedAttempt:resumed,skippedState:skipped,laterAttempt:afterSkip},
    {name:'stale timer cannot create verdict',status:'PASS',attemptsAfterStaleTimers:0},
    {name:'late prior identity rejected',status:'PASS',oldAttempt:old,result:late}];
}
export function accumulationWitness() {
  const h=harness('MISMATCH',true);
  h.note(200,'A4');h.close(235);h.note(236,'C5');h.close(271);
  assert.deepEqual(h.state().attempts.map(r=>r.verdict),['MISMATCH','MISMATCH']);
  assert.equal(h.state().currentIndex,3);
  return {name:'no cross-target accumulation',status:'PASS',attempts:h.state().attempts,currentIndex:h.state().currentIndex};
}
export function runBoundaryWitnesses() {
  const races = (['MATCH','MISMATCH','RETRY'] as const).flatMap(verdict=>{
    const before=raceWitness(verdict,'BEFORE'),after=raceWitness(verdict,'AFTER');
    assert.deepEqual(before.afterBoundary,after.afterBoundary);
    assert.deepEqual(before.laterAttempt,after.laterAttempt);
    return [before,after];
  });
  return {status:'PASS',races,lifecycle:lifecycleWitnesses(),accumulation:accumulationWitness()};
}
