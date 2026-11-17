import { expect, it } from 'vitest';
import { practiceActivityRequestFromCompletion } from './completion-projection';
import { stepPracticePlan, continuousPracticePlan } from '@/lib/practice/__fixtures__/practice-plan';
import { StepPracticeSession } from '@/lib/practice/step/domain/practice-session';
import { completedContinuousSessionFixture, canonicalContinuousCompletionInputFixture } from '@/lib/practice/__fixtures__/continuous-result';
import { recordedPerformanceFixture } from '@/lib/practice/__fixtures__/recorded-performance';
import { ManualClock } from '@/lib/practice/session/timebase';
import artifactJson from '@/lib/practice/__fixtures__/canonical-practice-score-artifact.json';
import type { PracticeScoreArtifact } from '@/lib/practice/score/artifact';

const artifact = artifactJson as PracticeScoreArtifact;
it.each(['MIDI', 'MICROPHONE'] as const)('STEP full/range completion projects only the executed plan for %s', inputSource => {
  for (const scope of [{ kind: 'FULL' as const }, { kind: 'RANGE' as const, startGroupId: artifact.moments[0].groupId, endGroupId: artifact.moments[1].groupId }]) {
    const plan = stepPracticePlan(artifact, { scope, inputSource });
    const runtime = new StepPracticeSession({ plan, clock: new ManualClock(), localSessionId: 'actual-step-session' });
    expect(practiceActivityRequestFromCompletion(runtime.snapshot())).toBeNull();
    while (runtime.currentTarget()) expect(runtime.skip()).toBe(true);
    const snapshot = runtime.snapshot();
    expect(practiceActivityRequestFromCompletion(snapshot)).toEqual({
      client_session_id: snapshot.localSessionId,
      practice_binding: { score_id: plan.bundle.binding.scoreId, revision_id: plan.bundle.binding.revisionId, bundle_id: plan.bundle.binding.bundleId },
      mode: 'STEP_BY_STEP', input_source: inputSource,
      scope: { kind: plan.scope.kind, start_tick: plan.scope.startTick, terminal_tick: plan.scope.terminalTick },
    });
  }
});
it('manual End is not an Activity', () => {
  const runtime = new StepPracticeSession({ plan: stepPracticePlan(artifact), clock: new ManualClock() });
  runtime.skip(); runtime.end();
  expect(practiceActivityRequestFromCompletion(runtime.snapshot())).toBeNull();
});
it.each(['MIDI', 'MICROPHONE'] as const)('CONTINUOUS sends no evaluation or recording values for %s', inputSource => {
  const input = canonicalContinuousCompletionInputFixture(inputSource);
  const recording = recordedPerformanceFixture(input.session.plan).recording;
  const richSnapshot = { ...input.session, evaluation: input.evaluation, recording, assignment: { secret: true } };
  const body = practiceActivityRequestFromCompletion(richSnapshot)!;
  expect(body).toEqual({ client_session_id: input.session.localSessionId,
    practice_binding: { score_id: input.session.plan.bundle.binding.scoreId, revision_id: input.session.plan.bundle.binding.revisionId, bundle_id: input.session.plan.bundle.binding.bundleId },
    mode: 'CONTINUOUS_PLAY', input_source: inputSource,
    scope: { kind: input.session.plan.scope.kind, start_tick: input.session.plan.scope.startTick, terminal_tick: input.session.plan.scope.terminalTick } });
  expect(Object.keys(body).sort()).toEqual(['client_session_id', 'input_source', 'mode', 'practice_binding', 'scope']);
  expect(JSON.stringify(body)).not.toMatch(/evaluation|recording|assignment|confidence|duration|tempo|media/);
  recording.media.release();
});
it('CONTINUOUS stopped sessions do not project an Activity', () => {
  const snapshot = completedContinuousSessionFixture(continuousPracticePlan(artifact));
  expect(practiceActivityRequestFromCompletion({ ...snapshot, completionReason: 'STOPPED_BY_USER' })).toBeNull();
});
