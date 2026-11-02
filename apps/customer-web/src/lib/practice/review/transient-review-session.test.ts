import { expect, it } from 'vitest';
import type { PracticeScoreArtifact } from '@/lib/practice/kernel/artifact';
import fixture from '@/lib/practice/__fixtures__/canonical-practice-score-artifact.json';
import { canonicalContinuousResultFixture } from '@/lib/practice/__fixtures__/continuous-result';
import { createPerformanceRecording } from '@/lib/practice/recording/recording-artifact';
import { createTransientReviewSession } from './transient-review-session';
const artifact=fixture as PracticeScoreArtifact;
const source={sourceId:'source-fixture',artifact,musicXml:'<score />'};
it('hands off canonical references without copying artifact, result or Blob bytes',()=>{
  const result=canonicalContinuousResultFixture(),blob=new Blob(['video'],{type:'video/webm'});
  const recording=createPerformanceRecording({status:'READY',kind:'VIDEO',blob,mimeType:'video/webm',durationMs:10000,
    timebase:{nominalMediaDurationMs:10000,activeSegments:[{perfStartMs:0,perfEndMs:10000,mediaStartMs:0,mediaEndMs:10000}]}});
  const session=createTransientReviewSession({result,recording},source);
  expect(session.result).toBe(result);expect(session.recording).toBe(recording);expect(session.artifact).toBe(artifact);
  expect(session.recording.status==='READY'&&session.recording.blob).toBe(blob);expect(Object.isFrozen(session)).toBe(true);
});
it.each(['sourceId','scoreId','revisionId','artifactId'] as const)('rejects %s mismatch before Review ownership begins',field=>{
  const result={...canonicalContinuousResultFixture(),[field]:'wrong'};
  expect(()=>createTransientReviewSession({result,recording:{status:'NOT_RECORDED'}},source)).toThrow();
});
it.each(['','   '])('requires admitted notation: %j',musicXml=>{
  expect(()=>createTransientReviewSession({result:canonicalContinuousResultFixture(),recording:{status:'NOT_RECORDED'}},{...source,musicXml})).toThrow();
});
it('validates result and recording contracts without partial handoff',()=>{
  const completion={result:canonicalContinuousResultFixture(),recording:{status:'NOT_RECORDED' as const}};
  expect(()=>createTransientReviewSession({...completion,result:{...completion.result,schemaVersion:99} as never},source)).toThrow();
  expect(()=>createTransientReviewSession({...completion,recording:{status:'READY'} as never},source)).toThrow();
});
