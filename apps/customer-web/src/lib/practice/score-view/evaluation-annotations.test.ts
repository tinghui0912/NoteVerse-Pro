// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { ContinuousAssignmentFinalizer } from '@/lib/practice/continuous/domain/evaluation/assignment-finalizer';
import { projectContinuousTargetFeedback, completedContinuousTargetFeedback } from '@/lib/practice/continuous/domain/evaluation/target-feedback';
import { unavailableContinuousEvaluation } from '@/lib/practice/continuous/domain/evaluation/session';
import { assertCompletedAssignment } from '@/lib/practice/continuous/domain/evaluation/assignment-projection';
import { EvaluationAnnotationController, noteAnnotationsFromTargetFeedback } from './evaluation-annotations';

const targets = [60,62].map(pianoKey => ({ strikeId: String(pianoKey), groupId: 'g', pianoKey, expectedPerformanceTimeMs: 1000, renderNoteIds: [String(pianoKey)] }));
const matrix = [
  { label: 'silence', pianoKeys: [], supported: [], unsupported: [60,62] },
  { label: 'C4 + E4', pianoKeys: [60,64], supported: [60], unsupported: [62] },
  { label: 'C4 only', pianoKeys: [60], supported: [60], unsupported: [62] },
  { label: 'C4 + D4', pianoKeys: [60,62], supported: [60,62], unsupported: [] },
];
for (const inputSource of ['MIDI','MICROPHONE'] as const) describe(inputSource + ' target annotation parity', () => {
  it.each(matrix)('$label has the same supported/unsupported notes in Live and Review', row => {
    const finalizer = new ContinuousAssignmentFinalizer('target', targets);
    const observations = row.pianoKeys.map(pianoKey => ({ observationId: String(pianoKey), pianoKey, performanceTimeMs: 1000, confidence: .5,
      source: inputSource === 'MIDI' ? 'MIDI' as const : 'ACOUSTIC' as const }));
    const before = structuredClone(observations), serialized = JSON.stringify(observations);
    finalizer.publish({ publicationId: 'p', sessionDomainId: 'target', analyzedThroughPerformanceMs: 3000, availabilitySessionTimeMs: 3100, observations });
    const live = noteAnnotationsFromTargetFeedback(projectContinuousTargetFeedback(finalizer.targetStates()));
    finalizer.complete({ reason: 'SCOPE_COMPLETED', performanceTimeMs: 3000, availabilitySessionTimeMs: 3100 });
    const completed = finalizer.completedAssignment(); if (completed.status !== 'COMPLETE') throw Error('incomplete');
    assertCompletedAssignment(completed.assignment);
    const evaluation = { status: 'COMPLETE' as const, assignmentPolicyId: 'CONTINUOUS_EXACT_PIANO_KEY_ORDERED_ASSIGNMENT_FINALITY_V5' as const,
      inputSource, assignment: completed.assignment };
    const reviewFeedback = completedContinuousTargetFeedback(evaluation);
    expect(reviewFeedback).toEqual(projectContinuousTargetFeedback(finalizer.targetStates()));
    expect(completed.assignment.groups[0].strikes.map(strike => strike.state)).toEqual(targets.map(target => row.pianoKeys.includes(target.pianoKey) ? 'MATCHED' : 'UNMATCHED'));
    const review = noteAnnotationsFromTargetFeedback(reviewFeedback);
    expect(live).toEqual({ supportedNoteIds: row.supported.map(String), unsupportedNoteIds: row.unsupported.map(String) }); expect(review).toEqual(live);
    expect(completed.assignment.observations.map(observation => observation.pianoKey)).toEqual(row.pianoKeys);
    expect(completed.assignment.unattributedObservations.map(entry => entry.observation.pianoKey)).toEqual(row.pianoKeys.includes(64) ? [64] : []);
    expect(completed.assignment.observationAssignments.filter(entry => entry.kind === 'STRIKE_MATCH').map(entry => entry.observationId)).toEqual(row.supported.map(String));
    expect(completed.assignment.observationAssignments.every(entry => ['STRIKE_MATCH','UNATTRIBUTED'].includes(entry.kind))).toBe(true);
    expect(finalizer.snapshot().reservedObservationIds).toEqual([]);
    expect(observations).toEqual(before); expect(JSON.stringify(observations)).toBe(serialized); expect(observations.every(observation => !Object.isFrozen(observation))).toBe(true);
    const container = document.createElement('div'); container.innerHTML = '<span data-id=60></span><span data-id=62></span>';
    const controller = new EvaluationAnnotationController();
    for (const annotations of [live, review]) {
      controller.apply(container, annotations);
      for (const pianoKey of row.supported) expect(container.querySelector('[data-id="' + pianoKey + '"]')).toHaveClass('practice-summary-note-supported');
      for (const pianoKey of row.unsupported) expect(container.querySelector('[data-id="' + pianoKey + '"]')).toHaveClass('practice-summary-note-unsupported');
      expect(container.querySelector('[data-id="64"]')).toBeNull(); controller.clear(container);
    }
  });
  it('pending, not-reached and unavailable analysis never fabricate red targets', () => {
    const f = new ContinuousAssignmentFinalizer('pending', targets);
    expect(noteAnnotationsFromTargetFeedback(projectContinuousTargetFeedback(f.targetStates()))).toEqual({ supportedNoteIds: [], unsupportedNoteIds: [] });
    f.publish({ publicationId: 'stop', sessionDomainId: 'pending', analyzedThroughPerformanceMs: 500, availabilitySessionTimeMs: 500, observations: [] });
    f.complete({ reason: 'STOPPED_BY_USER', performanceTimeMs: 500, availabilitySessionTimeMs: 500 });
    expect(f.snapshot().groups[0].strikes.every(strike => strike.state === 'NOT_REACHED')).toBe(true);
    expect(noteAnnotationsFromTargetFeedback(projectContinuousTargetFeedback(f.targetStates()))).toEqual({ supportedNoteIds: [], unsupportedNoteIds: [] });
    expect(noteAnnotationsFromTargetFeedback(completedContinuousTargetFeedback(unavailableContinuousEvaluation(inputSource, 'CONTINUOUS_ANALYSIS_UNAVAILABLE')))).toEqual({ supportedNoteIds: [], unsupportedNoteIds: [] });
  });
});

it('replaces stale classes, prioritizes unsupported overlap and clears both target decorations', () => {
  const container = document.createElement('div'); container.innerHTML = '<span data-id="a"></span><span id="b"></span>';
  const controller = new EvaluationAnnotationController();
  controller.apply(container, { supportedNoteIds: ['a','b'], unsupportedNoteIds: ['b','b','absent'] });
  expect(container.querySelector('#b')).toHaveClass('practice-summary-note-unsupported');
  expect(container.querySelector('#b')).not.toHaveClass('practice-summary-note-supported');
  controller.apply(container, { supportedNoteIds: ['b'], unsupportedNoteIds: ['a'] });
  expect(container.querySelector('[data-id="a"]')).toHaveClass('practice-summary-note-unsupported');
  expect(container.querySelector('#b')).toHaveClass('practice-summary-note-supported');
  controller.clear(container); expect([...container.children].every(note => note.classList.length === 0)).toBe(true);
});
it('does not reapply unchanged settled feedback and rehydrates after score DOM revision', () => {
  const container = document.createElement('div'); container.innerHTML = '<span data-id="a"></span>';
  const controller = new EvaluationAnnotationController(), annotations = { supportedNoteIds: [], unsupportedNoteIds: ['a'] };
  controller.apply(container, annotations, { renderRevision: 1 });
  const add = vi.spyOn(DOMTokenList.prototype, 'add'), remove = vi.spyOn(DOMTokenList.prototype, 'remove');
  try { controller.apply(container, annotations, { renderRevision: 1 }); expect(add).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled(); }
  finally { add.mockRestore(); remove.mockRestore(); }
  container.innerHTML = '<span data-id="a"></span>'; controller.apply(container, annotations, { renderRevision: 2 });
  expect(container.querySelector('[data-id="a"]')).toHaveClass('practice-summary-note-unsupported');
});
