// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { completedEvaluationFixture } from './__fixtures__/continuous-evaluation';
import { noteAnnotationsFromCompletedEvaluation } from './performance-annotation-controller';
import { interpretContinuousAssignment } from '@/lib/practice/continuous/domain/evaluation/interpretation';
import { ContinuousAssignmentFinalizer } from '@/lib/practice/continuous/domain/evaluation/assignment-finalizer';

import {
  PerformanceAnnotationController,
  noteAnnotationsFromContinuousEvaluation,
} from './performance-annotation-controller';

describe('PerformanceAnnotationController', () => {
  it('applies performance annotations and replaces stale annotations', () => {
    const container = document.createElement('div');
    container.innerHTML = `
      <span data-id="n1"></span>
      <span data-id="n2"></span>
      <span id="n3"></span>
    `;
    const controller = new PerformanceAnnotationController();

    controller.apply(container, {
      supportedNoteIds: ['n1'],
      errorNoteIds: ['n2', 'missing', 'n2'],
    });

    expect(container.querySelector('[data-id="n1"]')).toHaveClass(
      'practice-summary-note-supported'
    );
    expect(container.querySelector('[data-id="n2"]')).toHaveClass(
      'practice-summary-note-error'
    );

    controller.apply(container, {
      supportedNoteIds: [],
      errorNoteIds: ['n3'],
    });

    expect(container.querySelector('[data-id="n1"]')).not.toHaveClass(
      'practice-summary-note-supported'
    );
    expect(container.querySelector('[data-id="n2"]')).not.toHaveClass(
      'practice-summary-note-error'
    );
    expect(container.querySelector('#n3')).toHaveClass(
      'practice-summary-note-error'
    );
  });

  it('clears annotations from the current container', () => {
    const container = document.createElement('div');
    container.innerHTML = '<span data-id="n1"></span>';
    const controller = new PerformanceAnnotationController();

    controller.apply(container, {
      supportedNoteIds: ['n1'],
      errorNoteIds: [],
    });
    controller.clear(container);

    expect(container.querySelector('[data-id="n1"]')).not.toHaveClass(
      'practice-summary-note-supported'
    );
  });

  it('does not remove and re-add unchanged settled annotations', () => {
    const container = document.createElement('div');
    container.innerHTML = `
      <span data-id="n1"></span>
      <span data-id="n2"></span>
    `;
    const controller = new PerformanceAnnotationController();
    controller.apply(
      container,
      {
        supportedNoteIds: [],
        errorNoteIds: ['n1'],
      },
      { renderRevision: 1 }
    );
    const addSpy = vi.spyOn(DOMTokenList.prototype, 'add');
    const removeSpy = vi.spyOn(DOMTokenList.prototype, 'remove');

    controller.apply(
      container,
      {
        supportedNoteIds: [],
        errorNoteIds: ['n1', 'n2'],
      },
      { renderRevision: 1 }
    );

    expect(container.querySelector('[data-id="n1"]')).toHaveClass(
      'practice-summary-note-error'
    );
    expect(container.querySelector('[data-id="n2"]')).toHaveClass(
      'practice-summary-note-error'
    );
    expect(
      removeSpy.mock.calls.some((call) =>
        call.includes('practice-summary-note-error')
      )
    ).toBe(false);
    expect(addSpy).toHaveBeenCalledTimes(1);
  });

  it('rehydrates settled annotations when the score DOM render revision changes', () => {
    const container = document.createElement('div');
    container.innerHTML = '<span data-id="n1"></span>';
    const controller = new PerformanceAnnotationController();
    controller.apply(
      container,
      {
        supportedNoteIds: [],
        errorNoteIds: ['n1'],
      },
      { renderRevision: 1 }
    );

    container.innerHTML = '<span data-id="n1"></span>';
    expect(container.querySelector('[data-id="n1"]')).not.toHaveClass(
      'practice-summary-note-error'
    );

    controller.apply(
      container,
      {
        supportedNoteIds: [],
        errorNoteIds: ['n1'],
      },
      { renderRevision: 2 }
    );

    expect(container.querySelector('[data-id="n1"]')).toHaveClass(
      'practice-summary-note-error'
    );
  });

  it('derives strike-level note annotations without coloring pending notes', () => {
    const finalizer = new ContinuousAssignmentFinalizer('annotation', [
      { strikeId: 'c', groupId: 'g-1', pitch: 'C4', expectedPerformanceTimeMs: 1000, renderNoteIds: ['note-c'] },
      { strikeId: 'e', groupId: 'g-1', pitch: 'E4', expectedPerformanceTimeMs: 1000, renderNoteIds: ['note-e'] },
      { strikeId: 'g', groupId: 'future', pitch: 'G4', expectedPerformanceTimeMs: 5000, renderNoteIds: ['note-g'] },
    ]);
    finalizer.publish({ publicationId: 'p', sessionDomainId: 'annotation', analyzedThroughPerformanceMs: 1500, availabilityTimeMs: 1600,
      observations: [{ observationId: 'obs-c', pitch: 'C4', performanceTimeMs: 1000, confidence: 1, source: 'MIDI' }] });
    const annotations = noteAnnotationsFromContinuousEvaluation({ inputSource: 'MIDI', policyId: 'MIDI_PHYSICAL_NOTE_EVENTS_V1', assignment: finalizer.snapshot(), interpretation: interpretContinuousAssignment(finalizer.snapshot(), 'MIDI') as import('./continuous/domain/evaluation/interpretation-types').MidiContinuousInterpretation });

    expect(annotations.supportedNoteIds).toEqual(['note-c']);
    expect(annotations.errorNoteIds).toEqual(['note-e']);
    expect(annotations.supportedNoteIds).not.toContain('note-g');
    expect(annotations.errorNoteIds).not.toContain('note-g');
  });
});


describe('source-safe score annotations', () => {
  it.each(['MIDI', 'MICROPHONE'] as const)('%s interprets unmatched targets without changing assignment', inputSource => {
    const raw = new ContinuousAssignmentFinalizer('annotation', ['C4','D4'].map(pitch => ({ strikeId: pitch, groupId: 'g', pitch, expectedPerformanceTimeMs: 1000, renderNoteIds: [pitch] })));
    raw.publish({ publicationId: 'p', sessionDomainId: 'annotation', analyzedThroughPerformanceMs: 3000, availabilityTimeMs: 3100,
      observations: ['C4','E4'].map(pitch => ({ observationId: pitch, pitch, performanceTimeMs: 1000, confidence: 1, source: inputSource === 'MIDI' ? 'MIDI' : 'ACOUSTIC' })) });
    raw.complete({ reason: 'SCOPE_COMPLETED', performanceTimeMs: 3000, availabilityTimeMs: 3100 });
    const result = raw.completedAssignment();
    if (result.status !== 'COMPLETE') throw new Error('incomplete');
    expect(noteAnnotationsFromCompletedEvaluation(completedEvaluationFixture(inputSource,result.assignment.groups))).toEqual({
      supportedNoteIds: ['C4'], errorNoteIds: inputSource === 'MIDI' ? ['D4'] : [] });
    expect(result.assignment.groups[0].residualObservations.map(row => row.pitch)).toEqual(['E4']);
  });
});
