import { stepPracticePlan } from '@/lib/practice/__fixtures__/practice-plan';
import type { StepAttemptRecord } from '@/lib/practice/step/domain/attempt';
import assert from 'node:assert/strict';
import fixture from '@/lib/practice/__fixtures__/canonical-practice-score-artifact.json';
import type { PracticeScoreArtifact } from '@/lib/practice/score/artifact';
import { StepPracticeSession } from '@/lib/practice/step/domain/practice-session';
import { ManualClock } from '@/lib/practice/session/timebase';
import { StepMidiAttemptInput } from '../../src/lib/practice/step/step-midi-attempt-input';
import { parseMidiMessage } from '../../src/lib/practice/midi/browser-midi-controller';

type Verdict = 'MATCH' | 'MISMATCH';
const artifact = fixture as PracticeScoreArtifact;
function harness(chord = false) {
  const clock = new ManualClock(100), session = 'exclusive-boundary', callbacks: (() => void)[] = [];
  const runtime = new StepPracticeSession({ plan: stepPracticePlan(artifact, { scope: chord ? { kind:'RANGE',startGroupId:artifact.moments[3].groupId,endGroupId:artifact.moments[4].groupId } : {kind:'FULL'} }), clock, localSessionId: session });
  const finalized: StepAttemptRecord[] = [];
  const input = new StepMidiAttemptInput({ open: time => runtime.openAttempt(time),
    complete: (identity,evidence) => {
      assert.equal(runtime.analyzeAttempt(identity),true);
      const result = runtime.completeAttempt(identity, evidence);
      assert.equal(result.kind,'FINALIZED'); finalized.push(result.record); runtime.rearm(evidence.captureEndSessionTime);
    }, failure: error => { throw error; },
  }, {schedule: (callback,delay) => { assert.equal(delay,35); callbacks.push(callback); return callback; },cancel: () => {}});
  const time = (ms: number) => ({domainId:session,ms});
  const note = (ms: number,pianoKey = 60) => {
    const noteNumber = pianoKey;
    const parsed = parseMidiMessage(new Uint8Array([0x90,noteNumber,80]))!;
    input.note({...parsed,sessionTime:time(ms)});
  };
  const close = (at: number) => {clock.set(at); callbacks.at(-1)!();};
  const state = () => runtime.snapshot().step;
  return {finalized,runtime,input,clock,time,note,close,state,callbacks};
}
export function raceWitness(verdict: Verdict, order: 'BEFORE' | 'AFTER') {
  const h = harness();
  assert.equal(h.runtime.openAttempt(h.time(100)),null);
  h.note(200,verdict === 'MISMATCH' ? 62 : 60);
  const first = h.state().activeAttempt!; assert.ok(first);
  if(order === 'BEFORE') h.note(235);
  h.close(235);
  if(order === 'AFTER') h.note(235);
  assert.equal(h.state().activeAttempt,null); assert.equal(h.callbacks.length,1);
  assert.equal(h.finalized.length,1); assert.equal(h.finalized[0].verdict,verdict);
  const beforeLater = h.state();
  h.note(236); const later = h.state().activeAttempt!;
  assert.ok(later); assert.notEqual(later.attemptId,first.attemptId);
  assert.equal(later.attemptStartSessionTime.ms,236);
  assert.equal(later.targetGeneration,first.targetGeneration+(verdict === 'MATCH' ? 1 : 0));
  return {name:order === 'BEFORE' ? 'exact-boundary-before-close ignored' : 'exact-boundary-after-close ignored',
    verdict,order,status:'PASS',firstAttempt:first,captureEnd:235,afterBoundary:beforeLater,
    laterWitness:`strictly-later-after-${verdict} accepted`,laterAttempt:later};
}
export function lifecycleWitnesses() {
  const h = harness(); h.note(200); const old = h.state().activeAttempt!;
  h.input.cancel(); h.runtime.setInputUnavailable(); h.clock.set(300); h.runtime.acceptInputAfter(h.time(300));
  const target = h.runtime.currentTarget()!;
  h.note(300); assert.equal(h.state().activeAttempt,null);
  h.note(301); const resumed = h.state().activeAttempt!;
  assert.ok(resumed); assert.equal(resumed.targetGeneration,old.targetGeneration);
  h.clock.set(350); assert.equal(h.runtime.skip(),false);
  assert.equal(h.state().activeAttempt,resumed);
  // Skipping is only legal after unfinished input has been explicitly retired.
  h.input.cancel(); h.runtime.setInputUnavailable(); h.runtime.acceptInputAfter(h.time(350));
  assert.equal(h.runtime.skip(),true);
  const skipped = h.state(); h.note(350); assert.equal(h.state().activeAttempt,null);
  for(const callback of h.callbacks) callback(); assert.equal(h.finalized.length,0);
  const late = h.runtime.completeAttempt(old,{observedAttackKeys:[60],confidence:1,captureEndSessionTime:h.time(235)});
  assert.equal(late.kind,'REJECTED');
  h.note(351); const afterSkip = h.state().activeAttempt!; assert.ok(afterSkip);
  assert.equal(afterSkip.targetGeneration,skipped.targetGeneration);
  return [{name:'reconnect-boundary equality rejected',status:'PASS',previousAttempt:old,inputEligibleAfter:target.inputEligibleAfter,laterAttempt:resumed},
    {name:'skip rejected during capture; READY skip retires input',status:'PASS',invalidatedAttempt:resumed,skippedState:skipped,laterAttempt:afterSkip},
    {name:'stale timer cannot create verdict',status:'PASS',attemptsAfterStaleTimers:0},
    {name:'late prior identity rejected',status:'PASS',oldAttempt:old,result:late}];
}
export function accumulationWitness() {
  const h=harness(true);
  h.note(200,69);h.close(235);h.note(236,72);h.close(271);
  assert.deepEqual(h.finalized.map(r=>r.verdict),['MISMATCH','MISMATCH']);
  assert.equal(h.state().currentIndex,3);
  return {name:'no cross-target accumulation',status:'PASS',finalized:h.finalized,currentIndex:h.state().currentIndex};
}
