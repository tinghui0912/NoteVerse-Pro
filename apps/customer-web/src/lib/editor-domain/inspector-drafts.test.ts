import { describe, expect, it } from 'vitest';

import {
  createExplicitRestEvent,
  createPitchedEvent,
  createTimelineGap,
  type EventId,
  type NoteAtom,
  type NoteAtomId,
  type RhythmicValue,
} from './model';
import {
  applyInspectorEdit,
  applyInspectorDraft,
  createInspectorDraftFromViewModel,
} from './inspector-drafts';
import { getInspectorViewModelForSelection } from './inspector-view-model';
import {
  createTestScoreDocument,
  testMeasureId as measureId,
  testStaffId as staffId,
  testVoiceId as voiceId,
} from './test-fixtures';

const quarter: RhythmicValue = {
  timelineDuration: { numerator: 1, denominator: 1 },
  notation: { base: 'quarter', dots: 0 },
};

const half: RhythmicValue = {
  timelineDuration: { numerator: 2, denominator: 1 },
  notation: { base: 'half', dots: 0 },
};

function noteAtom(
  id: string,
  step: NoteAtom['pitch']['step'],
  options: Pick<NoteAtom, 'accidental' | 'fingering'> = {},
): NoteAtom {
  return {
    id: id as NoteAtomId,
    pitch: { step, octave: 4 },
    ...options,
  };
}

const noteEvent = createPitchedEvent({
  id: 'event-note-1' as EventId,
  voiceId,
  staffId,
  position: { measureId, offset: { numerator: 0, denominator: 1 } },
  rhythm: quarter,
  notes: [noteAtom('note-1', 'C', { accidental: 'sharp', fingering: '2' })],
});

const restEvent = createExplicitRestEvent({
  id: 'event-rest-1' as EventId,
  voiceId,
  staffId,
  position: { measureId, offset: { numerator: 1, denominator: 1 } },
  rhythm: quarter,
});

describe('editor domain inspector drafts', () => {
  it('creates a pitched event draft from the inspector view model and applies rhythm edits', () => {
    const document = createTestScoreDocument({ events: [noteEvent] });
    const viewModel = getInspectorViewModelForSelection(document, {
      kind: 'event',
      eventId: noteEvent.id,
    });
    expect(viewModel?.kind).toBe('pitchedEvent');
    if (viewModel?.kind !== 'pitchedEvent') return;

    const draft = {
      ...createInspectorDraftFromViewModel(viewModel),
      rhythm: half,
    };
    const result = applyInspectorDraft(document, draft);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.document.events[0]).toMatchObject({
      id: noteEvent.id,
      kind: 'pitched',
      rhythm: half,
    });
  });

  it('applies event edits and stem notation overrides as one inspector edit', () => {
    const document = createTestScoreDocument({ events: [noteEvent] });

    const result = applyInspectorEdit(
      document,
      {
        kind: 'pitchedEvent',
        eventId: noteEvent.id,
        rhythm: half,
      },
      { stemDirection: 'up' },
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.document.events[0]).toMatchObject({
      id: noteEvent.id,
      rhythm: half,
    });
    expect(result.document.notationControls).toEqual([
      {
        kind: 'eventNotation',
        eventId: noteEvent.id,
        stemDirection: 'up',
      },
    ]);
  });

  it('clears stem notation overrides when an inspector edit explicitly provides undefined stem direction', () => {
    const document = {
      ...createTestScoreDocument({ events: [noteEvent] }),
      notationControls: [
        {
          kind: 'eventNotation' as const,
          eventId: noteEvent.id,
          stemDirection: 'down' as const,
        },
      ],
    };

    const result = applyInspectorEdit(
      document,
      {
        kind: 'pitchedEvent',
        eventId: noteEvent.id,
        rhythm: half,
      },
      { stemDirection: undefined },
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.document.events[0]).toMatchObject({
      id: noteEvent.id,
      rhythm: half,
    });
    expect(result.document.notationControls).toEqual([]);
  });

  it('updates a selected note atom without clearing omitted accidental or fingering fields', () => {
    const document = createTestScoreDocument({ events: [noteEvent] });

    const result = applyInspectorDraft(document, {
      kind: 'noteAtom',
      eventId: noteEvent.id,
      noteAtomId: 'note-1' as NoteAtomId,
      pitch: { step: 'D', octave: 5 },
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    const event = result.document.events[0];
    expect(event?.kind).toBe('pitched');
    if (event?.kind !== 'pitched') return;
    expect(event.notes[0]).toMatchObject({
      pitch: { step: 'D', octave: 5 },
      accidental: 'sharp',
      fingering: '2',
    });
  });

  it('can explicitly clear note atom fingering from an inspector draft', () => {
    const document = createTestScoreDocument({ events: [noteEvent] });

    const result = applyInspectorDraft(document, {
      kind: 'noteAtom',
      eventId: noteEvent.id,
      noteAtomId: 'note-1' as NoteAtomId,
      fingering: null,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    const event = result.document.events[0];
    expect(event?.kind).toBe('pitched');
    if (event?.kind !== 'pitched') return;
    expect(event.notes[0]?.fingering).toBeUndefined();
  });

  it('can explicitly clear note atom accidental from an inspector draft', () => {
    const document = createTestScoreDocument({ events: [noteEvent] });

    const result = applyInspectorDraft(document, {
      kind: 'noteAtom',
      eventId: noteEvent.id,
      noteAtomId: 'note-1' as NoteAtomId,
      accidental: null,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    const event = result.document.events[0];
    expect(event?.kind).toBe('pitched');
    if (event?.kind !== 'pitched') return;
    expect(event.notes[0]).toMatchObject({
      pitch: { step: 'C', octave: 4 },
      fingering: '2',
    });
    expect(event.notes[0]?.accidental).toBeUndefined();
  });

  it('can set note atom accidental without changing pitch alter', () => {
    const document = createTestScoreDocument({
      events: [
        createPitchedEvent({
          id: 'event-note-2' as EventId,
          voiceId,
          staffId,
          position: { measureId, offset: { numerator: 0, denominator: 1 } },
          rhythm: quarter,
          notes: [noteAtom('note-2', 'D')],
        }),
      ],
    });

    const result = applyInspectorDraft(document, {
      kind: 'noteAtom',
      eventId: 'event-note-2' as EventId,
      noteAtomId: 'note-2' as NoteAtomId,
      accidental: 'flat',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    const event = result.document.events[0];
    expect(event?.kind).toBe('pitched');
    if (event?.kind !== 'pitched') return;
    expect(event.notes[0]).toMatchObject({
      pitch: { step: 'D', octave: 4 },
      accidental: 'flat',
    });
  });

  it('appends a source-backed note atom through the command model', () => {
    const document = createTestScoreDocument({ events: [noteEvent] });

    const result = applyInspectorDraft(document, {
      kind: 'appendNoteAtom',
      eventId: noteEvent.id,
      pitch: { step: 'E', octave: 4 },
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    const event = result.document.events[0];
    expect(event?.kind).toBe('pitched');
    if (event?.kind !== 'pitched') return;
    expect(event.notes).toMatchObject([
      { id: 'note-1' },
      {
        id: 'note-1-chord-2',
        pitch: { step: 'E', octave: 4 },
        source: { musicXmlElementId: 'note-1-chord-2' },
      },
    ]);
  });

  it('removes one member from a multi-note pitched event through the command model', () => {
    const document = createTestScoreDocument({
      events: [
        createPitchedEvent({
          ...noteEvent,
          notes: [noteEvent.notes[0], noteAtom('note-2', 'E')],
        }),
      ],
    });

    const result = applyInspectorDraft(document, {
      kind: 'removeNoteAtom',
      eventId: noteEvent.id,
      noteAtomId: 'note-2' as NoteAtomId,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    const event = result.document.events[0];
    expect(event?.kind).toBe('pitched');
    if (event?.kind !== 'pitched') return;
    expect(event.notes.map((note) => note.id)).toEqual(['note-1']);
  });

  it('rejects removal of the final note atom', () => {
    const document = createTestScoreDocument({ events: [noteEvent] });

    expect(applyInspectorDraft(document, {
      kind: 'removeNoteAtom',
      eventId: noteEvent.id,
      noteAtomId: 'note-1' as NoteAtomId,
    })).toEqual({
      success: false,
      error: 'Cannot remove the last note atom from a pitched event. Delete the event instead.',
    });
  });

  it('deletes an event through the inspector command model', () => {
    const document = createTestScoreDocument({
      events: [noteEvent, restEvent],
      notationControls: [
        {
          kind: 'eventNotation',
          eventId: noteEvent.id,
          stemDirection: 'up',
        },
      ],
    });

    const result = applyInspectorDraft(document, {
      kind: 'deleteEvent',
      eventId: noteEvent.id,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.document.events.map((event) => event.id)).toEqual([restEvent.id]);
    expect(result.document.notationControls).toEqual([]);
  });

  it('applies explicit rest rhythm edits through the command model', () => {
    const document = createTestScoreDocument({ events: [restEvent] });

    const result = applyInspectorDraft(document, {
      kind: 'explicitRest',
      eventId: restEvent.id,
      rhythm: half,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.document.events[0]).toMatchObject({
      id: restEvent.id,
      kind: 'explicitRest',
      rhythm: half,
    });
  });

  it('materializes a timeline gap as an explicit rest instead of editing a cursor-gap entity', () => {
    const document = createTestScoreDocument({ events: [noteEvent] });
    const gap = createTimelineGap({
      voiceId,
      staffId,
      start: { measureId, offset: { numerator: 1, denominator: 1 } },
      duration: { numerator: 2, denominator: 1 },
    });

    const result = applyInspectorDraft(document, {
      kind: 'timelineGap',
      source: {
        kind: 'timelineGap',
        voiceId,
        staffId,
        start: gap.start,
        duration: gap.duration,
      },
      action: 'materializeExplicitRest',
      eventId: 'event-rest-from-gap-1' as EventId,
      rhythm: quarter,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.document.events.map((event) => event.kind)).toEqual(['pitched', 'explicitRest']);
    expect(result.document.events[1]).toMatchObject({
      id: 'event-rest-from-gap-1',
      position: gap.start,
      rhythm: quarter,
    });
  });

  it('keeps a timeline gap draft inspect-only until a materialize action is explicit', () => {
    const document = createTestScoreDocument({ events: [noteEvent] });
    const gap = createTimelineGap({
      voiceId,
      staffId,
      start: { measureId, offset: { numerator: 1, denominator: 1 } },
      duration: { numerator: 2, denominator: 1 },
    });
    const viewModel = getInspectorViewModelForSelection(document, {
      kind: 'timelineGap',
      gap,
    });
    expect(viewModel?.kind).toBe('timelineGap');
    if (viewModel?.kind !== 'timelineGap') return;

    const draft = createInspectorDraftFromViewModel(viewModel);
    expect(draft).toMatchObject({
      kind: 'timelineGap',
      action: 'inspectOnly',
    });
    expect(applyInspectorDraft(document, draft)).toEqual({
      success: false,
      error: 'Timeline gap inspection does not mutate the document.',
    });
  });

  it('materializes a derived rest as an explicit rest through an explicit action', () => {
    const document = createTestScoreDocument({ events: [noteEvent] });
    const sourceGap = createTimelineGap({
      voiceId,
      staffId,
      start: { measureId, offset: { numerator: 1, denominator: 1 } },
      duration: { numerator: 2, denominator: 1 },
    });

    const result = applyInspectorDraft(document, {
      kind: 'derivedRest',
      source: {
        kind: 'derivedRest',
        voiceId,
        staffId,
        position: sourceGap.start,
        rhythm: half,
        sourceGap,
      },
      action: 'materializeExplicitRest',
      eventId: 'event-rest-from-derived-1' as EventId,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.document.events[1]).toMatchObject({
      id: 'event-rest-from-derived-1',
      kind: 'explicitRest',
      position: sourceGap.start,
      rhythm: half,
    });
  });

  it('rejects materializing a rest that is longer than the selected gap', () => {
    const document = createTestScoreDocument({ events: [noteEvent] });
    const gap = createTimelineGap({
      voiceId,
      staffId,
      start: { measureId, offset: { numerator: 1, denominator: 1 } },
      duration: { numerator: 1, denominator: 1 },
    });

    const result = applyInspectorDraft(document, {
      kind: 'timelineGap',
      source: {
        kind: 'timelineGap',
        voiceId,
        staffId,
        start: gap.start,
        duration: gap.duration,
      },
      action: 'materializeExplicitRest',
      eventId: 'event-too-long-rest-1' as EventId,
      rhythm: half,
    });

    expect(result).toEqual({
      success: false,
      error: 'Explicit rest duration cannot exceed the selected timeline gap.',
    });
  });
});
