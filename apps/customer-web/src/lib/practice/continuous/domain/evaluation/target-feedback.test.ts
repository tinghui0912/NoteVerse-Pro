import { expect, it, vi } from 'vitest';
import artifactJson from '@/lib/practice/__fixtures__/canonical-practice-score-artifact.json';
import type { PracticeScoreArtifact } from '@/lib/practice/kernel/artifact';
import { ContinuousAssignmentFinalizer } from './assignment-finalizer';
import { ContinuousEvidenceStore } from './observation-store';
import { ContinuousEvaluationSession } from './session';
import { projectContinuousTargetFeedback, completedContinuousTargetFeedback } from './target-feedback';
import { CONTINUOUS_ASSIGNMENT_POLICY_ID } from './finalization-policy';

it('MIDI and microphone produce identical immutable settled target feedback without evidence payloads', () => {
  const results = (['MIDI', 'MICROPHONE'] as const).map(inputSource => {
    const finalizer = new ContinuousAssignmentFinalizer('targets', ['C4','D4'].map(pitch => ({
      strikeId: pitch, groupId: 'chord', pitch, expectedPerformanceTimeMs: 1000, renderNoteIds: [pitch],
    })));
    finalizer.publish({ publicationId: 'p', sessionDomainId: 'targets', analyzedThroughPerformanceMs: 3000, availabilitySessionTimeMs: 3100,
      observations: ['C4','E4'].map(pitch => ({ observationId: pitch, pitch, performanceTimeMs: 1000, confidence: 1,
        source: inputSource === 'MIDI' ? 'MIDI' as const : 'ACOUSTIC' as const })) });
    const before = finalizer.snapshot(), feedback = projectContinuousTargetFeedback(finalizer.targetStates());
    expect(Object.keys(feedback).sort()).toEqual(['assignmentPolicyId', 'targets']);
    expect(feedback).toEqual({ assignmentPolicyId: CONTINUOUS_ASSIGNMENT_POLICY_ID, targets: [
      { strikeId: 'C4', renderNoteIds: ['C4'], state: 'MATCHED' },
      { strikeId: 'D4', renderNoteIds: ['D4'], state: 'UNMATCHED' },
    ] });
    for (const target of feedback.targets) {
      expect(Object.keys(target).sort()).toEqual(['renderNoteIds','state','strikeId']);
      expect(Object.isFrozen(target)).toBe(true); expect(Object.isFrozen(target.renderNoteIds)).toBe(true);
    }
    expect(Object.isFrozen(feedback)).toBe(true); expect(Object.isFrozen(feedback.targets)).toBe(true);
    expect(finalizer.snapshot()).toEqual(before);
    finalizer.complete({ reason: 'SCOPE_COMPLETED', performanceTimeMs: 3000, availabilitySessionTimeMs: 3100 });
    const result = finalizer.completedAssignment(); if (result.status !== 'COMPLETE') throw Error('incomplete');
    expect(result.assignment.observations).toHaveLength(2);
    expect(result.assignment.unattributedObservations.map(row => row.observation.pitch)).toEqual(['E4']);
    const parsed = JSON.parse(JSON.stringify({ status: 'COMPLETE', inputSource,
      assignmentPolicyId: CONTINUOUS_ASSIGNMENT_POLICY_ID, assignment: result.assignment }));
    const parsedBefore = structuredClone(parsed), serializedBefore = JSON.stringify(parsed);
    expect(completedContinuousTargetFeedback(parsed)).toEqual(feedback);
    expect(parsed).toEqual(parsedBefore); expect(JSON.stringify(parsed)).toBe(serializedBefore);
    expect(Object.isFrozen(parsed.assignment.groups[0].strikes[0].renderNoteIds)).toBe(false);
    return feedback;
  });
  expect(results[0]).toEqual(results[1]);
});

it.each(['MIDI', 'MICROPHONE'] as const)('%s progression and live reads do not materialize an artifact snapshot or evidence ledger', inputSource => {
  const session = new ContinuousEvaluationSession({ artifact: artifactJson as PracticeScoreArtifact, scope: { kind: 'FULL' },
    sessionDomainId: 'live', inputSource, timeline: { beatToTimeMs: beat => beat * 500 } });
  const snapshot = vi.spyOn(ContinuousAssignmentFinalizer.prototype, 'snapshot').mockImplementation(() => { throw Error('FULL_ASSIGNMENT_READ'); });
  const values = vi.spyOn(ContinuousEvidenceStore.prototype, 'values').mockImplementation(() => { throw Error('RAW_EVIDENCE_READ'); });
  try {
    session.publish({ publicationId: 'p', sessionDomainId: 'live', analyzedThroughPerformanceMs: 10000, availabilitySessionTimeMs: 10000, observations: [] });
    session.complete({ reason: 'SCOPE_COMPLETED', performanceTimeMs: 10000, availabilitySessionTimeMs: 10000 });
    for (let i = 0; i < 100; i++) expect(session.targetFeedback()).not.toHaveProperty('assignment');
    expect(snapshot).not.toHaveBeenCalled(); expect(values).not.toHaveBeenCalled();
  } finally { snapshot.mockRestore(); values.mockRestore(); }
  expect(session.completedEvaluation().status).toBe('COMPLETE');
});

it.each([0, .01, .49, .99, 1])('does not re-threshold accepted acoustic evidence at confidence %s', confidence => {
  const f = new ContinuousAssignmentFinalizer('confidence', ['C4','D4'].map(pitch => ({
    strikeId: pitch, groupId: 'chord', pitch, expectedPerformanceTimeMs: 1000, renderNoteIds: [pitch],
  })));
  f.publish({ publicationId: 'p', sessionDomainId: 'confidence', analyzedThroughPerformanceMs: 3000, availabilitySessionTimeMs: 3100,
    observations: ['C4','D4'].map(pitch => ({ observationId: pitch, pitch, performanceTimeMs: 1000, confidence, source: 'ACOUSTIC' })) });
  expect(projectContinuousTargetFeedback(f.targetStates()).targets.map(target => target.state)).toEqual(['MATCHED','MATCHED']);
});
