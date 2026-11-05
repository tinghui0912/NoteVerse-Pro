import { expect, it } from 'vitest';
import fixture from '@/lib/practice/__fixtures__/canonical-practice-score-artifact.json';
import { canonicalContinuousResultFixture } from '@/lib/practice/__fixtures__/continuous-result';
import { parsePracticeScoreArtifact } from '@/lib/practice/kernel/artifact';
import { resolvePracticeScope } from '@/lib/practice/kernel/scope';
import { createTransientReviewSession } from './transient-review-session';
import { resolveReviewScoreState } from './review-score-state';
const artifact=parsePracticeScoreArtifact(fixture),result=canonicalContinuousResultFixture();
const source={sourceId:result.sourceId,artifact,musicXml:'<score />'};
it('projects FULL cursor scope while preserving completed evaluation',()=>{
  const session=createTransientReviewSession({result,recording:{status:'NOT_RECORDED'}},source);
  expect(resolveReviewScoreState(session)).toEqual({status:'READY',scope:{kind:'FULL',startTick:result.scope.startTick,terminalTick:result.scope.terminalTick}});
  expect(session.result.evaluation).toBe(result.evaluation);
});
it('projects RANGE note references from the admitted artifact',()=>{
  const scope=resolvePracticeScope(artifact,{kind:'RANGE',startGroupId:artifact.moments[1].groupId,endGroupId:artifact.moments[2].groupId});
  const session=createTransientReviewSession({result:{...result,scope},recording:{status:'NOT_RECORDED'}},source);
  expect(resolveReviewScoreState(session)).toMatchObject({status:'READY',scope:{kind:'RANGE',startTick:scope.startTick,terminalTick:scope.terminalTick}});
});
it('fails closed when a scope cannot project canonical notation references',()=>{
  const scope={...result.scope,kind:'RANGE' as const,startIndex:500,endIndex:501,startGroupId:'missing',endGroupId:'missing'};
  const session=createTransientReviewSession({result:{...result,scope},recording:{status:'NOT_RECORDED'}},source);
  expect(resolveReviewScoreState(session)).toMatchObject({status:'SCOPE_INVALID'});
});
