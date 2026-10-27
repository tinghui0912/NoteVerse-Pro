import { expect, it, vi } from 'vitest';
import artifactJson from '@/lib/practice/__fixtures__/canonical-practice-score-artifact.json';
import type { PracticeScoreArtifact } from '@/lib/practice/kernel/artifact';
import { ContinuousAssignmentFinalizer } from './assignment-finalizer';
import { ContinuousEvidenceStore } from './observation-store';
import { ContinuousEvaluationSession } from './session';
import { interpretContinuousAssignment } from './interpretation';
import { projectContinuousLiveFeedback } from './live-feedback';

it.each(['MIDI', 'MICROPHONE'] as const)('%s live feedback carries only committed render identities and eligible states', inputSource => {
  const finalizer = new ContinuousAssignmentFinalizer('live', ['C4','D4','G4'].map((pitch, i) => ({
    strikeId: pitch, groupId: i === 2 ? 'missing' : 'chord', pitch, expectedPerformanceTimeMs: i === 2 ? 2000 : 1000, renderNoteIds: [pitch],
  })));
  finalizer.publish({ publicationId: 'p', sessionDomainId: 'live', analyzedThroughPerformanceMs: 4000, availabilitySessionTimeMs: 4100,
    observations: ['C4','E4','B7'].map((pitch, i) => ({ observationId: pitch, pitch, performanceTimeMs: i === 2 ? 3500 : 1000, confidence: 1,
      source: inputSource === 'MIDI' ? 'MIDI' : 'ACOUSTIC' })) });
  const before = finalizer.snapshot();
  const feedback = projectContinuousLiveFeedback(finalizer.targetGroups(), inputSource);
  expect(Object.keys(feedback).sort()).toEqual(['assignmentPolicyId','groups','inputSource','interpretationPolicyId']);
  for (const group of feedback.groups) {
    expect(Object.keys(group).sort()).toEqual(['groupId','strikes']);
    for (const strike of group.strikes) expect(Object.keys(strike).sort()).toEqual(['renderNoteIds','state','strikeId']);
  }
  expect(feedback.groups.flatMap(group => group.strikes)).toEqual(inputSource === 'MIDI'
    ? [{ strikeId: 'C4', renderNoteIds: ['C4'], state: 'CORRECT' }, { strikeId: 'G4', renderNoteIds: ['G4'], state: 'MISSING' }]
    : [{ strikeId: 'C4', renderNoteIds: ['C4'], state: 'SUPPORTED' }]);
  for (const key of ['assignment','observations','unattributedObservations','observationAssignments','reservedObservationIds','extraObservations']) {
    expect(JSON.stringify(feedback)).not.toContain('"' + key + '"');
  }
  expect(Object.isFrozen(feedback.groups)).toBe(true);
  expect(feedback.groups.every(group => Object.isFrozen(group.strikes) && group.strikes.every(strike => Object.isFrozen(strike.renderNoteIds)))).toBe(true);
  expect(finalizer.snapshot()).toEqual(before);
  finalizer.complete({ reason: 'SCOPE_COMPLETED', performanceTimeMs: 4000, availabilitySessionTimeMs: 4100 });
  const result = finalizer.completedAssignment(); if (result.status !== 'COMPLETE') throw Error('incomplete');
  const interpretation = interpretContinuousAssignment(result.assignment, inputSource);
  expect(result.assignment.observations).toHaveLength(3);
  expect(result.assignment.groups[0].residualAssignments[0].observation.pitch).toBe('E4');
  if (interpretation.inputSource === 'MIDI') {
    expect(interpretation.groups[0].strikes.map(strike => strike.state)).toEqual(['CORRECT','WRONG']);
    expect(interpretation.extraObservations.map(observation => observation.pitch)).toEqual(['B7']);
  }
});

it.each(['MIDI', 'MICROPHONE'] as const)('%s progression and live reads do not materialize an artifact snapshot or evidence ledger', inputSource => {
  const session = new ContinuousEvaluationSession({ artifact: artifactJson as PracticeScoreArtifact, scope: { kind: 'FULL' },
    sessionDomainId: 'live', inputSource, timeline: { beatToTimeMs: beat => beat * 500 } });
  const snapshot = vi.spyOn(ContinuousAssignmentFinalizer.prototype, 'snapshot').mockImplementation(() => { throw Error('FULL_ASSIGNMENT_READ'); });
  const values = vi.spyOn(ContinuousEvidenceStore.prototype, 'values').mockImplementation(() => { throw Error('RAW_EVIDENCE_READ'); });
  try {
    session.publish({ publicationId: 'p', sessionDomainId: 'live', analyzedThroughPerformanceMs: 10000, availabilitySessionTimeMs: 10000, observations: [] });
    session.complete({ reason: 'SCOPE_COMPLETED', performanceTimeMs: 10000, availabilitySessionTimeMs: 10000 });
    for (let i = 0; i < 100; i++) expect(session.liveFeedback()).not.toHaveProperty('assignment');
    expect(snapshot).not.toHaveBeenCalled(); expect(values).not.toHaveBeenCalled();
  } finally { snapshot.mockRestore(); values.mockRestore(); }
  expect(session.completedEvaluation().status).toBe('COMPLETE');
});
